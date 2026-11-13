//! 一次录制的生命周期：准备 → 开始 → （暂停 ⇄ 继续）→ 停止 / 取消。
//!
//! 准备好之后采集就在跑（帧进收件箱，只留最新一张），开始的那一刻立刻有画面可用。
//!
//! 各阶段之间都是有界队列，谁也不等后面的阶段：
//! 采集回调 →（收件箱，满了丢最旧的来源帧）→ 会话线程（网格、时刻表、活动时间线）
//! →（编码队列，满了这一格记为丢弃）→ 编码线程（调平台的写文件接口）→ 平台自己的写盘队列。
//! 状态只在会话线程里：主循环把指令交过来，由它判断并应答，每条恰好一次。

use super::{
    activity,
    health::{Health, Inbox},
    pacer::{Hold, Pacer, Poll},
    protocol::{failure, io_failure, CaptureConfig, Events, PROTOCOL},
    timing,
};
use crate::platform::{CaptureControl, FrameWriter, Opened, Platform};
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, AtomicU8, Ordering},
        mpsc, Arc, Mutex,
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

/// 收件箱与编码队列各能装多久的帧（帧率除以它）：后面的阶段卡住不超过这么久就一帧不丢，之后追上。
/// 每张是一块显卡里的纹理（4K 约 12 MB），两个队列都装满时多占几百 MB 显存。
const QUEUE_SECONDS_DIVISOR: u32 = 2;
const REPORT_INTERVAL_US: i64 = 1_000_000;
const FOREGROUND_INTERVAL_US: i64 = 250_000;
/// 来源丢了之后隔多久找一次。
const REACQUIRE_INTERVAL_US: i64 = 1_000_000;
/// 设成 1 才接受 `inject` 指令。
pub const INJECT_SWITCH: &str = "HENJI_SCREEN_CAPTURE_INJECT";

pub const PREPARED: u8 = 0;
pub const RECORDING: u8 = 1;
pub const PAUSED: u8 = 2;
pub const STOPPING: u8 = 3;
pub const ENDED: u8 = 4;

fn state_name(state: u8) -> &'static str {
    match state {
        PREPARED => "prepared",
        RECORDING => "recording",
        PAUSED => "paused",
        STOPPING => "stopping",
        _ => "ended",
    }
}

/// 交给会话线程的指令，都带应答号：应答号为空值表示没人等应答（标准输入已关）。
enum Control {
    Start(Option<i64>, Value),
    Pause(Option<i64>, Value),
    Resume(Option<i64>, Value),
    /// 文件收尾之后才应答。
    Stop(Option<i64>, Value),
    Cancel(Value),
    /// 开预览（带请求）或关预览（空）。
    Preview(Option<Value>, Value),
    /// 开发用的故障注入。
    Inject(Value, Value),
}

#[derive(Clone)]
pub struct Paths {
    pub video: PathBuf,
    pub proxy: PathBuf,
    pub timing: PathBuf,
    pub activity: PathBuf,
    pub manifest: PathBuf,
}

impl Paths {
    pub fn new(directory: &Path, name: &str) -> Self {
        Self {
            video: directory.join(format!("{name}.mp4")),
            proxy: directory.join(format!("{name}.proxy.mp4")),
            timing: directory.join(format!("{name}.frames")),
            activity: directory.join(format!("{name}.activity.jsonl")),
            manifest: directory.join(format!("{name}.capture.json")),
        }
    }

    fn file_name(path: &Path) -> String {
        path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default()
    }

    fn remove_all(&self) {
        for path in [&self.video, &self.proxy, &self.timing, &self.activity, &self.manifest] {
            let _ = fs::remove_file(path);
        }
    }
}

/// 主循环手里的会话句柄。
pub struct Session {
    pub id: String,
    /// 准备的结果：实际尺寸、编码器、文件名。
    pub info: Value,
    control: mpsc::Sender<Control>,
    /// 会话线程结束时在这把锁里置真并把没处理的指令逐条回绝；发指令也在锁里，所以不会有指令掉进没人读的通道。
    ended: Arc<Mutex<bool>>,
    wake: Box<dyn Fn() + Send>,
    state: Arc<AtomicU8>,
    status: Arc<Mutex<Value>>,
    thread: Option<thread::JoinHandle<()>>,
}

impl Session {
    pub fn prepare<P: Platform>(config: CaptureConfig, events: Events) -> Result<Self, String> {
        let directory = PathBuf::from(&config.directory);
        fs::create_dir_all(&directory).map_err(|error| io_failure(&error))?;
        let paths = Paths::new(&directory, &config.name);
        let queue = (config.fps / QUEUE_SECONDS_DIVISOR).max(8) as usize;
        let inbox = Arc::new(Inbox::<Arc<P::Frame>>::new(queue));
        let health = Arc::new(Health::default());
        // 打开到一半失败时文件可能已经建好：不留空文件。
        let opened = P::open(&config, &paths.video, &paths.proxy, inbox.clone(), health.clone()).inspect_err(|_| {
            let _ = fs::remove_file(&paths.video);
            let _ = fs::remove_file(&paths.proxy);
        })?;
        let info = json!({
            "sessionId": config.session_id,
            "width": opened.width, "height": opened.height, "fps": config.fps,
            "codec": config.codec.name(), "encoder": opened.encoder, "source": opened.source,
            "proxy": opened.proxy.map(|(width, height)| json!({"width": width, "height": height})),
            "files": {
                "video": Paths::file_name(&paths.video),
                "proxy": opened.proxy.map(|_| Paths::file_name(&paths.proxy)),
                "timing": Paths::file_name(&paths.timing),
                "activity": Paths::file_name(&paths.activity), "manifest": Paths::file_name(&paths.manifest),
            },
        });
        let (control, control_rx) = mpsc::channel();
        let state = Arc::new(AtomicU8::new(PREPARED));
        let ended = Arc::new(Mutex::new(false));
        let status = Arc::new(Mutex::new(json!({"state": "prepared"})));
        let id = config.session_id.clone();
        let wake_inbox = inbox.clone();
        let runner = Runner::<P> {
            config,
            paths,
            inbox,
            health,
            events,
            control: control_rx,
            state: state.clone(),
            ended: ended.clone(),
            status: status.clone(),
            opened: Some(opened),
            info: info.clone(),
            queue,
        };
        let thread = thread::Builder::new().name("capture-session".into()).spawn(move || runner.run()).map_err(|error| format!("CAPTURE_FAILED|无法启动会话线程：{error}"))?;
        Ok(Self { id, info, control, ended, wake: Box::new(move || wake_inbox.signal()), state, status, thread: Some(thread) })
    }

