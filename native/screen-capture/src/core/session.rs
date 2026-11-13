//! 一次录制的生命周期：准备 → 开始 → （暂停 ⇄ 继续）→ 停止 / 取消。
//!
//! 准备好之后采集就在跑（帧进收件箱，只留最新一张），开始的那一刻立刻有画面可用。
//! 会话线程是唯一碰网格、时刻表、活动时间线与写文件接口的线程：
//! 采集回调只往收件箱放帧，主循环只发控制指令；编码或磁盘慢时卡住的是这条线程，网格按积压丢格并如实记录。

use super::{
    activity,
    health::{Health, Inbox},
    pacer::{Pacer, Poll},
    protocol::{failure, io_failure, CaptureConfig, Events, PROTOCOL},
    timing,
};
use crate::platform::{FrameWriter, Opened, Platform};
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU8, Ordering},
        mpsc, Arc, Mutex,
    },
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

/// 收件箱能装多久的来源帧：会话线程（编码）卡住不超过这么久就一帧不丢，之后追上；再久才丢最旧的。
/// 与网格的积压上限（半秒）一致。每张是一块显卡里的 NV12 纹理（4K 约 12 MB），装满时多占几百 MB 显存。
const INBOX_SECONDS_DIVISOR: u32 = 2;
const REPORT_INTERVAL_US: i64 = 1_000_000;
const FOREGROUND_INTERVAL_US: i64 = 250_000;

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

/// 交给会话线程的指令，都带应答号：状态只在会话线程里，由它判断指令合不合时宜并应答，每条恰好一次。
/// 应答号为空值表示没人等应答（标准输入已关）。
enum Control {
    Start(Option<i64>, Value),
    Pause(Option<i64>, Value),
    Resume(Option<i64>, Value),
    /// 文件收尾之后才应答。
    Stop(Option<i64>, Value),
    Cancel(Value),
}

#[derive(Clone)]
pub struct Paths {
    pub video: PathBuf,
    pub timing: PathBuf,
    pub activity: PathBuf,
    pub manifest: PathBuf,
}

impl Paths {
    pub fn new(directory: &Path, name: &str) -> Self {
        Self {
            video: directory.join(format!("{name}.mp4")),
            timing: directory.join(format!("{name}.frames")),
            activity: directory.join(format!("{name}.activity.jsonl")),
            manifest: directory.join(format!("{name}.capture.json")),
        }
    }

    fn file_name(path: &Path) -> String {
        path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default()
    }

