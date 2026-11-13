//! 与主进程的协议，约定与录音进程相同：
//! - 标准输入：一行一条 JSON 指令，带 `id` 与 `type`；
//! - 标准输出：u32 小端 JSON 字节数 + UTF-8 JSON + `binaryBytes` 字节的二进制；
//!   应答是 `{id, ok, result | error}`，事件是 `{event, sessionId, ...}`；
//! - 事件分“不丢”（按顺序、必达）与“可丢”（健康汇报，管道慢时丢弃）；
//! - 标准输入关闭或主进程读端关闭：把正在录的文件收尾后退出。

use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    io::{self, Write},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Mutex,
    },
    thread,
    time::Duration,
};

/// 协议 1：prepare / start / pause / resume / stop / cancel / status / sources / clock / hello。
/// 指令、事件或落盘格式的含义有变就加一；主进程在握手时带上自己的协议号，不相等直接报错。
pub const PROTOCOL: u32 = 1;

static OUTPUT: Mutex<()> = Mutex::new(());
/// 主进程读端已关闭：之后的输出全部丢弃，由主循环把文件收尾后退出。
pub static OUTPUT_BROKEN: AtomicBool = AtomicBool::new(false);
/// 开发用命令行直接运行时改为一行一条 JSON，方便人看和脚本解析。
pub static OUTPUT_LINES: AtomicBool = AtomicBool::new(false);

pub fn frame(mut value: Value, binary: &[u8]) -> Vec<u8> {
    value["binaryBytes"] = json!(binary.len());
    let body = serde_json::to_vec(&value).unwrap();
    let mut bytes = Vec::with_capacity(4 + body.len() + binary.len());
    bytes.extend_from_slice(&(body.len() as u32).to_le_bytes());
    bytes.extend_from_slice(&body);
    bytes.extend_from_slice(binary);
    bytes
}

pub fn emit(value: Value, binary: &[u8]) {
    if OUTPUT_BROKEN.load(Ordering::Acquire) {
        return;
    }
    let bytes = if OUTPUT_LINES.load(Ordering::Acquire) {
        let mut line = serde_json::to_vec(&value).unwrap();
        line.push(b'\n');
        line
    } else {
        frame(value, binary)
    };
    let _guard = OUTPUT.lock().unwrap();
    let mut out = io::stdout().lock();
    if out.write_all(&bytes).and_then(|_| out.flush()).is_err() {
        OUTPUT_BROKEN.store(true, Ordering::Release);
    }
}

/// 内部错误写成 “错误码|给用户看的话”；没有错误码的归为 CAPTURE_FAILED。
pub fn failure(message: &str) -> Value {
    let (code, text) = message.split_once('|').unwrap_or(("CAPTURE_FAILED", message));
    // 换一种录法能继续的（本机不支持）与重试无意义的参数错误，主进程按 code 分流；recoverable 表示已录部分保留。
    json!({"code": code, "message": text, "recoverable": !matches!(code, "INVALID_ARGUMENT" | "PROTOCOL_MISMATCH")})
}

pub fn io_failure(error: &io::Error) -> String {
    // Windows 的磁盘已满是 112（ERROR_DISK_FULL）与 39（ERROR_HANDLE_DISK_FULL），POSIX 是 28（ENOSPC）。
    if matches!(error.raw_os_error(), Some(28 | 112 | 39)) {
        format!("DISK_FULL|磁盘空间不足，已录部分保留，请释放空间：{error}")
    } else {
        format!("FILE_ERROR|录屏文件读写失败，已录部分保留：{error}")
    }
}

pub enum Reliable {
    Message(Value),
    /// 它之前的消息都发出后应答：进程退出前用来确认事件已送完。
    Barrier(mpsc::Sender<()>),
}

#[derive(Clone)]
pub struct Events {
    reliable: mpsc::Sender<Reliable>,
    lossy: mpsc::SyncSender<Value>,
}