    /// 把指令交给会话线程，应答由它发出。
    /// 返回错误时指令没有交出去（会话已结束或指令不认识），由调用方应答。
    pub fn command(&self, kind: &str, request: &Value) -> Result<(), String> {
        let (at_us, id) = (request["atUs"].as_i64(), request["id"].clone());
        let control = match kind {
            "start" => Control::Start(at_us, id),
            "pause" => Control::Pause(at_us, id),
            "resume" => Control::Resume(at_us, id),
            "stop" => Control::Stop(at_us, id),
            "cancel" => Control::Cancel(id),
            "startPreview" => Control::Preview(Some(request.clone()), id),
            "stopPreview" => Control::Preview(None, id),
            "inject" => Control::Inject(request.clone(), id),
            _ => return Err("INVALID_ARGUMENT|未知指令".into()),
        };
        let ended = self.ended.lock().unwrap();
        if *ended {
            return Err("SESSION_MISSING|这次录制已经结束".into());
        }
        let _ = self.control.send(control);
        drop(ended);
        (self.wake)();
        Ok(())
    }

    pub fn status(&self) -> Value {
        let mut status = self.status.lock().unwrap().clone();
        status["state"] = json!(state_name(self.state.load(Ordering::Acquire)));
        status
    }

    /// 应答与事件都已发完、不再接受指令。用这个标志而不是线程是否退出：停止的应答一到主进程就可能立刻准备下一次录制。
    pub fn is_ended(&self) -> bool {
        *self.ended.lock().unwrap()
    }

    /// 等会话线程收尾完（进程退出前）。
    pub fn join(&mut self) {
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

enum Job<F> {
    Frame(Arc<F>, i64, bool),
    Flush(mpsc::Sender<()>),
    /// 开发用：编码线程停这么多毫秒，模拟一次停顿。
    Stall(u64),
    Finish(mpsc::Sender<Result<(), String>>),
}

/// 编码线程：独占平台的写文件接口。会话线程只往有界队列里放，不等它。
struct EncodeStage<F> {
    jobs: mpsc::SyncSender<Job<F>>,
    failure: Arc<Mutex<Option<String>>>,
    /// 开发用：每帧额外等这么多微秒，模拟慢的编码器。
    delay_us: Arc<AtomicU64>,
    health: Arc<Health>,
    thread: Option<thread::JoinHandle<()>>,
}

impl<F: Send + Sync + 'static> EncodeStage<F> {
    fn spawn<W: FrameWriter<F> + Send + 'static>(mut writer: W, health: Arc<Health>, capacity: usize) -> Result<Self, String> {
        let (jobs, receiver) = mpsc::sync_channel::<Job<F>>(capacity);
        let failure = Arc::new(Mutex::new(None::<String>));
        let delay_us = Arc::new(AtomicU64::new(0));
        let (thread_failure, thread_delay, thread_health) = (failure.clone(), delay_us.clone(), health.clone());
        let thread = thread::Builder::new()
            .name("capture-encode".into())
            .spawn(move || {
                let health = thread_health;
                for job in receiver {
                    match job {
                        Job::Frame(frame, pts, force_key) => {
                            health.encode_queue.fetch_sub(1, Ordering::Relaxed);
                            // 出过错之后只收帧、放掉：会话线程看到错误后收尾。
                            if thread_failure.lock().unwrap().is_none() {
                                let started = Instant::now();
                                let delay = thread_delay.load(Ordering::Relaxed);
                                if delay > 0 {
                                    thread::sleep(Duration::from_micros(delay));
                                }
                                match writer.write(&frame, pts, force_key) {
                                    Ok(bytes) => {
                                        health.encoded_bytes.fetch_add(bytes, Ordering::Relaxed);
                                    }
                                    Err(error) => {
                                        thread_failure.lock().unwrap().get_or_insert(error);
                                    }
                                }
                                let elapsed = started.elapsed().as_micros() as u64;
                                Health::raise(&health.encode_max_us, elapsed);
                                health.encode_sum_us.fetch_add(elapsed, Ordering::Relaxed);
                                health.encode_count.fetch_add(1, Ordering::Relaxed);
                            }
                        }
                        Job::Flush(done) => {
                            if thread_failure.lock().unwrap().is_none() {
                                if let Err(error) = writer.flush_fragment() {
                                    thread_failure.lock().unwrap().get_or_insert(error);
                                }
                            }
                            let _ = done.send(());
                        }
                        Job::Stall(milliseconds) => thread::sleep(Duration::from_millis(milliseconds)),
                        Job::Finish(done) => {
                            let _ = done.send(writer.finish());
                            break;
                        }
                    }
                }
            })
            .map_err(|error| format!("CAPTURE_FAILED|无法启动编码线程：{error}"))?;
        Ok(Self { jobs, failure, delay_us, health, thread: Some(thread) })
    }

    fn failure(&self) -> Option<String> {
        self.failure.lock().unwrap().clone()
    }

