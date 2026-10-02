//! Henji-AI 原生视频解码服务（长期驻留子进程）。
//!
//! 控制面：stdin/stdout 交换长度前缀 JSON（见 protocol.rs）；stderr 输出一行一 JSON 的结构化日志，
//! 由主进程转入统一日志。stdin 关闭即退出，父进程异常结束时服务不会残留。
//!
//! 1.1 范围：hello（版本、FFmpeg 信息、D3D11 设备）、probe（流信息）、cancel、shutdown。

mod ffmpeg_info;
mod gpu;
mod logging;
mod probe;
mod protocol;

use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{self, BufReader};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use protocol::{Command, ServiceError};

const SERVICE_VERSION: &str = env!("CARGO_PKG_VERSION");

type CancelMap = Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>;

fn send(value: &Value) {
    let mut stdout = io::stdout().lock();
    if let Err(error) = protocol::write_message(&mut stdout, value) {
        // stdout 断开说明主进程已不再读取，后续 stdin 也会结束，这里只记录。
        logging::error("protocol.write_failed", "写出响应失败", json!({ "error": error.to_string() }));
    }
}

fn respond(id: &str, result: Result<Value, ServiceError>) {
    match result {
        Ok(value) => send(&protocol::success(id, value)),
        Err(error) => send(&protocol::failure(id, &error)),
    }
}

struct Service {
    gpu: Option<gpu::GpuDevice>,
    gpu_summary: Value,
    ffmpeg: Value,
    cancels: CancelMap,
}

impl Service {
    fn new() -> Self {
        logging::install_ffmpeg_log_bridge();
        let (gpu, gpu_summary) = match gpu::create_device() {
            Ok(device) => {
                let summary = device.summary.clone();
                (Some(device), summary)
            }
            Err(reason) => {
                logging::warn("gpu.device_unavailable", "D3D11 设备不可用", json!({ "reason": reason }));
                (None, gpu::unavailable_summary(&reason))
            }
        };
        Self { gpu, gpu_summary, ffmpeg: ffmpeg_info::ffmpeg_info(), cancels: Arc::default() }
    }

    fn hello(&self) -> Value {
        json!({
            "service": "henji-video-decoder",
            "serviceVersion": SERVICE_VERSION,
            "protocolVersion": protocol::PROTOCOL_VERSION,
            "pid": std::process::id(),
            "ffmpeg": self.ffmpeg,
            "d3d11": self.gpu_summary,
            "gpuReady": self.gpu.is_some(),
        })
    }

    fn start_probe(&self, id: String, path: String) {
        let flag = Arc::new(AtomicBool::new(false));
        self.cancels.lock().unwrap().insert(id.clone(), flag.clone());
        let cancels = self.cancels.clone();
        // 探测可能被慢速磁盘或网络盘阻塞，放到独立线程，控制通道保持响应（可随时取消）。
        std::thread::spawn(move || {
            let started = Instant::now();
            let result = probe::probe(&path, &flag);
            cancels.lock().unwrap().remove(&id);
            let elapsed_ms = started.elapsed().as_secs_f64() * 1000.0;
            match &result {
                Ok(value) => {
                    let hdr_streams: Vec<&Value> = value["streams"].as_array().map(|streams| streams.iter().filter(|stream| stream["video"]["hdr"] == json!(true)).collect()).unwrap_or_default();
                    if !hdr_streams.is_empty() {
                        logging::warn("probe.hdr_as_sdr", "素材带 HDR 传输特性，按 SDR 解释", json!({ "path": path, "streams": hdr_streams.iter().map(|stream| &stream["index"]).collect::<Vec<_>>() }));
                    }
                    logging::emit("debug", "probe.completed", "探测完成", json!({ "requestId": id, "elapsedMs": elapsed_ms }));
                }
                Err(error) => logging::warn("probe.failed", &error.message, json!({ "requestId": id, "code": error.code, "elapsedMs": elapsed_ms })),
            }
            respond(&id, result);
        });
    }

    fn cancel(&self, target_id: &str) -> Value {
        let found = self.cancels.lock().unwrap().get(target_id).map(|flag| flag.store(true, Ordering::Relaxed)).is_some();
        json!({ "targetId": target_id, "cancelled": found })
    }
}

fn main() {
    let started = Instant::now();
    let service = Service::new();
    logging::info(
        "service.started",
        "原生视频解码服务已启动",
        json!({
            "pid": std::process::id(),
            "serviceVersion": SERVICE_VERSION,
            "ffmpegVersion": service.ffmpeg["version"],
            "gpuReady": service.gpu.is_some(),
            "startupMs": started.elapsed().as_secs_f64() * 1000.0,
        }),
    );

    let mut stdin = BufReader::new(io::stdin().lock());
    loop {
        let body = match protocol::read_message(&mut stdin) {
            Ok(Some(body)) => body,
            Ok(None) => {
                logging::info("service.stdin_closed", "控制通道已关闭，服务退出", json!({}));
                break;
            }
            Err(error) => {
                logging::error("protocol.read_failed", "读取控制消息失败，服务退出", json!({ "error": error.to_string() }));
                std::process::exit(2);
            }
        };
        let request = match protocol::parse_request(&body) {
            Ok(request) => request,
            Err(error) => {
                logging::warn("protocol.invalid_request", &error.message, json!({}));
                if let Some(id) = protocol::request_id_hint(&body) {
                    respond(&id, Err(error));
                }
                continue;
            }
        };
        match request.command {
            Command::Hello => respond(&request.id, Ok(service.hello())),
            Command::Probe { path } => service.start_probe(request.id, path),
            Command::Cancel { target_id } => respond(&request.id, Ok(service.cancel(&target_id))),
            Command::Shutdown => {
                for flag in service.cancels.lock().unwrap().values() {
                    flag.store(true, Ordering::Relaxed);
                }
                respond(&request.id, Ok(json!({ "stopping": true })));
                logging::info("service.stopping", "收到关闭请求，服务退出", json!({}));
                break;
            }
        }
    }
}