impl Events {
    /// 不丢：应答与状态事件。
    pub fn send(&self, value: Value) {
        let _ = self.reliable.send(Reliable::Message(value));
    }

    /// 可丢：健康汇报。管道慢、队列满时直接丢弃，不让调用方等。
    pub fn send_lossy(&self, value: Value) {
        let _ = self.lossy.try_send(value);
    }

    pub fn barrier(&self) {
        let (done, wait) = mpsc::channel();
        if self.reliable.send(Reliable::Barrier(done)).is_ok() {
            let _ = wait.recv_timeout(Duration::from_secs(5));
        }
    }
}

/// 推流线程：先发完不丢的，再发可丢的；所有发送端都放下后把剩下的不丢消息发完再退出。
pub fn spawn_streamer() -> (Events, thread::JoinHandle<()>) {
    let (reliable_tx, reliable) = mpsc::channel::<Reliable>();
    let (lossy_tx, lossy) = mpsc::sync_channel::<Value>(8);
    let send = |item: Reliable| match item {
        Reliable::Message(value) => emit(value, &[]),
        Reliable::Barrier(done) => {
            let _ = done.send(());
        }
    };
    let handle = thread::spawn(move || loop {
        while let Ok(item) = reliable.try_recv() {
            send(item);
        }
        match lossy.recv_timeout(Duration::from_millis(20)) {
            Ok(value) => emit(value, &[]),
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                for item in reliable.iter() {
                    send(item);
                }
                break;
            }
        }
    });
    (Events { reliable: reliable_tx, lossy: lossy_tx }, handle)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Codec {
    #[default]
    H264,
    Hevc,
}