    fn has_room(&self, capacity: usize) -> bool {
        (self.health.encode_queue.load(Ordering::Relaxed) as usize) < capacity
    }

    /// 放不进去（编码线程已经退出）返回 false；队列有没有空位由调用方先用 has_room 看。
    fn try_frame(&self, frame: Arc<F>, pts: i64, force_key: bool) -> bool {
        let queued = self.health.encode_queue.fetch_add(1, Ordering::Relaxed) + 1;
        // 调用方已确认有空位；偶尔被别的作业占了位置时等一下，不改变“这一帧会被编码”的结论。
        if self.jobs.send(Job::Frame(frame, pts, force_key)).is_err() {
            self.health.encode_queue.fetch_sub(1, Ordering::Relaxed);
            return false;
        }
        Health::raise(&self.health.encode_queue_max, queued);
        true
    }

    /// 等队列里的帧都写完并落成分片。
    fn flush(&self) -> Result<(), String> {
        let (done, wait) = mpsc::channel();
        if self.jobs.send(Job::Flush(done)).is_ok() {
            let _ = wait.recv();
        }
        self.failure().map_or(Ok(()), Err)
    }

    fn finish(&mut self) -> Result<(), String> {
        let (done, wait) = mpsc::channel();
        let result = match self.jobs.send(Job::Finish(done)) {
            Ok(()) => wait.recv().unwrap_or_else(|_| Err("ENCODER_FAILED|编码线程中途退出".into())),
            Err(_) => Err("ENCODER_FAILED|编码线程中途退出".into()),
        };
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
        // 先前写帧时的错误比收尾时的错误更说明原因。
        self.failure().map_or(result, Err)
    }
}

struct Runner<P: Platform> {
    config: CaptureConfig,
    paths: Paths,
    inbox: Arc<Inbox<Arc<P::Frame>>>,
    health: Arc<Health>,
    events: Events,
    control: mpsc::Receiver<Control>,
    state: Arc<AtomicU8>,
    ended: Arc<Mutex<bool>>,
    status: Arc<Mutex<Value>>,
    opened: Option<Opened<P>>,
    info: Value,
    queue: usize,
}

/// 开始之后才有的东西：网格与两份旁路文件。
struct Recording<F> {
    pacer: Pacer<Arc<F>>,
    table: timing::Writer,
    activity: activity::Writer,
    written: u64,
    durable_reported: u64,
    paused: bool,
    /// 当前（或刚结束的）空档里来源丢过。
    gap_lost: bool,
    /// 当前（或刚结束的）空档里用户暂停过：这样的空档按暂停算，不标成来源丢失。
    gap_paused: bool,
}

enum End {
    Stopped(Value),
    Cancelled(Value),
    Interrupted(String),
}

impl<P: Platform> Runner<P> {
    fn event(&self, name: &str, mut fields: Value) {
        fields["event"] = json!(name);
        fields["sessionId"] = json!(self.config.session_id);
        self.events.send(fields);
    }

    fn reply(&self, id: &Value, result: Result<Value, String>) {
        if id.is_null() {
            return;
        }
        self.events.send(match result {
            Ok(result) => json!({"id": id, "ok": true, "result": result}),
            Err(error) => json!({"id": id, "ok": false, "error": failure(&error)}),
        });
    }

    fn manifest(&self, origin_us: Option<i64>, result: Option<&Value>, error: Option<&str>) -> Value {
        let unix_ms = SystemTime::now().duration_since(UNIX_EPOCH).map(|elapsed| elapsed.as_millis() as u64).unwrap_or(0);
        let proxy = (!self.info["proxy"].is_null()).then(|| json!({"file": self.info["files"]["proxy"], "width": self.info["proxy"]["width"], "height": self.info["proxy"]["height"]}));
        json!({
            "format": "henji-screen-capture", "version": 1, "protocol": PROTOCOL,
            "sessionId": self.config.session_id,
            "completed": result.is_some() && error.is_none(),
            "video": {
                "file": self.info["files"]["video"], "codec": self.info["codec"], "encoder": self.info["encoder"],
                "width": self.info["width"], "height": self.info["height"],
                "fpsNum": self.config.fps, "fpsDen": 1,
                "colorMatrix": "bt709", "colorRange": "limited",
                "keyframeFrames": self.config.keyframe_interval(),
            },
            "proxy": proxy,
            "timing": {"file": self.info["files"]["timing"], "version": timing::VERSION},
            "activity": {"file": self.info["files"]["activity"]},
            "clock": P::CLOCK_NAME,
            "originUs": origin_us,
            "writtenAtUnixMs": unix_ms,
            "source": self.info["source"],
            "result": result,
            "error": error.map(failure),
        })
    }

    /// 先写临时文件再改名：读的一方看到的要么是旧的完整清单，要么是新的。
    fn write_manifest(&self, value: &Value) -> Result<(), String> {
        let temporary = self.paths.manifest.with_extension("json.tmp");
        fs::write(&temporary, serde_json::to_vec_pretty(value).unwrap()).and_then(|_| fs::rename(&temporary, &self.paths.manifest)).map_err(|error| io_failure(&error))
    }

    fn begin(&self, origin_us: i64) -> Result<Recording<P::Frame>, String> {
        let header = timing::Header { fps_num: self.config.fps, fps_den: 1, origin_us, clock: P::CLOCK };
        let table = timing::Writer::create(&self.paths.timing, header).map_err(|error| io_failure(&error))?;
        let activity = activity::Writer::create(&self.paths.activity, origin_us, self.config.fps, 1).map_err(|error| io_failure(&error))?;
        self.write_manifest(&self.manifest(Some(origin_us), None, None))?;
        Ok(Recording { pacer: Pacer::new(origin_us, self.config.fps, 1), table, activity, written: 0, durable_reported: 0, paused: false, gap_lost: false, gap_paused: false })
    }