    fn remove_all(&self) {
        for path in [&self.video, &self.timing, &self.activity, &self.manifest] {
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
        let inbox = Arc::new(Inbox::<P::Frame>::new((config.fps / INBOX_SECONDS_DIVISOR).max(8) as usize));
        let health = Arc::new(Health::default());
        // 打开到一半失败时视频文件可能已经建好：不留空文件。
        let opened = P::open(&config, &paths.video, inbox.clone(), health.clone()).inspect_err(|_| {
            let _ = fs::remove_file(&paths.video);
        })?;
        let info = json!({
            "sessionId": config.session_id,
            "width": opened.width, "height": opened.height, "fps": config.fps,
            "codec": config.codec.name(), "encoder": opened.encoder, "source": opened.source,
            "files": {
                "video": Paths::file_name(&paths.video), "timing": Paths::file_name(&paths.timing),
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
        };
        let thread = thread::Builder::new().name("capture-session".into()).spawn(move || runner.run()).map_err(|error| format!("CAPTURE_FAILED|无法启动会话线程：{error}"))?;
        Ok(Self { id, info, control, ended, wake: Box::new(move || wake_inbox.signal()), state, status, thread: Some(thread) })
    }

    /// 把 start / pause / resume / stop / cancel 交给会话线程，应答由它发出。
    /// 返回错误时指令没有交出去（会话已结束或指令不认识），由调用方应答。
    pub fn command(&self, kind: &str, at_us: Option<i64>, id: Value) -> Result<(), String> {
        let control = match kind {
            "start" => Control::Start(at_us, id),
            "pause" => Control::Pause(at_us, id),
            "resume" => Control::Resume(at_us, id),
            "stop" => Control::Stop(at_us, id),
            "cancel" => Control::Cancel(id),
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

    pub fn is_ended(&self) -> bool {
        self.thread.as_ref().is_none_or(|thread| thread.is_finished())
    }

    /// 等会话线程收尾完（进程退出前）。
    pub fn join(&mut self) {
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

struct Runner<P: Platform> {
    config: CaptureConfig,
    paths: Paths,
    inbox: Arc<Inbox<P::Frame>>,
    health: Arc<Health>,
    events: Events,
    control: mpsc::Receiver<Control>,
    state: Arc<AtomicU8>,
    ended: Arc<Mutex<bool>>,
    status: Arc<Mutex<Value>>,
    opened: Option<Opened<P>>,
    info: Value,
}

/// 开始之后才有的东西：网格与两份旁路文件。
struct Recording<F> {
    pacer: Pacer<F>,
    table: timing::Writer,
    activity: activity::Writer,
    written: u64,
    durable_reported: u64,
    paused: bool,
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
        Ok(Recording { pacer: Pacer::new(origin_us, self.config.fps, 1), table, activity, written: 0, durable_reported: 0, paused: false })
    }

    fn totals(&self, recording: Option<&Recording<P::Frame>>) -> Value {
        let load = |value: &std::sync::atomic::AtomicU64| value.load(Ordering::Relaxed);
        let mut totals = json!({
            "sourceFrames": load(&self.health.source_frames),
            "captureDropped": load(&self.health.capture_dropped),
            "bytes": load(&self.health.bytes_written),
            "durableFrames": load(&self.health.durable_frames),
        });
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

    fn run(mut self) {
        let Opened { capture, mut writer, .. } = self.opened.take().expect("会话只运行一次");
        let mut capture = Some(capture);
        let mut recording: Option<Recording<P::Frame>> = None;
        // 开始之前只留最新的一张，开始那一刻就有画面。
        let mut preroll: Option<(i64, P::Frame)> = None;
        let mut start_at: Option<i64> = None;
        // 已要求开始、第一帧还没到时收到的暂停与继续（真为暂停）：网格建好后补上。
        let mut early_marks: Vec<(bool, i64)> = Vec::new();
        let mut pause_open = false;
        // 已接受的停止指令的应答号。
        let mut stop_reply: Option<Value> = None;
        let mut next_due = P::now_us();
        let mut last_report = P::now_us();
        let mut last_foreground = 0i64;
        // 最近一次汇报以来写帧（编码）花的总时间与帧数。
        let mut encode_window = (0u64, 0u64);
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
                                    recording.pacer.pause(at);
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
                                    recording.pacer.resume(at);
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
                }
            }

            if recording.is_none() {
                if let (Some(at), Some((source_us, frame))) = (start_at, preroll.take()) {
                    // 手里的画面早于开始时刻：起点就是开始时刻；第一帧在开始之后才到：起点是它的采集时刻。
                    let origin = at.max(source_us);
                    match self.begin(origin) {
                        Ok(mut started) => {
                            started.pacer.push(source_us, frame);
                            for (pause, at) in early_marks.drain(..) {
                                if pause {
                                    started.pacer.pause(at);
                                } else {
                                    started.pacer.resume(at);
                                }
                            }
                            self.event("started", json!({"originUs": origin, "firstSourceUs": source_us}));
                            recording = Some(started);
                            next_due = now;
                        }
                        Err(error) => break 'session End::Interrupted(error),
                    }
                }
            }

            if let Some(active) = &mut recording {
                let mut now = now;
                loop {
                    match active.pacer.poll(now) {
                        Poll::Idle(due) => {
                            next_due = due;
                            break;
                        }
                        Poll::Emit(emit) => {
                            let mut bytes = 0;
                            if !emit.dropped {
                                let frame = active.pacer.frame().expect("出格必有帧");
                                bytes = match writer.write(frame, emit.output as i64, emit.force_key) {
                                    Ok(bytes) => bytes,
                                    Err(error) => break 'session End::Interrupted(error),
                                };
                                active.written += 1;
                                let after = P::now_us();
                                Health::raise(&self.health.encode_max_us, (after - now).max(0) as u64);
                                encode_window = (encode_window.0 + (after - now).max(0) as u64, encode_window.1 + 1);
                                now = after;
                            }
                            let mut flags = 0u16;
                            if emit.fresh {
                                flags |= timing::FLAG_FRESH;
                            }
                            if emit.dropped {
                                flags |= timing::FLAG_DROPPED;
                            }
                            if emit.force_key {
                                flags |= timing::FLAG_KEYFRAME;
                            }
                            if emit.force_key && emit.output > 0 {
                                flags |= timing::FLAG_AFTER_RESUME;
                            }
                            let record = timing::Record { source_us: emit.source_us, cell: emit.cell as u32, flags };
                            let grid = active.pacer.cell_time(emit.cell);
                            // 被丢的格子没进文件，不算进活动时间线（否则卡顿的那一秒会被看成静止）。
                            let noted = active.table.append(record).and_then(|_| if emit.dropped { Ok(()) } else { active.activity.cell(emit.output, grid, emit.fresh, bytes) });
                            if let Err(error) = noted {
                                break 'session End::Interrupted(io_failure(&error));
                            }
                        }
                        Poll::Paused { at_us, cell, output } => {
                            active.paused = true;
                            // 暂停可能很久：已录的内容现在就落成完整分片。
                            let flushed = writer.flush_fragment().and_then(|_| active.table.flush().and_then(|_| active.activity.mark("pause", output, at_us)).map_err(|error| io_failure(&error)));
                            if let Err(error) = flushed {
                                break 'session End::Interrupted(error);
                            }
                            self.event("paused", json!({"atUs": at_us, "cell": cell, "frame": output}));
                        }
                        Poll::Resumed { at_us, cell, output } => {
                            active.paused = false;
                            if let Err(error) = active.activity.mark("resume", output, at_us) {
                                break 'session End::Interrupted(io_failure(&error));
                            }
                            self.event("resumed", json!({"atUs": at_us, "cell": cell, "frame": output}));
                        }
                        Poll::Finished => {
                            break 'session End::Stopped(stop_reply.take().unwrap_or(Value::Null));
                        }
                    }
                }

                if !active.paused && now - last_foreground >= FOREGROUND_INTERVAL_US {
                    last_foreground = now;
                    if let Err(error) = active.activity.foreground(active.pacer.next_output(), now, P::foreground()) {
                        break 'session End::Interrupted(io_failure(&error));
                    }
                }
            }

            if let Some(error) = capture_failure {
                break 'session End::Interrupted(error);
            }

            let now = P::now_us();
            if now - last_report >= REPORT_INTERVAL_US {
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
                report["captureQueueMax"] = json!(Health::take(&self.health.capture_queue_max));
                report["captureMaxUs"] = json!(Health::take(&self.health.capture_max_us));
                report["writeQueue"] = json!(self.health.write_queue.load(Ordering::Relaxed));
                report["writeQueueMax"] = json!(Health::take(&self.health.write_queue_max));
                report["encodeMaxUs"] = json!(Health::take(&self.health.encode_max_us));
                report["encodeAvgUs"] = json!(encode_window.0 / encode_window.1.max(1));
                encode_window = (0, 0);
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
        let cancelled = matches!(end, End::Cancelled(_));
        let mut error = match &end {
            End::Interrupted(error) => Some(error.clone()),
            _ => None,
        };
        // 一帧都没写：没有可收尾的内容，文件不留。
        let empty = recording.as_ref().is_none_or(|recording| recording.written == 0);
        if let Err(finish_error) = writer.finish() {
            if !cancelled && !empty {
                error.get_or_insert(finish_error);
            }
        }
        drop(writer);
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
            let (Control::Start(_, id) | Control::Pause(_, id) | Control::Resume(_, id) | Control::Stop(_, id) | Control::Cancel(id)) = control;
            self.reply(&id, Err("SESSION_MISSING|这次录制已经结束".into()));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::{activity::Foreground, protocol::spawn_streamer};
    use crate::platform::ProcessStats;
    use std::time::Instant;

    static START: Mutex<Option<Instant>> = Mutex::new(None);
    static INBOX: Mutex<Option<(Arc<Inbox<u32>>, Arc<Health>)>> = Mutex::new(None);
    static WRITES: Mutex<Vec<(u32, i64, bool)>> = Mutex::new(Vec::new());
    static FLUSHES: Mutex<Vec<usize>> = Mutex::new(Vec::new());

    struct Fake;
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
        type Capture = ();
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
        fn open(_: &CaptureConfig, video: &Path, inbox: Arc<Inbox<u32>>, health: Arc<Health>) -> Result<Opened<Self>, String> {
            *INBOX.lock().unwrap() = Some((inbox, health));
            Ok(Opened { capture: (), writer: FakeWriter(video.to_path_buf()), width: 64, height: 36, encoder: "fake".into(), source: json!({}) })
        }
        fn foreground() -> Option<Foreground> {
            Some(Foreground { title: "测试".into(), process: "test.exe".into(), pid: 1 })
        }
        fn process_stats(_: &()) -> ProcessStats {
            ProcessStats::default()
        }
    }

    /// 走完整个生命周期：准备 → 开始 → 暂停 → 继续 → 停止，核对写文件接口收到的帧序号、时刻表与清单。
    #[test]
    fn lifecycle_writes_contiguous_frames_and_honest_side_files() {
        let directory = tempfile::tempdir().unwrap();
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
                    inbox.push(&health, now - 2_000, now, index);
                    index += 1;
                    thread::sleep(Duration::from_millis(20));
                }
            })
        };
        thread::sleep(Duration::from_millis(100));
        session.command("pause", None, json!(1)).unwrap();
        session.command("start", None, json!(2)).unwrap();
        thread::sleep(Duration::from_millis(300));
        session.command("pause", None, json!(3)).unwrap();
        thread::sleep(Duration::from_millis(300));
        let before_resume = WRITES.lock().unwrap().len();
        session.command("resume", None, json!(4)).unwrap();
        thread::sleep(Duration::from_millis(300));
        session.command("stop", None, json!(5)).unwrap();
        session.command("stop", None, json!(6)).unwrap();
        session.join();
        assert!(session.command("pause", None, json!(7)).is_err());
        feeding.store(false, Ordering::Release);
        feeder.join().unwrap();
        drop(session);
        streamer.join().unwrap();

        let writes = WRITES.lock().unwrap().clone();
        assert!(writes.len() >= 20, "写了 {} 帧", writes.len());
        assert!(writes.iter().enumerate().all(|(index, (_, pts, _))| *pts == index as i64));
        // 暂停期间不写；暂停那一刻把已写的落成分片；继续后第一帧是关键帧，而且用的是暂停期间到的新画面。
        assert_eq!(*FLUSHES.lock().unwrap(), vec![before_resume]);
        let keys: Vec<usize> = writes.iter().enumerate().filter(|(_, (_, _, key))| *key).map(|(index, _)| index).collect();
        assert_eq!(keys, vec![0, before_resume]);
        assert!(writes[before_resume].0 >= writes[before_resume - 1].0 + 10);

        let paths = Paths::new(directory.path(), "screen");
        let (header, records) = timing::read(&paths.timing).unwrap();
        assert_eq!(records.len(), writes.len());
        assert_eq!(header.fps_num, 50);
        let gap = records[before_resume].cell - records[before_resume - 1].cell;
        assert!((10..=20).contains(&gap), "暂停跨了 {gap} 格");
        assert!(records[before_resume].flags & timing::FLAG_AFTER_RESUME != 0);
        assert!(records.windows(2).all(|pair| pair[0].source_us <= pair[1].source_us));
        let manifest: Value = serde_json::from_slice(&fs::read(&paths.manifest).unwrap()).unwrap();
        assert_eq!(manifest["completed"], true);
        assert_eq!(manifest["result"]["frames"], writes.len());
        assert_eq!(manifest["originUs"], header.origin_us);
        let activity = fs::read_to_string(&paths.activity).unwrap();
        for kind in ["\"start\"", "\"foreground\"", "\"pause\"", "\"resume\"", "\"stop\""] {
            assert!(activity.contains(kind), "活动时间线缺 {kind}");
        }
    }
}