impl Codec {
    pub fn name(self) -> &'static str {
        match self {
            Codec::H264 => "h264",
            Codec::Hevc => "hevc",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum RateControl {
    /// 恒定质量（码率只作上限）。
    #[default]
    Quality,
    Vbr,
    Cbr,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SourceSpec {
    /// 整块显示器：`id` 是 sources 返回的设备名；没有 id 时用 `point`（虚拟桌面上的物理像素坐标）所在的显示器；都没有就是主显示器。
    Display {
        #[serde(default)]
        id: Option<String>,
        #[serde(default)]
        point: Option<[i32; 2]>,
    },
}

fn default_name() -> String {
    "screen".into()
}
fn default_fps() -> u32 {
    60
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureConfig {
    pub session_id: String,
    /// 这次录制的文件都写在这个目录下（主进程建好并给出）。
    pub directory: String,
    /// 文件名前缀：<name>.mp4、<name>.frames、<name>.activity.jsonl、<name>.capture.json。
    #[serde(default = "default_name")]
    pub name: String,
    pub source: SourceSpec,
    #[serde(default = "default_fps")]
    pub fps: u32,
    #[serde(default)]
    pub codec: Codec,
    #[serde(default)]
    pub rate_control: RateControl,
    /// 目标码率（比特每秒）；0 表示按分辨率与帧率取默认值。
    #[serde(default)]
    pub bitrate: u64,
    /// 关键帧间隔（帧）；0 表示一秒。每个关键帧起一个分片，间隔就是被杀时最多丢的时长。
    #[serde(default)]
    pub keyframe_frames: u32,
}

impl CaptureConfig {
    pub fn parse(value: &Value) -> Result<Self, String> {
        let config: Self = serde_json::from_value(value.clone()).map_err(|error| format!("INVALID_ARGUMENT|录屏参数不对：{error}"))?;
        let bad_name = config.name.is_empty() || config.name.contains(['/', '\\', ':']) || config.name.starts_with('.');
        if config.session_id.is_empty() || config.directory.is_empty() || bad_name || !(1..=240).contains(&config.fps) {
            return Err("INVALID_ARGUMENT|录屏参数超出范围".into());
        }
        Ok(config)
    }

    pub fn keyframe_interval(&self) -> u32 {
        if self.keyframe_frames == 0 {
            self.fps
        } else {
            self.keyframe_frames
        }
    }

    /// 没给码率时的默认值：每像素每帧 0.08 比特，限制在 4–80 Mbps（4K60 约 40 Mbps）。
    pub fn target_bitrate(&self, width: u32, height: u32) -> u64 {
        if self.bitrate > 0 {
            return self.bitrate;
        }
        ((width as u64 * height as u64 * self.fps as u64) * 8 / 100).clamp(4_000_000, 80_000_000)
    }
}

/// 握手：主进程带上自己的协议号时必须相等。
pub fn hello(request: &Value, now_us: i64, platform: &str) -> Result<Value, String> {
    if let Some(expected) = request["protocol"].as_u64() {
        if expected != PROTOCOL as u64 {
            return Err(format!(
                "PROTOCOL_MISMATCH|画面采集程序与应用版本不配套（应用要协议 {expected}，采集程序是协议 {PROTOCOL}），请重新安装应用；开发环境请重新运行 node scripts/build-screen-capture.cjs"
            ));
        }
    }
    Ok(json!({
        "protocol": PROTOCOL,
        "nativeMonoUs": now_us,
        "platform": platform,
        "codecs": ["h264", "hevc"],
        "sources": ["display"],
        "pauseInPlace": true,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frames_carry_length_json_and_binary() {
        let bytes = frame(json!({"event": "health", "sessionId": "a"}), &[9, 8, 7]);
        let length = u32::from_le_bytes(bytes[0..4].try_into().unwrap()) as usize;
        let value: Value = serde_json::from_slice(&bytes[4..4 + length]).unwrap();
        assert_eq!(value, json!({"event": "health", "sessionId": "a", "binaryBytes": 3}));
        assert_eq!(&bytes[4 + length..], &[9, 8, 7]);
    }

    #[test]
    fn config_applies_defaults_and_rejects_bad_input() {
        let config = CaptureConfig::parse(&json!({
            "type": "prepare", "id": 1, "sessionId": "s", "directory": "D:/录屏/一次",
            "source": {"kind": "display", "point": [2561, 1]},
        }))
        .unwrap();
        assert_eq!((config.fps, config.codec, config.rate_control, config.name.as_str()), (60, Codec::H264, RateControl::Quality, "screen"));
        assert_eq!(config.source, SourceSpec::Display { id: None, point: Some([2561, 1]) });
        assert_eq!(config.keyframe_interval(), 60);
        assert_eq!(config.target_bitrate(3840, 2160), 39_813_120);
        for bad in [
            json!({"sessionId": "s", "directory": "d", "source": {"kind": "window"}}),
            json!({"sessionId": "s", "directory": "d", "source": {"kind": "display"}, "fps": 0}),
            json!({"sessionId": "s", "directory": "d", "source": {"kind": "display"}, "name": "../x"}),
            json!({"sessionId": "", "directory": "d", "source": {"kind": "display"}}),
        ] {
            let error = CaptureConfig::parse(&bad).unwrap_err();
            assert!(error.starts_with("INVALID_ARGUMENT|"), "{error}");
        }
    }

    #[test]
    fn handshake_rejects_a_different_protocol_with_an_actionable_message() {
        assert_eq!(hello(&json!({}), 5, "windows").unwrap()["protocol"], PROTOCOL);
        assert!(hello(&json!({"protocol": PROTOCOL}), 5, "windows").is_ok());
        let error = failure(&hello(&json!({"protocol": PROTOCOL + 1}), 5, "windows").unwrap_err());
        assert_eq!(error["code"], "PROTOCOL_MISMATCH");
        assert_eq!(error["recoverable"], false);
        assert!(error["message"].as_str().unwrap().contains("重新安装"));
    }

    #[test]
    fn disk_full_is_told_apart_from_other_file_errors() {
        assert!(io_failure(&io::Error::from_raw_os_error(112)).starts_with("DISK_FULL|"));
        assert!(io_failure(&io::Error::from_raw_os_error(5)).starts_with("FILE_ERROR|"));
    }
}