    fn totals(&self, recording: Option<&Recording<P::Frame>>) -> Value {
        let load = |value: &AtomicU64| value.load(Ordering::Relaxed);
        let mut totals = json!({
            "sourceFrames": load(&self.health.source_frames),
            "captureDropped": load(&self.health.capture_dropped),
            "captureFailed": load(&self.health.capture_failed),
            "bytes": load(&self.health.bytes_written),
            "durableFrames": load(&self.health.durable_frames),
        });
        if !self.info["proxy"].is_null() {
            totals["proxyFrames"] = json!(load(&self.health.proxy_frames));
        }
        if let Some(recording) = recording {
            let counters = recording.pacer.counters;
            let frames = recording.pacer.next_output();
            totals["originUs"] = json!(recording.pacer.origin_us());
            totals["frames"] = json!(frames);
            totals["encodedFrames"] = json!(recording.written);
            totals["cells"] = json!(recording.pacer.next_cell());
            totals["durationUs"] = json!(frames * 1_000_000 / self.config.fps as u64);
            totals["freshFrames"] = json!(counters.fresh);
            totals["repeatedFrames"] = json!(counters.repeated);
            totals["droppedFrames"] = json!(counters.dropped);
            totals["sourceSurplus"] = json!(counters.surplus);
            totals["pausedCells"] = json!(counters.paused_cells);
        }
        totals
    }

    fn inject(&self, request: &Value, capture: Option<&P::Capture>, stage: &EncodeStage<P::Frame>) -> Result<Value, String> {
        // 故障注入只给自测用：没有显式打开时一律拒绝，正式环境里发来也不起作用。
        if std::env::var_os(INJECT_SWITCH).is_none_or(|value| value != "1") {
            return Err("INVALID_ARGUMENT|故障注入没有打开".into());
        }
        let milliseconds = request["ms"].as_u64().unwrap_or(0);
        match request["kind"].as_str().unwrap_or_default() {
            "encodeStall" => {
                let _ = stage.jobs.try_send(Job::Stall(milliseconds));
            }
            "encodeDelay" => stage.delay_us.store(milliseconds * 1000, Ordering::Relaxed),
            "captureFailure" => self.inbox.fail(format!("{}|注入的采集故障", request["code"].as_str().unwrap_or("CAPTURE_FAILED"))),
            "sourceLost" => {
                if let Some(capture) = capture {
                    capture.simulate_source_lost();
                }
            }
            "frameFailures" => self.health.inject_frame_failures.store(request["count"].as_u64().unwrap_or(1), Ordering::Relaxed),
            _ => return Err("INVALID_ARGUMENT|未知的注入种类".into()),
        }
        Ok(json!({}))
    }

