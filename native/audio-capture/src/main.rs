mod ffi;
mod system_audio;
#[cfg(windows)]
mod wasapi;
mod wav;
use crossbeam_queue::ArrayQueue;
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    cell::UnsafeCell,
    ffi::{c_int, c_ulong, c_void},
    io::{self, BufRead, Write},
    path::Path,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc, Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use system_audio::SystemSession;
use wav::Wav;

/// 协议 3：系统声会话（startSystemAudio、segment/device/systemHealth 事件）。新旧程序不配套时在握手就失败。
const PROTOCOL: u32 = 3;
/// PortAudio 只在第一次用到麦克风时初始化：只录系统声的进程从不加载 ASIO 等驱动，不会与另一进程里的麦克风抢驱动。
static PORTAUDIO: AtomicBool = AtomicBool::new(false);
fn portaudio() -> Result<(), String> {
    if !PORTAUDIO.load(Ordering::Acquire) {
        ffi::check(unsafe { ffi::hc_init() }, false)?;
        PORTAUDIO.store(true, Ordering::Release);
    }
    Ok(())
}

// stdout: u32 LE JSON 长度 + UTF-8 JSON + binaryBytes 字节的交错 float32 LE PCM。
static OUTPUT: Mutex<()> = Mutex::new(());
/// 宿主读端已关闭：之后的输出全部丢弃，由主循环正常收尾 WAV 后退出，不在写盘中途被杀。
static OUTPUT_BROKEN: AtomicBool = AtomicBool::new(false);
fn emit(mut value: Value, binary: &[u8]) {
    if OUTPUT_BROKEN.load(Ordering::Acquire) {
        return;
    }
    value["binaryBytes"] = json!(binary.len());
    let bytes = serde_json::to_vec(&value).unwrap();
    let _guard = OUTPUT.lock().unwrap();
    let mut out = io::stdout().lock();
    if out
        .write_all(&(bytes.len() as u32).to_le_bytes())
        .and_then(|_| out.write_all(&bytes))
        .and_then(|_| out.write_all(binary))
        .and_then(|_| out.flush())
        .is_err()
    {
        OUTPUT_BROKEN.store(true, Ordering::Release);
    }
}
fn failure(message: &str) -> Value {
    let (code, text) = message
        .split_once('|')
        .unwrap_or(("CAPTURE_FAILED", message));
    json!({"code":code,"message":text,"recoverable":true})
}
fn io_error(e: io::Error) -> String {
    let full = matches!(e.raw_os_error(), Some(28 | 112 | 39));
    format!(
        "{}|{}：{}",
        if full { "DISK_FULL" } else { "FILE_ERROR" },
        if full {
            "磁盘空间不足，已录部分保留，请释放空间后恢复文件"
        } else {
            "录音文件读写失败，已录部分保留"
        },
        e
    )
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Settings {
    device: i32,
    host_api: String,
    first_channel: i32,
    channels: i32,
    sample_rate: i32,
    bit_depth: i32,
    buffer_frames: i32,
    suggested_latency: f64,
    exclusive: bool,
}
impl Settings {
    fn options(&self) -> Result<ffi::Options, String> {
        if !(1..=2).contains(&self.channels)
            || self.first_channel < 0
            || self.first_channel > 255
            || !RATES.contains(&self.sample_rate)
            || ![16, 24, 32].contains(&self.bit_depth)
            || !(0..=8192).contains(&self.buffer_frames)
            || !self.suggested_latency.is_finite()
            || !(0.0..=2.0).contains(&self.suggested_latency)
        {
            return Err("INVALID_ARGUMENT|录音参数超出范围".into());
        }
        let d = ffi::device(self.device)?;
        if ffi::name(d.api) != self.host_api {
            return Err("DEVICE_REMOVED|设备列表已变化，请重新枚举并选择设备".into());
        }
        Ok(ffi::Options {
            device: self.device,
            first: self.first_channel,
            channels: self.channels,
            rate: self.sample_rate,
            format: self.bit_depth,
            frames: self.buffer_frames,
            latency: self.suggested_latency,
            exclusive: self.exclusive as i32,
        })
    }
}
const RATES: [i32; 11] = [
    8000, 11025, 16000, 22050, 32000, 44100, 48000, 88200, 96000, 176400, 192000,
];
const PA_INPUT_UNDERFLOW: u64 = 1;
const PA_INPUT_OVERFLOW: u64 = 2;
/// 单块上限；协议与渲染层按 1024 帧、双声道 float32（8 KB）设计。
const BLOCK_FRAMES: usize = 1024;
/// 采集到写盘之间的缓冲。回调块先合并再入队，每块 512–1024 帧：4096 块在 48 kHz 约 44–87 秒、192 kHz 约 11–22 秒，
/// 磁盘或系统卡顿几十秒都不会丢采样；整队约 34 MB，长录音不能断，内存按宽的给。宿主停止时要等它排空，超时按这个上限给。
const QUEUE_BLOCKS: usize = 4096;
/// 写盘线程交给推流线程的消息上限（采样与电平合计，48 kHz 下约 30–50 秒，最多约 35 MB）。主进程不读管道时只丢推送，写盘不等它；
/// 录屏、讲解的麦克风轨就是用推送写的，所以给得宽。
const PREVIEW_MESSAGES: usize = 4096;
#[derive(Clone, Copy)]
struct Block {
    samples: [f32; 2048],
    frames: usize,
    mono_us: f64,
    uncertainty: f64,
    flags: u64,
    /// 本块之前因队列满而没能入队的帧数；写盘时补成等长静音。
    lost_before: u64,
}
const EMPTY_BLOCK: Block = Block {
    samples: [0.0; 2048],
    frames: 0,
    mono_us: 0.0,
    uncertainty: 0.0,
    flags: 0,
    lost_before: 0,
};
struct Shared {
    queue: ArrayQueue<Block>,
    /// 回调线程的合并块与入队失败累计帧数。只在音频回调里读写，或在流停止（hc_stop 返回）后由控制线程收尾。
    pending: UnsafeCell<Block>,
    lost: UnsafeCell<u64>,
    stop: AtomicBool,
    failed: AtomicBool,
    frames: AtomicU64,
    bytes: AtomicU64,
    callback_frames: AtomicU64,
    last_callback_us: AtomicU64,
    input_overflows: AtomicU64,
    input_underflows: AtomicU64,
    dropped_frames: AtomicU64,
    dropped_preview: AtomicU64,
    max_write_us: AtomicU64,
    last_glitch_frame: AtomicU64,
    channels: usize,
}
// pending 与 lost 的两个访问方（音频回调、流停止后的控制线程）在时间上互斥，其余字段都是原子量。
unsafe impl Sync for Shared {}
impl Shared {
    fn new(channels: usize, capacity: usize) -> Self {
        Self {
            queue: ArrayQueue::new(capacity),
            pending: UnsafeCell::new(EMPTY_BLOCK),
            lost: UnsafeCell::new(0),
            stop: AtomicBool::new(false),
            failed: AtomicBool::new(false),
            frames: AtomicU64::new(0),
            bytes: AtomicU64::new(0),
            callback_frames: AtomicU64::new(0),
            last_callback_us: AtomicU64::new(ffi::clock() as u64),
            input_overflows: AtomicU64::new(0),
            input_underflows: AtomicU64::new(0),
            dropped_frames: AtomicU64::new(0),
            dropped_preview: AtomicU64::new(0),
            max_write_us: AtomicU64::new(0),
            last_glitch_frame: AtomicU64::new(0),
            channels,
        }
    }
    /// 采集健康计数：只记录，不中断录音；结束汇总和主进程日志都用它。
    fn health(&self, rate: f64) -> Value {
        json!({
            "inputOverflows": self.input_overflows.load(Ordering::Relaxed),
            "inputUnderflows": self.input_underflows.load(Ordering::Relaxed),
            "droppedFrames": self.dropped_frames.load(Ordering::Relaxed),
            "droppedPreviewBlocks": self.dropped_preview.load(Ordering::Relaxed),
            "maxWriteMs": self.max_write_us.load(Ordering::Relaxed) as f64 / 1000.0,
            "lastGlitchSeconds": self.last_glitch_frame.load(Ordering::Relaxed) as f64 / rate,
        })
    }
    fn health_signature(&self) -> [u64; 5] {
        [
            self.input_overflows.load(Ordering::Relaxed),
            self.input_underflows.load(Ordering::Relaxed),
            self.dropped_frames.load(Ordering::Relaxed),
            self.dropped_preview.load(Ordering::Relaxed),
            // 写盘峰值按 100 ms 一档上报，小抖动不刷日志。
            self.max_write_us.load(Ordering::Relaxed) / 100_000,
        ]
    }
}
/// 把一次回调的采样并入合并块；带溢出/欠载标记的回调单独成块，写盘时能定位到发生处。
/// Safety：只能在音频回调线程，或流已停止后的控制线程调用。
unsafe fn accept(
    shared: &Shared,
    input: &[f32],
    count: usize,
    mono_us: f64,
    uncertainty: f64,
    flags: u64,
) {
    let pending = &mut *shared.pending.get();
    let glitch = flags & (PA_INPUT_UNDERFLOW | PA_INPUT_OVERFLOW) != 0;
    if pending.frames > 0 && (glitch || pending.frames + count > BLOCK_FRAMES) {
        flush(shared);
    }
    let ch = shared.channels;
    if pending.frames == 0 {
        pending.mono_us = mono_us;
        pending.uncertainty = uncertainty;
    }
    pending.samples[pending.frames * ch..(pending.frames + count) * ch].copy_from_slice(input);
    pending.frames += count;
    pending.flags |= flags;
    pending.uncertainty = pending.uncertainty.max(uncertainty);
    // 预计下一次同样大小的回调放不下时立即入队，不让整块多等一个回调周期。
    if glitch || pending.frames + count > BLOCK_FRAMES {
        flush(shared);
    }
}
/// Safety：同 accept。
unsafe fn flush(shared: &Shared) {
    let pending = &mut *shared.pending.get();
    if pending.frames == 0 {
        return;
    }
    let lost = &mut *shared.lost.get();
    pending.lost_before = *lost;
    if shared.queue.push(*pending).is_ok() {
        *lost = 0;
    } else {
        *lost += pending.frames as u64;
        shared
            .dropped_frames
            .fetch_add(pending.frames as u64, Ordering::Relaxed);
    }
    pending.frames = 0;
    pending.flags = 0;
    pending.lost_before = 0;
}
/// 流停止后（结束或暂停）把最后入队失败的帧也交给写盘补静音：等写盘腾出一个位置，用不带采样的空块带上丢帧数。
/// Safety：只能在流已停止、写盘线程仍在运行时由控制线程调用。
unsafe fn settle_lost(shared: &Shared) {
    let lost = &mut *shared.lost.get();
    if *lost == 0 {
        return;
    }
    let marker = Block {
        lost_before: *lost,
        ..EMPTY_BLOCK
    };
    while shared.queue.push(marker).is_err() {
        if shared.failed.load(Ordering::Acquire) {
            return;
        }
        thread::sleep(Duration::from_millis(1));
    }
    *lost = 0;
}
extern "C" fn sink(
    user: *mut c_void,
    samples: *const f32,
    frames: c_int,
    mono_us: f64,
    uncertainty: f64,
    flags: c_ulong,
    callback_frames: c_ulong,
) {
    let shared = unsafe { &*(user as *const Shared) };
    shared
        .last_callback_us
        .store(ffi::clock() as u64, Ordering::Relaxed);
    shared
        .callback_frames
        .store(callback_frames as u64, Ordering::Relaxed);
    let count = frames.max(0) as usize;
    if count == 0 || count > BLOCK_FRAMES {
        return;
    }
    let input = unsafe { std::slice::from_raw_parts(samples, count * shared.channels) };
    unsafe { accept(shared, input, count, mono_us, uncertainty, flags as u64) }
}
struct Session {
    id: String,
    path: String,
    capture: *mut c_void,
    shared: Arc<Shared>,
    worker: Option<thread::JoinHandle<Result<(), String>>>,
    streamer: Option<thread::JoinHandle<()>>,
    /// 控制线程上报健康计数也走推流通道，主进程不读管道时不会卡住控制线程。
    reports: Option<mpsc::SyncSender<(Value, Vec<u8>)>>,
    paused: bool,
    rate: f64,
    latency: f64,
    health_sent: [u64; 5],
    health_at: Instant,
}
impl Session {
    fn start(id: String, path: String, settings: Settings, stream: bool) -> Result<Self, String> {
        let mut options = settings.options()?;
        let shared = Arc::new(Shared::new(settings.channels as usize, QUEUE_BLOCKS));
        let (mut error, mut rate, mut latency) = (0, 0.0, 0.0);
        let capture = unsafe {
            ffi::hc_open(
                &mut options,
                sink,
                Arc::as_ptr(&shared) as *mut c_void,
                &mut error,
                &mut rate,
                &mut latency,
            )
        };
        ffi::check(error, settings.exclusive)?;
        let wav = match Wav::create(
            Path::new(&path),
            rate.round() as u32,
            settings.channels as u16,
            settings.bit_depth as u16,
        ) {
            Ok(w) => w,
            Err(e) => {
                unsafe {
                    ffi::hc_close(capture);
                }
                return Err(io_error(e));
            }
        };
        let (preview, previews) = mpsc::sync_channel::<(Value, Vec<u8>)>(PREVIEW_MESSAGES);
        let streamer = thread::spawn(move || {
            for (value, binary) in previews {
                emit(value, &binary);
            }
        });
        let s = shared.clone();
        let sid = id.clone();
        let reports = preview.clone();
        let worker = thread::spawn(move || write_audio(s, sid, wav, rate, stream, preview));
        let mut session = Self {
            id,
            path,
            capture,
            shared,
            worker: Some(worker),
            streamer: Some(streamer),
            reports: Some(reports),
            paused: false,
            rate,
            latency,
            health_sent: [0; 5],
            health_at: Instant::now(),
        };
        if let Err(e) = ffi::check(unsafe { ffi::hc_start(capture) }, settings.exclusive) {
            let _ = session.close();
            return Err(e);
        }
        Ok(session)
    }
    fn status(&self) -> Value {
        json!({"sessionId":self.id,"outputPath":self.path,"state":if self.paused {"paused"} else {"recording"},"sampleRate":self.rate,"inputLatency":self.latency,"callbackFrames":self.shared.callback_frames.load(Ordering::Relaxed),"frames":self.shared.frames.load(Ordering::Acquire),"writtenBytes":self.shared.bytes.load(Ordering::Acquire),"durationSeconds":self.shared.frames.load(Ordering::Acquire) as f64 / self.rate,"health":self.shared.health(self.rate)})
    }
    /// 计数有变化时最多每秒报一次；通道满了这一秒先不报，计数是累计值，下一次照样带全。
    fn report_health(&mut self) {
        let signature = self.shared.health_signature();
        if signature == self.health_sent || self.health_at.elapsed() < Duration::from_secs(1) {
            return;
        }
        self.health_at = Instant::now();
        let Some(reports) = &self.reports else {
            return;
        };
        let report = json!({"event":"health","sessionId":self.id,"durationSeconds":self.shared.frames.load(Ordering::Acquire) as f64 / self.rate,"health":self.shared.health(self.rate)});
        if reports.try_send((report, Vec::new())).is_ok() {
            self.health_sent = signature;
        }
    }
    fn stop_stream(&mut self) -> i32 {
        let code = unsafe { ffi::hc_stop(self.capture) };
        // 回调已经停下，合并块里剩下的采样与最后没能入队的丢帧数由控制线程交给写盘。
        unsafe {
            flush(&self.shared);
            settle_lost(&self.shared);
        }
        code
    }
    fn close(&mut self) -> Result<Value, String> {
        if self.capture.is_null() {
            return Ok(self.status());
        }
        self.stop_stream();
        unsafe {
            ffi::hc_close(self.capture);
        }
        self.capture = std::ptr::null_mut();
        self.shared.stop.store(true, Ordering::Release);
        let written = self.worker.take().map(|worker| worker.join());
        // 写盘线程结束、控制线程放开上报端后推流通道关闭；等推流线程把已排队的消息发完，结束回复排在它们之后。
        self.reports = None;
        if let Some(streamer) = self.streamer.take() {
            let _ = streamer.join();
        }
        if let Some(written) = written {
            written
                .map_err(|_| "CAPTURE_FAILED|录音写入线程异常，已录部分可恢复".to_string())??;
        }
        let mut result = self.status();
        result["state"] = json!("stopped");
        Ok(result)
    }
}
impl Drop for Session {
    fn drop(&mut self) {
        let _ = self.close();
    }
}
fn write_audio(
    shared: Arc<Shared>,
    id: String,
    mut wav: Wav,
    rate: f64,
    stream: bool,
    preview: mpsc::SyncSender<(Value, Vec<u8>)>,
) -> Result<(), String> {
    let ch = shared.channels;
    let mut sequence = 0u64;
    let mut peak = vec![0.0f32; ch];
    let mut sum = vec![0.0f64; ch];
    let mut meter_frames = 0usize;
    let mut checkpoint = Instant::now();
    let silence = [0.0f32; 2048];
    // 预览与电平只是观察数据：通道满了直接丢，写盘线程绝不等主进程读管道。
    let offer = |value: Value, binary: Vec<u8>| preview.try_send((value, binary)).is_ok();
    let result = (|| {
        loop {
            let Some(block) = shared.queue.pop() else {
                if shared.stop.load(Ordering::Acquire) {
                    break;
                }
                thread::sleep(Duration::from_millis(2));
                continue;
            };
            let started = Instant::now();
            if block.lost_before > 0 {
                // 写盘跟不上、队列满时丢掉的采样补成等长静音：文件时长仍等于实际录制时长，后面的声音不会整体提前。
                shared
                    .last_glitch_frame
                    .store(shared.frames.load(Ordering::Acquire), Ordering::Relaxed);
                let mut left = block.lost_before as usize;
                while left > 0 {
                    let n = left.min(BLOCK_FRAMES);
                    wav.write(&silence[..n * ch]).map_err(io_error)?;
                    left -= n;
                }
                shared.frames.fetch_add(block.lost_before, Ordering::AcqRel);
                shared.bytes.store(wav.bytes, Ordering::Release);
            }
            if block.frames == 0 {
                // 只带丢帧数的收尾块：静音已补，没有采样可推。
                continue;
            }
            if block.flags & (PA_INPUT_UNDERFLOW | PA_INPUT_OVERFLOW) != 0 {
                // 驱动报一次溢出或欠载只计数并记下位置，继续录；只有设备没了或写盘失败才结束。
                if block.flags & PA_INPUT_OVERFLOW != 0 {
                    shared.input_overflows.fetch_add(1, Ordering::Relaxed);
                }
                if block.flags & PA_INPUT_UNDERFLOW != 0 {
                    shared.input_underflows.fetch_add(1, Ordering::Relaxed);
                }
                shared
                    .last_glitch_frame
                    .store(shared.frames.load(Ordering::Acquire), Ordering::Relaxed);
            }
            let samples = &block.samples[..block.frames * ch];
            wav.write(samples).map_err(io_error)?;
            let first_frame = shared
                .frames
                .fetch_add(block.frames as u64, Ordering::AcqRel);
            shared.bytes.store(wav.bytes, Ordering::Release);
            if checkpoint.elapsed() >= Duration::from_secs(1) {
                wav.checkpoint().map_err(io_error)?;
                checkpoint = Instant::now();
            }
            shared
                .max_write_us
                .fetch_max(started.elapsed().as_micros() as u64, Ordering::Relaxed);
            for (i, &sample) in samples.iter().enumerate() {
                let c = i % ch;
                peak[c] = peak[c].max(sample.abs());
                sum[c] += (sample as f64).powi(2);
            }
            meter_frames += block.frames;
            if stream {
                let bytes: Vec<u8> = samples.iter().flat_map(|s| s.to_le_bytes()).collect();
                let sent = offer(
                    json!({"event":"samples","sessionId":id,"sequence":sequence,"firstFrame":first_frame,"frames":block.frames,"channels":ch,"sampleRate":rate,"nativeMonoUs":block.mono_us,"uncertaintyUs":block.uncertainty,"format":"float32le"}),
                    bytes,
                );
                if !sent {
                    shared.dropped_preview.fetch_add(1, Ordering::Relaxed);
                }
            }
            sequence += 1;
            if meter_frames as f64 / rate >= 0.033 {
                let rms: Vec<f64> = sum
                    .iter()
                    .map(|s| (s / meter_frames as f64).sqrt())
                    .collect();
                let clipped: Vec<bool> = peak.iter().map(|p| *p >= 0.999969).collect();
                // 电平丢一条不计数：下一条 33 ms 后就会覆盖它。
                offer(
                    json!({"event":"level","sessionId":id,"peak":peak,"rms":rms,"clipped":clipped,"durationSeconds":(first_frame+block.frames as u64) as f64/rate,"writtenBytes":wav.bytes}),
                    Vec::new(),
                );
                peak.fill(0.0);
                sum.fill(0.0);
                meter_frames = 0;
            }
        }
        Ok(())
    })();
    let saved = wav.checkpoint().map_err(io_error);
    if result.is_err() || saved.is_err() {
        shared.failed.store(true, Ordering::Release);
    }
    result.and(saved)
}
fn command(
    v: &Value,
    session: &mut Option<Session>,
    systems: &mut Vec<SystemSession>,
) -> Result<Value, String> {
    let text = |key: &str| -> Result<String, String> {
        v[key]
            .as_str()
            .filter(|s| !s.is_empty() && s.len() < 4096)
            .map(str::to_string)
            .ok_or_else(|| format!("INVALID_ARGUMENT|缺少参数 {key}"))
    };
    let kind = text("type")?;
    // 系统声会话与麦克风会话互不影响，停止、查询按会话号分开。
    if matches!(kind.as_str(), "pause" | "resume" | "stop" | "status") {
        let id = text("sessionId")?;
        if let Some(index) = systems.iter().position(|s| s.id == id) {
            return match kind.as_str() {
                "stop" => systems.remove(index).close(),
                "status" => Ok(systems[index].status()),
                _ => Err("INVALID_ARGUMENT|系统声音不支持暂停，请停止后重新开始".into()),
            };
        }
    }
    match kind.as_str() {
        "hello" => Ok(
            json!({"protocol":PROTOCOL,"nativeMonoUs":ffi::clock(),"asioCompiled":unsafe{ffi::hc_asio()}!=0,"monitoringSupported":false,"systemAudio":cfg!(windows)}),
        ),
        "clock" => Ok(json!({"nativeMonoUs":ffi::clock()})),
        "startSystemAudio" => {
            let s = SystemSession::start(text("sessionId")?, text("directory")?)?;
            let status = s.status();
            systems.push(s);
            Ok(status)
        }
        "enumerate" => {
            if session.is_some() {
                return Err("RECORDING_ACTIVE|请停止录音后刷新设备列表".into());
            }
            if PORTAUDIO.swap(false, Ordering::AcqRel) {
                unsafe {
                    ffi::hc_terminate();
                }
            }
            portaudio()?;
            ffi::enumerate()
        }
        "probe" => {
            if session.is_some() {
                return Err("RECORDING_ACTIVE|请停止录音后探测设备格式".into());
            }
            portaudio()?;
            let settings: Settings = serde_json::from_value(v["settings"].clone())
                .map_err(|e| format!("INVALID_ARGUMENT|{e}"))?;
            let mut options = settings.options()?;
            let mut formats = Vec::new();
            for rate in RATES {
                for bits in [16, 24, 32] {
                    options.rate = rate;
                    options.format = bits;
                    formats.push(json!({"sampleRate":rate,"bitDepth":bits,"supported":unsafe{ffi::hc_probe(&mut options)}==0}));
                }
            }
            Ok(json!({"formats":formats}))
        }
        "start" => {
            if session.is_some() {
                return Err("RECORDING_ACTIVE|已有录音，请先停止".into());
            }
            portaudio()?;
            let settings: Settings = serde_json::from_value(v["settings"].clone())
                .map_err(|e| format!("INVALID_ARGUMENT|{e}"))?;
            let s = Session::start(
                text("sessionId")?,
                text("outputPath")?,
                settings,
                v["streamSamples"].as_bool().unwrap_or(false),
            )?;
            let status = s.status();
            *session = Some(s);
            Ok(status)
        }
        "pause" | "resume" | "stop" | "status" => {
            let s = session.as_mut().ok_or("SESSION_MISSING|录音会话已结束")?;
            if text("sessionId")? != s.id {
                return Err("SESSION_MISSING|录音会话不匹配".into());
            }
            match v["type"].as_str().unwrap() {
                "stop" => session.take().unwrap().close(),
                "pause" => {
                    if !s.paused {
                        ffi::check(s.stop_stream(), false)?;
                        s.paused = true;
                    }
                    Ok(s.status())
                }
                "resume" => {
                    if s.paused {
                        s.shared
                            .last_callback_us
                            .store(ffi::clock() as u64, Ordering::Relaxed);
                        ffi::check(unsafe { ffi::hc_start(s.capture) }, false)?;
                        s.paused = false;
                    }
                    Ok(s.status())
                }
                _ => Ok(s.status()),
            }
        }
        "asioPanel" => {
            if session.is_some() {
                return Err("RECORDING_ACTIVE|请停止录音后打开驱动设置".into());
            }
            portaudio()?;
            let device = v["device"]
                .as_i64()
                .filter(|d| *d >= 0 && *d <= i32::MAX as i64)
                .ok_or("INVALID_ARGUMENT|缺少设备")? as i32;
            if ffi::device(device)?.api != 3 {
                return Err("FORMAT_UNSUPPORTED|所选设备不是 ASIO 驱动".into());
            }
            ffi::check(unsafe { ffi::hc_panel(device) }, false)?;
            Ok(json!({}))
        }
        "recover" => {
            if session.is_some() {
                return Err("RECORDING_ACTIVE|请停止录音后恢复文件".into());
            }
            Ok(
                json!({"writtenBytes":Wav::recover(Path::new(&text("outputPath")?)).map_err(io_error)?}),
            )
        }
        _ => Err("INVALID_ARGUMENT|未知录音指令".into()),
    }
}
fn main() {
    let (tx, rx) = mpsc::sync_channel(32);
    thread::spawn(move || {
        for line in io::stdin().lock().lines() {
            match line {
                Ok(s) if s.len() <= 65536 => {
                    if tx.send(s).is_err() {
                        break;
                    }
                }
                _ => break,
            }
        }
    });
    let mut session: Option<Session> = None;
    let mut systems: Vec<SystemSession> = Vec::new();
    loop {
        match rx.recv_timeout(Duration::from_millis(100)) {
            Ok(line) => match serde_json::from_str::<Value>(&line) {
                Ok(v) => {
                    let id = v["id"].clone();
                    match command(&v, &mut session, &mut systems) {
                        Ok(result) => emit(json!({"id":id,"ok":true,"result":result}), &[]),
                        Err(e) => emit(json!({"id":id,"ok":false,"error":failure(&e)}), &[]),
                    }
                }
                Err(e) => emit(
                    json!({"id":null,"ok":false,"error":failure(&format!("INVALID_ARGUMENT|{e}"))}),
                    &[],
                ),
            },
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }
        if OUTPUT_BROKEN.load(Ordering::Acquire) {
            break;
        }
        if let Some(s) = &mut session {
            s.report_health();
            // 有的驱动拔出后仍报告 active；超过最大建议延迟仍无回调也应保留并结束。
            let stalled = ffi::clock() - s.shared.last_callback_us.load(Ordering::Relaxed) as f64
                > 5_000_000.0;
            let disconnected = !s.paused && (unsafe { ffi::hc_active(s.capture) } != 1 || stalled);
            if s.shared.failed.load(Ordering::Acquire) || disconnected {
                let mut s = session.take().unwrap();
                let error = s.close().err().unwrap_or(
                    "DEVICE_REMOVED|设备已停止提供采样，请检查连接；已录部分保留".into(),
                );
                emit(
                    json!({"event":"interrupted","sessionId":s.id,"outputPath":s.path,"error":failure(&error),"writtenBytes":s.shared.bytes.load(Ordering::Acquire),"health":s.shared.health(s.rate)}),
                    &[],
                );
            }
        }
        // 系统声只有写盘失败（磁盘满、文件出错）才结束；设备没了、换了都补静音继续。
        for s in systems.iter_mut() {
            s.report_health();
        }
        while let Some(index) = systems
            .iter()
            .position(|s| s.shared.failed.load(Ordering::Acquire))
        {
            let mut s = systems.remove(index);
            let error = s
                .close()
                .err()
                .unwrap_or("FILE_ERROR|系统声音写入失败，已录部分保留".into());
            emit(
                json!({"event":"interrupted","sessionId":s.id,"outputPath":s.directory(),"error":failure(&error),"writtenBytes":s.shared.bytes.load(Ordering::Acquire)}),
                &[],
            );
        }
    }
    drop(session);
    drop(systems);
    if PORTAUDIO.load(Ordering::Acquire) {
        unsafe {
            ffi::hc_terminate();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn feed(shared: &Shared, blocks: usize, frames: usize, flags_at: Option<usize>) {
        let input = vec![0.25f32; frames * shared.channels];
        for i in 0..blocks {
            let flags = if flags_at == Some(i) {
                PA_INPUT_OVERFLOW
            } else {
                0
            };
            unsafe { accept(shared, &input, frames, i as f64 * 10_000.0, 1.0, flags) };
        }
        unsafe { flush(shared) };
    }
    fn run(
        shared: Arc<Shared>,
        path: &Path,
        preview: mpsc::SyncSender<(Value, Vec<u8>)>,
    ) -> Result<(), String> {
        let wav = Wav::create(path, 48000, shared.channels as u16, 24).unwrap();
        let s = shared.clone();
        let worker =
            thread::spawn(move || write_audio(s, "id".into(), wav, 48000.0, true, preview));
        shared.stop.store(true, Ordering::Release);
        worker.join().unwrap()
    }

    #[test]
    fn preview_backlog_never_blocks_disk() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("预览堵塞.wav");
        let shared = Arc::new(Shared::new(1, QUEUE_BLOCKS));
        feed(&shared, 600, 480, None);
        // 推流通道只放得下一条且永远没人读：等同主进程卡住不读管道。
        let (preview, _stalled) = mpsc::sync_channel(1);
        run(shared.clone(), &path, preview).unwrap();
        // 480 帧的回调两两合并成 960 帧一块。
        assert_eq!(shared.frames.load(Ordering::Acquire), 600 * 480);
        assert!(shared.dropped_preview.load(Ordering::Relaxed) >= 299);
        assert_eq!(Wav::recover(&path).unwrap(), 600 * 480 * 3);
    }

    #[test]
    fn input_overflow_is_counted_and_recording_continues() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("溢出.wav");
        let shared = Arc::new(Shared::new(2, QUEUE_BLOCKS));
        feed(&shared, 100, 256, Some(40));
        let (preview, previews) = mpsc::sync_channel(4096);
        run(shared.clone(), &path, preview).unwrap();
        assert_eq!(shared.frames.load(Ordering::Acquire), 100 * 256);
        assert_eq!(shared.input_overflows.load(Ordering::Relaxed), 1);
        assert_eq!(shared.last_glitch_frame.load(Ordering::Relaxed), 40 * 256);
        assert_eq!(shared.dropped_preview.load(Ordering::Relaxed), 0);
        assert!(previews.try_iter().count() > 0);
    }

    #[test]
    fn full_queue_drops_are_counted_and_filled_with_silence() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("队列满.wav");
        // 写盘线程还没开始取：前 4 块入队，后面的入队失败，记作丢帧并补静音。
        let shared = Arc::new(Shared::new(1, 4));
        feed(&shared, 12, 1024, None);
        assert_eq!(shared.dropped_frames.load(Ordering::Relaxed), 8 * 1024);
        // 写盘恢复后下一块入队成功，前面丢的帧数随它一起交给写盘。
        let (preview, _previews) = mpsc::sync_channel(4096);
        let wav = Wav::create(&path, 48000, 1, 24).unwrap();
        let s = shared.clone();
        let worker =
            thread::spawn(move || write_audio(s, "id".into(), wav, 48000.0, true, preview));
        while !shared.queue.is_empty() {
            thread::sleep(Duration::from_millis(2));
        }
        feed(&shared, 1, 1024, None);
        shared.stop.store(true, Ordering::Release);
        worker.join().unwrap().unwrap();
        let total = 13 * 1024u64;
        assert_eq!(shared.frames.load(Ordering::Acquire), total);
        assert_eq!(shared.last_glitch_frame.load(Ordering::Relaxed), 4 * 1024);
        assert_eq!(Wav::recover(&path).unwrap(), total * 3);
    }

    #[test]
    fn frames_lost_right_before_stop_are_still_filled_with_silence() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("结尾丢帧.wav");
        // 最后两块入队失败后流就停了，再没有成功入队的块能把丢帧数带给写盘。
        let shared = Arc::new(Shared::new(1, 4));
        feed(&shared, 6, 1024, None);
        let (preview, previews) = mpsc::sync_channel(4096);
        let wav = Wav::create(&path, 48000, 1, 24).unwrap();
        let s = shared.clone();
        let worker =
            thread::spawn(move || write_audio(s, "id".into(), wav, 48000.0, true, preview));
        unsafe { settle_lost(&shared) };
        shared.stop.store(true, Ordering::Release);
        worker.join().unwrap().unwrap();
        assert_eq!(shared.frames.load(Ordering::Acquire), 6 * 1024);
        assert_eq!(Wav::recover(&path).unwrap(), 6 * 1024 * 3);
        // 收尾块只补静音，不推出 0 帧的采样（主进程会把它当成协议错误）。
        let frames: Vec<u64> = previews
            .try_iter()
            .filter(|(value, _)| value["event"] == "samples")
            .map(|(value, _)| value["frames"].as_u64().unwrap())
            .collect();
        assert_eq!(frames.len(), 4);
        assert!(frames.iter().all(|frames| *frames > 0));
    }
}
