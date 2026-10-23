mod ffi;
mod wav;
use crossbeam_queue::ArrayQueue;
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
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
use wav::Wav;

// stdout: u32 LE JSON 长度 + UTF-8 JSON + binaryBytes 字节的交错 float32 LE PCM。
static OUTPUT: Mutex<()> = Mutex::new(());
fn emit(mut value: Value, binary: &[u8]) {
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
        std::process::exit(1);
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
struct Block {
    samples: [f32; 2048],
    frames: usize,
    mono_us: f64,
    uncertainty: f64,
    flags: u64,
}
struct Shared {
    queue: ArrayQueue<Block>,
    overflow: AtomicBool,
    stop: AtomicBool,
    failed: AtomicBool,
    frames: AtomicU64,
    bytes: AtomicU64,
    callback_frames: AtomicU64,
    last_callback_us: AtomicU64,
    channels: usize,
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
    if frames <= 0 || frames > 1024 {
        shared.overflow.store(true, Ordering::Release);
        return;
    }
    let mut block = Block {
        samples: [0.0; 2048],
        frames: frames as usize,
        mono_us,
        uncertainty,
        flags: flags as u64,
    };
    let count = frames as usize * shared.channels;
    block.samples[..count].copy_from_slice(unsafe { std::slice::from_raw_parts(samples, count) });
    if shared.queue.push(block).is_err() {
        shared.overflow.store(true, Ordering::Release);
    }
}
struct Session {
    id: String,
    path: String,
    capture: *mut c_void,
    shared: Arc<Shared>,
    worker: Option<thread::JoinHandle<Result<(), String>>>,
    paused: bool,
    rate: f64,
    latency: f64,
}
impl Session {
    fn start(id: String, path: String, settings: Settings, stream: bool) -> Result<Self, String> {
        let mut options = settings.options()?;
        let shared = Arc::new(Shared {
            queue: ArrayQueue::new(128),
            overflow: AtomicBool::new(false),
            stop: AtomicBool::new(false),
            failed: AtomicBool::new(false),
            frames: AtomicU64::new(0),
            bytes: AtomicU64::new(0),
            callback_frames: AtomicU64::new(0),
            last_callback_us: AtomicU64::new(ffi::clock() as u64),
            channels: settings.channels as usize,
        });
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
        let s = shared.clone();
        let sid = id.clone();
        let worker = thread::spawn(move || write_audio(s, sid, wav, rate, stream));
        let mut session = Self {
            id,
            path,
            capture,
            shared,
            worker: Some(worker),
            paused: false,
            rate,
            latency,
        };
        if let Err(e) = ffi::check(unsafe { ffi::hc_start(capture) }, settings.exclusive) {
            let _ = session.close();
            return Err(e);
        }
        Ok(session)
    }
    fn status(&self) -> Value {
        json!({"sessionId":self.id,"outputPath":self.path,"state":if self.paused {"paused"} else {"recording"},"sampleRate":self.rate,"inputLatency":self.latency,"callbackFrames":self.shared.callback_frames.load(Ordering::Relaxed),"frames":self.shared.frames.load(Ordering::Acquire),"writtenBytes":self.shared.bytes.load(Ordering::Acquire),"durationSeconds":self.shared.frames.load(Ordering::Acquire) as f64 / self.rate})
    }
    fn close(&mut self) -> Result<Value, String> {
        if self.capture.is_null() {
            return Ok(self.status());
        }
        unsafe {
            ffi::hc_stop(self.capture);
            ffi::hc_close(self.capture);
        }
        self.capture = std::ptr::null_mut();
        self.shared.stop.store(true, Ordering::Release);
        if let Some(worker) = self.worker.take() {
            worker
                .join()
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
) -> Result<(), String> {
    let mut sequence = 0u64;
    let mut peak = vec![0.0f32; shared.channels];
    let mut sum = vec![0.0f64; shared.channels];
    let mut meter_frames = 0usize;
    let mut checkpoint = Instant::now();
    let result = (|| {
        loop {
            if shared.overflow.load(Ordering::Acquire) {
                return Err("BUFFER_OVERRUN|写盘或采样订阅处理过慢，录音中断，已录部分保留".into());
            }
            if let Some(block) = shared.queue.pop() {
                if block.flags & 3 != 0 {
                    return Err(
                        "INPUT_OVERRUN|音频设备丢失采样，录音已中断并保留，请增大缓冲或检查设备"
                            .into(),
                    );
                }
                let samples = &block.samples[..block.frames * shared.channels];
                wav.write(samples).map_err(io_error)?;
                let first_frame = shared
                    .frames
                    .fetch_add(block.frames as u64, Ordering::AcqRel);
                shared.bytes.store(wav.bytes, Ordering::Release);
                for (i, &sample) in samples.iter().enumerate() {
                    let ch = i % shared.channels;
                    peak[ch] = peak[ch].max(sample.abs());
                    sum[ch] += (sample as f64).powi(2);
                }
                meter_frames += block.frames;
                if stream {
                    let bytes: Vec<u8> = samples.iter().flat_map(|s| s.to_le_bytes()).collect();
                    emit(
                        json!({"event":"samples","sessionId":id,"sequence":sequence,"firstFrame":first_frame,"frames":block.frames,"channels":shared.channels,"sampleRate":rate,"nativeMonoUs":block.mono_us,"uncertaintyUs":block.uncertainty,"format":"float32le"}),
                        &bytes,
                    );
                }
                sequence += 1;
                if meter_frames as f64 / rate >= 0.033 {
                    let rms: Vec<f64> = sum
                        .iter()
                        .map(|s| (s / meter_frames as f64).sqrt())
                        .collect();
                    let clipped: Vec<bool> = peak.iter().map(|p| *p >= 0.999969).collect();
                    emit(
                        json!({"event":"level","sessionId":id,"peak":peak,"rms":rms,"clipped":clipped,"durationSeconds":(first_frame+block.frames as u64) as f64/rate,"writtenBytes":wav.bytes}),
                        &[],
                    );
                    peak.fill(0.0);
                    sum.fill(0.0);
                    meter_frames = 0;
                }
                if checkpoint.elapsed() >= Duration::from_secs(1) {
                    wav.checkpoint().map_err(io_error)?;
                    checkpoint = Instant::now();
                }
            } else if shared.stop.load(Ordering::Acquire) {
                break;
            } else {
                thread::sleep(Duration::from_millis(2));
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
fn command(v: &Value, session: &mut Option<Session>) -> Result<Value, String> {
    let text = |key: &str| -> Result<String, String> {
        v[key]
            .as_str()
            .filter(|s| !s.is_empty() && s.len() < 4096)
            .map(str::to_string)
            .ok_or_else(|| format!("INVALID_ARGUMENT|缺少参数 {key}"))
    };
    match text("type")?.as_str() {
        "hello" => Ok(
            json!({"protocol":1,"nativeMonoUs":ffi::clock(),"asioCompiled":unsafe{ffi::hc_asio()}!=0,"monitoringSupported":false}),
        ),
        "clock" => Ok(json!({"nativeMonoUs":ffi::clock()})),
        "enumerate" => {
            if session.is_some() {
                return Err("RECORDING_ACTIVE|请停止录音后刷新设备列表".into());
            }
            unsafe {
                ffi::hc_terminate();
            }
            ffi::check(unsafe { ffi::hc_init() }, false)?;
            ffi::enumerate()
        }
        "probe" => {
            if session.is_some() {
                return Err("RECORDING_ACTIVE|请停止录音后探测设备格式".into());
            }
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
                        ffi::check(unsafe { ffi::hc_stop(s.capture) }, false)?;
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
    if let Err(e) = ffi::check(unsafe { ffi::hc_init() }, false) {
        eprintln!("{e}");
        std::process::exit(1);
    }
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
    loop {
        match rx.recv_timeout(Duration::from_millis(100)) {
            Ok(line) => match serde_json::from_str::<Value>(&line) {
                Ok(v) => {
                    let id = v["id"].clone();
                    match command(&v, &mut session) {
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
        if let Some(s) = &session {
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
                    json!({"event":"interrupted","sessionId":s.id,"outputPath":s.path,"error":failure(&error),"writtenBytes":s.shared.bytes.load(Ordering::Acquire)}),
                    &[],
                );
            }
        }
    }
    drop(session);
    unsafe {
        ffi::hc_terminate();
    }
}