    fn run(mut self) {
        let Opened { capture, writer, .. } = self.opened.take().expect("会话只运行一次");
        let mut capture = Some(capture);
        let mut stage = match EncodeStage::spawn(writer, self.health.clone(), self.queue) {
            Ok(stage) => stage,
            Err(error) => {
                self.event("interrupted", json!({"error": failure(&error)}));
                *self.ended.lock().unwrap() = true;
                self.state.store(ENDED, Ordering::Release);
                return;
            }
        };
        let mut recording: Option<Recording<P::Frame>> = None;
        // 开始之前只留最新的一张，开始那一刻就有画面。
        let mut preroll: Option<(i64, Arc<P::Frame>)> = None;
        let mut start_at: Option<i64> = None;
        // 已要求开始、第一帧还没到时收到的暂停与继续（真为暂停）：网格建好后补上。
        let mut early_marks: Vec<(bool, i64)> = Vec::new();
        let mut pause_open = false;
        // 已接受的停止指令的应答号。
        let mut stop_reply: Option<Value> = None;
        // 来源丢了（显示器断开），在等它回来。
        let mut lost = false;
        let mut last_reacquire = 0i64;
        let mut source_size = self.health.source_size.load(Ordering::Relaxed);
        let mut next_due = P::now_us();
        let mut last_report = P::now_us();
        let mut last_foreground = 0i64;
        let mut last_cpu = (P::now_us(), capture.as_ref().map(|capture| P::process_stats(capture).cpu_time_us).unwrap_or(0));

        let end = 'session: loop {
            let now = P::now_us();
            let wait_us = if recording.is_some() { (next_due - now).clamp(0, 50_000) } else { 50_000 };
            let (frames, capture_failure) = self.inbox.wait(Duration::from_micros(wait_us as u64));
            let now = P::now_us();
            for (source_us, frame) in frames {
                match &mut recording {
                    Some(recording) => recording.pacer.push(source_us, frame),
                    None => preroll = Some((source_us, frame)),
                }
            }

            let mut controls: Vec<Control> = Vec::new();
            loop {
                match self.control.try_recv() {
                    Ok(control) => controls.push(control),
                    Err(mpsc::TryRecvError::Empty) => break,
                    Err(mpsc::TryRecvError::Disconnected) => {
                        controls.push(Control::Stop(None, Value::Null));
                        break;
                    }
                }
            }
            for control in controls {
                let stopping = stop_reply.is_some();
                match control {
                    Control::Start(at, id) => {
                        if start_at.is_some() {
                            self.reply(&id, Err("INVALID_STATE|录制已经开始".into()));
                        } else {
                            // 早于现在太多的开始时刻补不出画面，只接受四分之一秒以内的回溯。
                            start_at = Some(at.unwrap_or(now).clamp(now - 250_000, now));
                            self.state.store(RECORDING, Ordering::Release);
                            self.reply(&id, Ok(self.info.clone()));
                        }
                    }
                    Control::Pause(_, id) | Control::Resume(_, id) if start_at.is_none() || stopping => {
                        self.reply(&id, Err("INVALID_STATE|不在录制中，无法暂停或继续".into()));
                    }
                    Control::Pause(at, id) => {
                        if pause_open {
                            self.reply(&id, Err("INVALID_STATE|已经在暂停中".into()));
                        } else {
                            // 未来的时刻不接受：状态已经是暂停，画面却还在录，会对不上。
                            let at = at.unwrap_or(now).min(now);
                            match &mut recording {
                                Some(recording) => {
                                    recording.pacer.pause(at, Hold::User);
                                    // 已经在空档里（来源丢了）时按下暂停：这段空档也算用户暂停过。
                                    recording.gap_paused |= recording.paused;
                                }
                                None => early_marks.push((true, at)),
                            }
                            pause_open = true;
                            self.state.store(PAUSED, Ordering::Release);
                            self.reply(&id, Ok(json!({})));
                        }
                    }
                    Control::Resume(at, id) => {
                        if !pause_open {
                            self.reply(&id, Err("INVALID_STATE|不在暂停中，无法继续".into()));
                        } else {
                            let at = at.unwrap_or(now).min(now);
                            match &mut recording {
                                Some(recording) => {
                                    recording.pacer.resume(at, Hold::User);
                                }
                                None => early_marks.push((false, at)),
                            }
                            pause_open = false;
                            self.state.store(RECORDING, Ordering::Release);
                            self.reply(&id, Ok(json!({})));
                        }
                    }
                    Control::Stop(at, id) => {
                        if stopping {
                            self.reply(&id, Err("INVALID_STATE|录制已经在结束".into()));
                        } else if let Some(recording) = &mut recording {
                            // 停止时刻之前的格子会立刻补齐，所以不接受未来的时刻。
                            recording.pacer.stop(at.unwrap_or(now).min(now));
                            self.state.store(STOPPING, Ordering::Release);
                            stop_reply = Some(id);
                        } else {
                            break 'session End::Stopped(id);
                        }
                    }
                    Control::Cancel(id) => break 'session End::Cancelled(id),
                    Control::Preview(request, id) => {
                        let result = match (&capture, request) {
                            (Some(capture), Some(request)) => {
                                let (events, session) = (self.events.clone(), self.config.session_id.clone());
                                capture.start_preview(
                                    &request,
                                    Box::new(move |mut fields| {
                                        fields["event"] = json!("preview");
                                        fields["sessionId"] = json!(session);
                                        events.send_lossy(fields);
                                    }),
                                )
                            }
                            (Some(capture), None) => {
                                capture.stop_preview();
                                Ok(json!({}))
                            }
                            (None, _) => Err("INVALID_STATE|录制已经在结束".into()),
                        };
                        self.reply(&id, result);
                    }
                    Control::Inject(request, id) => self.reply(&id, self.inject(&request, capture.as_ref(), &stage)),
                }
            }

            if recording.is_none() {
                if let (Some(at), Some((source_us, frame))) = (start_at, preroll.take()) {
                    // 手里的画面早于开始时刻：起点就是开始时刻；第一帧在开始之后才到：起点是它的系统时刻。
                    let origin = at.max(source_us);
                    match self.begin(origin) {
                        Ok(mut started) => {
                            started.pacer.push(source_us, frame);
                            for (pause, at) in early_marks.drain(..) {
                                if pause {
                                    started.pacer.pause(at, Hold::User);
                                } else {
                                    started.pacer.resume(at, Hold::User);
                                }
                            }
                            if lost {
                                started.pacer.pause(origin, Hold::SourceLost);
                            }
                            self.event("started", json!({"originUs": origin, "firstSourceUs": source_us}));
                            recording = Some(started);
                            next_due = now;
                        }
                        Err(error) => break 'session End::Interrupted(error),
                    }
                }
            }

            // 来源丢了不结束录制：这段时间的格子不进文件（时刻表里是一段空档），等它回来接着录。
            if let Some(error) = capture_failure {
                if !error.starts_with("SOURCE_LOST|") {
                    break 'session End::Interrupted(error);
                }
                if !lost {
                    lost = true;
                    last_reacquire = now;
                    if let Some(active) = &mut recording {
                        active.pacer.pause(now, Hold::SourceLost);
                    }
                    self.event("sourceLost", json!({"atUs": now}));
                }
            }
            if lost && now - last_reacquire >= REACQUIRE_INTERVAL_US {
                last_reacquire = now;
                match capture.as_mut().map(|capture| capture.reacquire()) {
                    Some(Ok(true)) => {
                        lost = false;
                        if let Some(active) = &mut recording {
                            active.pacer.resume(now, Hold::SourceLost);
                        }
                        self.event("sourceRestored", json!({"atUs": now}));
                    }
                    Some(Err(error)) => break 'session End::Interrupted(error),
                    _ => {}
                }
            }

            if let Some(active) = &mut recording {
                loop {
                    match active.pacer.poll(P::now_us()) {
                        Poll::Idle(due) => {
                            next_due = due;
                            break;
                        }
                        Poll::Emit(mut emit) => {
                            // 编码队列满了（编码器持续跟不上）：这一格不等，记为丢弃。只有本线程往队列里放，现在有空位，稍后放就一定放得进。
                            if !emit.dropped && !stage.has_room(self.queue) {
                                active.pacer.reject(&emit);
                                emit.dropped = true;
                            }
                            let mut flags = 0u16;
                            if emit.dropped {
                                flags |= timing::FLAG_DROPPED;
                            } else {
                                if emit.fresh {
                                    flags |= timing::FLAG_FRESH;
                                }
                                if emit.force_key {
                                    flags |= timing::FLAG_KEYFRAME;
                                }
                                if emit.force_key && emit.output > 0 {
                                    flags |= timing::FLAG_AFTER_RESUME;
                                    // 来源丢失与用户暂停重叠的空档按暂停算：只有纯粹来源丢失的空档才标出来。
                                    let (lost, user) = (std::mem::take(&mut active.gap_lost), std::mem::take(&mut active.gap_paused));
                                    if lost && !user {
                                        flags |= timing::FLAG_AFTER_SOURCE_LOST;
                                    }
                                }
                            }
                            let record = timing::Record { source_us: emit.source_us, cell: emit.cell as u32, flags };
                            let grid = active.pacer.cell_time(emit.cell);
                            // 被丢的格子没进文件，不算进活动时间线（否则卡顿的那一秒会被看成静止）。
                            // 字节数取编码线程到此刻为止新编出的量：比格子晚几帧，按秒汇总时无碍。
                            let fresh = emit.fresh && !emit.dropped;
                            // 这一帧的记录先落盘，再把帧交给编码：磁盘上的时刻表任何时候都不比已落盘的视频短，
                            // 进程被杀后每一个读得回来的帧都查得到它的时刻。
                            let noted = active.table.append(record).and_then(|_| active.table.flush()).and_then(|_| {
                                if emit.dropped {
                                    Ok(())
                                } else {
                                    active.activity.cell(emit.output, grid, fresh, self.health.encoded_bytes.swap(0, Ordering::Relaxed))
                                }
                            });
                            if let Err(error) = noted {
                                break 'session End::Interrupted(io_failure(&error));
                            }
                            if !emit.dropped {
                                let frame = active.pacer.frame().expect("出格必有帧").clone();
                                if stage.try_frame(frame, emit.output as i64, emit.force_key) {
                                    active.written += 1;
                                }
                            }
                        }
                        Poll::Paused { at_us, cell, output } => {
                            active.paused = true;
                            active.gap_lost |= lost;
                            active.gap_paused |= pause_open;
                            // 空档可能很久：已录的内容现在就落成完整分片。
                            let flushed = stage.flush().and_then(|_| active.table.flush().and_then(|_| active.activity.mark(if lost { "sourceLost" } else { "pause" }, output, at_us)).map_err(|error| io_failure(&error)));
                            if let Err(error) = flushed {
                                break 'session End::Interrupted(error);
                            }
                            self.event("paused", json!({"atUs": at_us, "cell": cell, "frame": output, "reason": if lost { "sourceLost" } else { "user" }}));
                        }
                        Poll::Resumed { at_us, cell, output } => {
                            active.paused = false;
                            if let Err(error) = active.activity.mark("resume", output, at_us) {
                                break 'session End::Interrupted(io_failure(&error));
                            }
                            self.event("resumed", json!({"atUs": at_us, "cell": cell, "frame": output}));
                        }
                        Poll::Finished => break 'session End::Stopped(stop_reply.take().unwrap_or(Value::Null)),
                    }
                }

                if !active.paused && now - last_foreground >= FOREGROUND_INTERVAL_US {
                    last_foreground = now;
                    if let Err(error) = active.activity.foreground(active.pacer.next_output(), now, P::foreground()) {
                        break 'session End::Interrupted(io_failure(&error));
                    }
                }
            }

            let device_lost = || capture.as_ref().is_some_and(|capture| capture.device_lost());
            if let Some(error) = stage.failure() {
                // 设备没了时编码器报的是各式各样的错：对主进程统一说成设备被移除。
                break 'session End::Interrupted(if device_lost() { "DEVICE_REMOVED|显卡设备已重置或被移除，已录部分保留".into() } else { error });
            }

            let size = self.health.source_size.load(Ordering::Relaxed);
            if size != source_size {
                source_size = size;
                // 输出尺寸不变（画面等比缩放、四周留黑）；要不要结束这一段另开新段由主进程决定。
                self.event("sourceChanged", json!({"atUs": now, "width": size >> 32, "height": size & 0xffff_ffff, "frame": recording.as_ref().map(|active| active.pacer.next_output())}));
            }

            let now = P::now_us();
            if now - last_report >= REPORT_INTERVAL_US {
                // 画面静止时没有回调，设备没了只能在这里发现。
                if device_lost() {
                    break 'session End::Interrupted("DEVICE_REMOVED|显卡设备已重置或被移除，已录部分保留".into());
                }
                if let Some(active) = &mut recording {
                    if let Err(error) = active.table.flush().and_then(|_| active.activity.flush()) {
                        break 'session End::Interrupted(io_failure(&error));
                    }
                    let durable = self.health.durable_frames.load(Ordering::Relaxed);
                    if durable != active.durable_reported {
                        active.durable_reported = durable;
                        self.event("fragment", json!({"frames": durable, "bytes": self.health.bytes_written.load(Ordering::Relaxed)}));
                    }
                }
                let stats = capture.as_ref().map(|capture| P::process_stats(capture)).unwrap_or_default();
                let cpu_percent = (stats.cpu_time_us.saturating_sub(last_cpu.1)) as f64 * 100.0 / (now - last_cpu.0).max(1) as f64;
                last_cpu = (now, stats.cpu_time_us);
                let mut report = self.totals(recording.as_ref());
                report["sourceLost"] = json!(lost);
                report["captureQueueMax"] = json!(Health::take(&self.health.capture_queue_max));
                report["captureMaxUs"] = json!(Health::take(&self.health.capture_max_us));
                report["encodeQueue"] = json!(self.health.encode_queue.load(Ordering::Relaxed));
                report["encodeQueueMax"] = json!(Health::take(&self.health.encode_queue_max));
                report["writeQueue"] = json!(self.health.write_queue.load(Ordering::Relaxed));
                report["writeQueueMax"] = json!(Health::take(&self.health.write_queue_max));
                report["encodeMaxUs"] = json!(Health::take(&self.health.encode_max_us));
                report["encodeAvgUs"] = json!(Health::take(&self.health.encode_sum_us) / Health::take(&self.health.encode_count).max(1));
                report["writeMaxUs"] = json!(Health::take(&self.health.write_max_us));
                report["sourceIntervalUs"] = self.health.source_interval.lock().unwrap().summary();
                report["arrivalLatencyUs"] = self.health.arrival_latency.lock().unwrap().summary();
                report["sourceAgeUs"] = json!(now - self.health.last_source_us.load(Ordering::Relaxed));
                // 100 表示占满一个核。
                report["cpuPercent"] = json!((cpu_percent * 10.0).round() / 10.0);
                report["privateBytes"] = json!(stats.private_bytes);
                report["gpuBytes"] = json!(stats.gpu_bytes);
                report["nativeMonoUs"] = json!(now);
                *self.status.lock().unwrap() = report.clone();
                report["event"] = json!("health");
                report["sessionId"] = json!(self.config.session_id);
                self.events.send_lossy(report);
                last_report = now;
            }
        };

