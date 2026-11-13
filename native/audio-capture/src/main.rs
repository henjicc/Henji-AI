mod ffi;
mod microphone;
mod segments;
mod system_audio;
#[cfg(windows)]
mod wasapi;
mod wav;
use microphone::{Capture, Outcome};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    io::{self, BufRead, Write},
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use system_audio::SystemSession;
use wav::Wav;

/// 协议 4：麦克风一路采集可同时交给音频编辑的整段文件和录屏的分段轨道（startMicrophoneTrack）；段事件带位深与时钟误差；
/// 停止的应答在这一路写完、封口之后才到（可能晚于后来的命令的应答）。新旧程序不配套时在握手就失败。
const PROTOCOL: u32 = 4;
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
/// 进程退出前等后台线程（停止的应答、写完封口、推流）的上限；主进程给失联进程的收尾宽限是 120 秒。
const EXIT_WAIT: Duration = Duration::from_secs(100);

/// 命令的结果：立即应答，或由后台线程在写完之后应答。
enum Reply {
    Now(Value),
    Later(thread::JoinHandle<()>),
}
fn command(
    v: &Value,
    microphone: &mut Option<Capture>,
    systems: &mut Vec<SystemSession>,
) -> Result<Reply, String> {
    let text = |key: &str| -> Result<String, String> {
        v[key]
            .as_str()
            .filter(|s| !s.is_empty() && s.len() < 4096)
            .map(str::to_string)
            .ok_or_else(|| format!("INVALID_ARGUMENT|缺少参数 {key}"))
    };
    let settings = || -> Result<Settings, String> {
        serde_json::from_value(v["settings"].clone()).map_err(|e| format!("INVALID_ARGUMENT|{e}"))
    };
    let kind = text("type")?;
    // 系统声会话与麦克风互不影响，停止、查询按会话号分开。
    if matches!(kind.as_str(), "pause" | "resume" | "stop" | "status") {
        let id = text("sessionId")?;
        if let Some(index) = systems.iter().position(|s| s.id == id) {
            return match kind.as_str() {
                "stop" => systems.remove(index).close().map(Reply::Now),
                "status" => Ok(Reply::Now(systems[index].status())),
                _ => Err("INVALID_ARGUMENT|系统声音不支持暂停，请停止后重新开始".into()),
            };
        }
    }
    let now = Reply::Now;
    match kind.as_str() {
        "hello" => Ok(now(
            json!({"protocol":PROTOCOL,"nativeMonoUs":ffi::clock(),"asioCompiled":unsafe{ffi::hc_asio()}!=0,"monitoringSupported":false,"systemAudio":cfg!(windows)}),
        )),
        "clock" => Ok(now(json!({"nativeMonoUs":ffi::clock()}))),
        "startSystemAudio" => {
            let s = SystemSession::start(text("sessionId")?, text("directory")?)?;
            let status = s.status();
            systems.push(s);
            Ok(now(status))
        }
        "enumerate" => {
            if microphone.is_some() {
                return Err("RECORDING_ACTIVE|请停止录音后刷新设备列表".into());
            }
            if PORTAUDIO.swap(false, Ordering::AcqRel) {
                unsafe {
                    ffi::hc_terminate();
                }
            }
            portaudio()?;
            ffi::enumerate().map(now)
        }
        "probe" => {
            if microphone.is_some() {
                return Err("RECORDING_ACTIVE|请停止录音后探测设备格式".into());
            }
            portaudio()?;
            let mut options = settings()?.options()?;
            let mut formats = Vec::new();
            for rate in RATES {
                for bits in [16, 24, 32] {
                    options.rate = rate;
                    options.format = bits;
                    formats.push(json!({"sampleRate":rate,"bitDepth":bits,"supported":unsafe{ffi::hc_probe(&mut options)}==0}));
                }
            }
            Ok(now(json!({"formats":formats})))
        }
        // 音频编辑（或讲解）的整段文件，或录屏的麦克风轨。麦克风已开着就接到同一路上，沿用它的设备、采样率与声道，
        // 带来的设备设置不用；没开就按设置开设备。状态里的 device/channels/joined 说的是实际用的。
        "start" | "startMicrophoneTrack" => {
            let id = text("sessionId")?;
            let track = kind == "startMicrophoneTrack";
            if !track && microphone.as_ref().is_some_and(Capture::has_file) {
                return Err("RECORDING_ACTIVE|已有录音，请先停止".into());
            }
            let joined = microphone.is_some();
            if !joined {
                portaudio()?;
                *microphone = Some(Capture::open(&settings()?)?);
            }
            let capture = microphone.as_mut().unwrap();
            let started = if track {
                capture.add_track(id, text("directory")?, joined)
            } else {
                let bits = settings().map_or(capture.bits, |s| s.bit_depth as u16);
                capture.add_file(
                    id,
                    text("outputPath")?,
                    bits,
                    v["streamSamples"].as_bool().unwrap_or(false),
                    joined,
                )
            };
            started.map(now)
        }
        "pause" | "resume" | "stop" | "status" => {
            let id = text("sessionId")?;
            let capture = microphone
                .as_mut()
                .filter(|c| c.owns(&id))
                .ok_or("SESSION_MISSING|录音会话已结束")?;
            match kind.as_str() {
                "stop" => capture.stop(&id, v["id"].clone()).map(Reply::Later),
                "pause" => capture.pause(&id).map(now),
                "resume" => capture.resume(&id).map(now),
                _ => Ok(now(capture.status(&id).unwrap())),
            }
        }
        "asioPanel" => {
            if microphone.is_some() {
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
            Ok(now(json!({})))
        }
        "recover" => {
            let path = text("outputPath")?;
            // 正在写的整段文件不能动（停止已应答、磁盘还在写完的也算）；录屏轨道的旧段由失联的旧进程写，与这里正开着的段不是同一个文件。
            if microphone::writing(&path) {
                return Err("RECORDING_ACTIVE|录音文件还在写入，请稍后再恢复".into());
            }
            Ok(now(
                json!({"writtenBytes":Wav::recover(Path::new(&path)).map_err(io_error)?}),
            ))
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
    let mut microphone: Option<Capture> = None;
    let mut systems: Vec<SystemSession> = Vec::new();
    // 停止的应答、写完封口、推流：进程退出前要等它们做完。
    let mut background: Vec<thread::JoinHandle<()>> = Vec::new();
    loop {
        match rx.recv_timeout(Duration::from_millis(100)) {
            Ok(line) => match serde_json::from_str::<Value>(&line) {
                Ok(v) => {
                    let id = v["id"].clone();
                    match command(&v, &mut microphone, &mut systems) {
                        Ok(Reply::Now(result)) => {
                            emit(json!({"id":id,"ok":true,"result":result}), &[])
                        }
                        Ok(Reply::Later(waiter)) => background.push(waiter),
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
        if let Some(capture) = &mut microphone {
            capture.report_health();
            // 写盘失败的那一路已经封口：只结束它，其余照常。
            background.extend(capture.collect_failures());
        }
        // 有的驱动拔出后仍报告 active；超过最大建议延迟仍无回调也应保留并结束。设备没了：每路都封口后各报一次中断。
        if microphone.as_ref().is_some_and(Capture::disconnected) {
            background.extend(microphone.take().unwrap().close(|_| {
                Outcome::Interrupted(
                    "DEVICE_REMOVED|设备已停止提供采样，请检查连接；已录部分保留".into(),
                )
            }));
        } else if microphone.as_ref().is_some_and(Capture::is_empty) {
            background.extend(microphone.take().unwrap().close(|_| Outcome::Quiet));
        }
        background.retain(|thread| !thread.is_finished());
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
    if let Some(capture) = microphone.take() {
        background.extend(capture.close(|_| Outcome::Quiet));
    }
    drop(systems);
    // 宿主读端关了：还在写的每一路写完、封口再退出；磁盘一直不动也不无限等。
    let deadline = Instant::now() + EXIT_WAIT;
    while (background.iter().any(|thread| !thread.is_finished()) || microphone::writers() > 0)
        && Instant::now() < deadline
    {
        thread::sleep(Duration::from_millis(20));
    }
    if PORTAUDIO.load(Ordering::Acquire) {
        unsafe {
            ffi::hc_terminate();
        }
    }
}