        self.state.store(STOPPING, Ordering::Release);
        // 先停采集；收件箱关上，还在路上的回调放进来的帧直接放掉，不占着显存等下一次录制。
        capture.take();
        self.inbox.close();
        drop(preroll);
        let cancelled = matches!(end, End::Cancelled(_));
        let mut error = match &end {
            End::Interrupted(error) => Some(error.clone()),
            _ => None,
        };
        // 一帧都没写：没有可收尾的内容，文件不留。
        let empty = recording.as_ref().is_none_or(|recording| recording.written == 0);
        if let Err(finish_error) = stage.finish() {
            if !cancelled && !empty {
                error.get_or_insert(finish_error);
            }
        }
        let mut result = self.totals(recording.as_ref());
        if let Some(active) = &mut recording {
            let closed = active.table.flush().and_then(|_| active.activity.mark("stop", active.pacer.next_output(), P::now_us()));
            if let Err(close_error) = closed {
                error.get_or_insert(io_failure(&close_error));
            }
        }
        drop(recording);
        if cancelled || empty {
            self.paths.remove_all();
            result["frames"] = json!(0);
        } else {
            result["files"] = self.info["files"].clone();
            let origin = result["originUs"].as_i64();
            if let Err(manifest_error) = self.write_manifest(&self.manifest(origin, Some(&result), error.as_deref())) {
                error.get_or_insert(manifest_error);
            }
        }
        *self.status.lock().unwrap() = result.clone();
        match (end, error) {
            (End::Cancelled(id), _) => {
                if let Some(stop) = stop_reply.take() {
                    self.reply(&stop, Err("INVALID_STATE|录制已取消".into()));
                }
                self.reply(&id, Ok(json!({})));
            }
            (End::Stopped(id), None) => self.reply(&id, Ok(result)),
            (End::Stopped(id), Some(error)) => self.reply(&id, Err(error)),
            (End::Interrupted(_), Some(error)) => {
                // 停止已经在途时出的错：等应答的一方要收到应答，事件照发。
                if let Some(stop) = stop_reply.take() {
                    self.reply(&stop, Err(error.clone()));
                }
                result["error"] = failure(&error);
                self.event("interrupted", result);
            }
            (End::Interrupted(_), None) => {}
        }
        let mut ended = self.ended.lock().unwrap();
        *ended = true;
        self.state.store(ENDED, Ordering::Release);
        while let Ok(control) = self.control.try_recv() {
            let (Control::Start(_, id) | Control::Pause(_, id) | Control::Resume(_, id) | Control::Stop(_, id) | Control::Cancel(id) | Control::Preview(_, id) | Control::Inject(_, id)) = control;
            self.reply(&id, Err("SESSION_MISSING|这次录制已经结束".into()));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::{activity::Foreground, protocol::spawn_streamer};
    use crate::platform::{Notify, ProcessStats};

    static START: Mutex<Option<Instant>> = Mutex::new(None);
    static INBOX: Mutex<Option<(Arc<Inbox<Arc<u32>>>, Arc<Health>)>> = Mutex::new(None);
    static WRITES: Mutex<Vec<(u32, i64, bool)>> = Mutex::new(Vec::new());
    static FLUSHES: Mutex<Vec<usize>> = Mutex::new(Vec::new());

    struct Fake;
    struct FakeCapture;
    impl CaptureControl for FakeCapture {
        fn reacquire(&mut self) -> Result<bool, String> {
            Ok(true)
        }
        fn device_lost(&self) -> bool {
            false
        }
        fn simulate_source_lost(&self) {
            INBOX.lock().unwrap().as_ref().unwrap().0.fail("SOURCE_LOST|测试".into());
        }
        fn start_preview(&self, _: &Value, _: Notify) -> Result<Value, String> {
            Ok(json!({}))
        }
        fn stop_preview(&self) {}
    }
    struct FakeWriter(PathBuf);
    impl FrameWriter<u32> for FakeWriter {
        fn write(&mut self, frame: &u32, pts: i64, force_key: bool) -> Result<u64, String> {
            WRITES.lock().unwrap().push((*frame, pts, force_key));
            Ok(100)
        }
        fn flush_fragment(&mut self) -> Result<(), String> {
            FLUSHES.lock().unwrap().push(WRITES.lock().unwrap().len());
            Ok(())
        }
        fn finish(&mut self) -> Result<(), String> {
            fs::write(&self.0, b"video").map_err(|error| error.to_string())
        }
    }
    impl Platform for Fake {
        type Frame = u32;
        type Capture = FakeCapture;
        type Writer = FakeWriter;
        const NAME: &'static str = "fake";
        const CLOCK: u32 = timing::CLOCK_QPC;
        const CLOCK_NAME: &'static str = "test";
        fn now_us() -> i64 {
            START.lock().unwrap().get_or_insert_with(Instant::now).elapsed().as_micros() as i64 + 1_000_000
        }
        fn sources() -> Result<Value, String> {
            Ok(json!({}))
        }
        fn open(_: &CaptureConfig, video: &Path, _: &Path, inbox: Arc<Inbox<Arc<u32>>>, health: Arc<Health>) -> Result<Opened<Self>, String> {
            *INBOX.lock().unwrap() = Some((inbox, health));
            Ok(Opened { capture: FakeCapture, writer: FakeWriter(video.to_path_buf()), width: 64, height: 36, encoder: "fake".into(), proxy: None, source: json!({}) })
        }
        fn foreground() -> Option<Foreground> {
            Some(Foreground { title: "测试".into(), process: "test.exe".into(), pid: 1 })
        }
        fn process_stats(_: &FakeCapture) -> ProcessStats {
            ProcessStats::default()
        }
    }

    /// 走完整个生命周期：准备 → 开始 → 暂停 → 继续 → 来源丢失又回来 → 停止，
    /// 核对写文件接口收到的帧序号、空档处的落盘与关键帧、时刻表与清单。
    #[test]
    fn lifecycle_writes_contiguous_frames_and_honest_side_files() {
        let directory = tempfile::tempdir().unwrap();
        std::env::set_var(INJECT_SWITCH, "1");
        let (events, streamer) = spawn_streamer();
        crate::core::protocol::OUTPUT_BROKEN.store(true, Ordering::Release);
        let config = CaptureConfig::parse(&json!({
            "sessionId": "t", "directory": directory.path().to_string_lossy(), "source": {"kind": "display"}, "fps": 50,
        }))
        .unwrap();
        let mut session = Session::prepare::<Fake>(config, events).unwrap();
        let (inbox, health) = INBOX.lock().unwrap().clone().unwrap();
        let feeding = Arc::new(std::sync::atomic::AtomicBool::new(true));
        let feeder = {
            let feeding = feeding.clone();
            thread::spawn(move || {
                let mut index = 0u32;
                while feeding.load(Ordering::Acquire) {
                    let now = Fake::now_us();
                    inbox.push(&health, now - 2_000, now, Arc::new(index));
                    index += 1;
                    thread::sleep(Duration::from_millis(20));
                }
            })
        };
        fn send_to(session: &Session, kind: &str, id: u32) -> Result<(), String> {
            session.command(kind, &json!({"id": id}))
        }
        let settle = || thread::sleep(Duration::from_millis(300));
        thread::sleep(Duration::from_millis(100));
        send_to(&session, "pause", 1).unwrap();
        send_to(&session, "start", 2).unwrap();
        settle();
        send_to(&session, "pause", 3).unwrap();
        settle();
        let before_resume = WRITES.lock().unwrap().len();
        send_to(&session, "resume", 4).unwrap();
        settle();
        // 显示器断开：一秒后找回来，这一秒不进文件。
        session.command("inject", &json!({"id": 5, "kind": "sourceLost"})).unwrap();
        thread::sleep(Duration::from_millis(600));
        let before_restore = WRITES.lock().unwrap().len();
        thread::sleep(Duration::from_millis(900));
        send_to(&session, "stop", 6).unwrap();
        send_to(&session, "stop", 7).unwrap();
        session.join();
        assert!(send_to(&session, "pause", 8).is_err());
        feeding.store(false, Ordering::Release);
        feeder.join().unwrap();
        drop(session);
        streamer.join().unwrap();

        let writes = WRITES.lock().unwrap().clone();
        assert!(writes.len() > before_restore + 5, "写了 {} 帧", writes.len());
        assert!(writes.iter().enumerate().all(|(index, (_, pts, _))| *pts == index as i64));
        // 空档期间不写；进空档那一刻把已写的落成分片；空档后的第一帧是关键帧，而且用的是空档期间到的新画面。
        assert_eq!(*FLUSHES.lock().unwrap(), vec![before_resume, before_restore]);
        let keys: Vec<usize> = writes.iter().enumerate().filter(|(_, (_, _, key))| *key).map(|(index, _)| index).collect();
        assert_eq!(keys, vec![0, before_resume, before_restore]);
        assert!(writes[before_resume].0 >= writes[before_resume - 1].0 + 10);

        let paths = Paths::new(directory.path(), "screen");
        let (header, records) = timing::read(&paths.timing).unwrap();
        assert_eq!(records.len(), writes.len());
        assert_eq!(header.fps_num, 50);
        let gap = records[before_resume].cell - records[before_resume - 1].cell;
        assert!((10..=20).contains(&gap), "暂停跨了 {gap} 格");
        let lost_gap = records[before_restore].cell - records[before_restore - 1].cell;
        assert!((40..=65).contains(&lost_gap), "来源丢失跨了 {lost_gap} 格");
        assert!(records[before_resume].flags & timing::FLAG_AFTER_RESUME != 0);
        assert!(records[before_resume].flags & timing::FLAG_AFTER_SOURCE_LOST == 0);
        assert!(records[before_restore].flags & timing::FLAG_AFTER_SOURCE_LOST != 0);
        assert!(records.windows(2).all(|pair| pair[0].source_us <= pair[1].source_us));
        let manifest: Value = serde_json::from_slice(&fs::read(&paths.manifest).unwrap()).unwrap();
        assert_eq!(manifest["completed"], true);
        assert_eq!(manifest["result"]["frames"], writes.len());
        assert_eq!(manifest["originUs"], header.origin_us);
        let activity = fs::read_to_string(&paths.activity).unwrap();
        for kind in ["\"start\"", "\"foreground\"", "\"pause\"", "\"resume\"", "\"sourceLost\"", "\"stop\""] {
            assert!(activity.contains(kind), "活动时间线缺 {kind}");
        }
    }
}
