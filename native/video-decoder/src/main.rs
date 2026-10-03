//! Henji-AI 原生视频解码服务（长期驻留子进程）。
//!
//! 控制面：stdin/stdout 交换长度前缀 JSON（见 protocol.rs）；stderr 输出一行一 JSON 的结构化日志，
//! 由主进程转入统一日志。stdin 关闭即退出，父进程异常结束时服务不会残留。
//!
//! 命令：hello（版本、FFmpeg 信息、D3D11 设备、登记客户端 PID、资源上限）、ping（心跳）、probe（流信息）、cancel、shutdown；
//! 帧流（1.2）：start_test_stream、stop_stream、release_frame（通知）、stats、close_client_handles；
//! 解码会话（1.3，协议见 decode/mod.rs）：open_decoder、frame_at、schedule、cancel_schedule；
//! 声音会话（2.3，协议见 audio/mod.rs）：open_audio、read_audio、close_audio（PCM 走二进制附件）。
//! 画面经显卡共享纹理交给客户端，控制通道只发 `frame` 等事件（槽位、时间戳与请求归属）。
//!
//! 平台层边界（重要记录 011）：显卡设备、硬件解码设备、共享纹理与格式转换只在 `platform/` 之后；
//! 其余模块跨平台，不直接依赖 D3D11/`windows` crate。

mod audio;
mod budget;
mod convert;
mod decode;
mod ffmpeg_info;
mod logging;
mod platform;
mod probe;
mod protocol;
mod streams;
mod test_pattern;

use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{self, BufReader};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use protocol::{Command, ServiceError};

const SERVICE_VERSION: &str = env!("CARGO_PKG_VERSION");

type CancelMap = Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>;

/// 写出一条消息（响应或事件）；stdout 锁保证多线程写出不交错。
fn send(value: &Value) {
    let mut stdout = io::stdout().lock();
    if let Err(error) = protocol::write_message(&mut stdout, value) {
        // stdout 断开说明主进程已不再读取，后续 stdin 也会结束，这里只记录。
        logging::error("protocol.write_failed", "写出响应失败", json!({ "error": error.to_string() }));
    }
}

/// 写出带二进制附件的消息（声音 PCM）：头与附件在同一把 stdout 锁内写出，不与其他消息交错。
fn send_with_attachment(value: &Value, attachment: &[u8]) {
    let mut stdout = io::stdout().lock();
    if let Err(error) = protocol::write_message_with_attachment(&mut stdout, value, attachment) {
        logging::error("protocol.write_failed", "写出带附件的响应失败", json!({ "error": error.to_string() }));
    }
}

fn respond(id: &str, result: Result<Value, ServiceError>) {
    match result {
        Ok(value) => send(&protocol::success(id, value)),
        Err(error) => send(&protocol::failure(id, &error)),
    }
}

struct Service {
    platform: Option<Arc<dyn platform::VideoPlatform>>,
    platform_summary: Value,
    ffmpeg: Value,
    cancels: CancelMap,
    streams: streams::StreamManager,
    audio: audio::AudioManager,
    budget: budget::Budget,
}

impl Service {
    fn new() -> Self {
        logging::install_ffmpeg_log_bridge();
        let (platform, platform_summary) = match platform::create() {
            Ok(platform) => {
                let summary = platform.summary();
                (Some(platform), summary)
            }
            Err(reason) => {
                logging::warn("gpu.device_unavailable", "显卡设备不可用", json!({ "reason": reason }));
                (None, platform::unavailable_summary(&reason))
            }
        };
        // Resource limits follow the selected adapter's dedicated memory (3.1); the main process may override them.
        let budget = budget::Budget::new(budget::Limits::for_adapter(platform_summary["adapter"]["dedicatedVideoMemoryMiB"].as_u64()));
        Self { platform, platform_summary, ffmpeg: ffmpeg_info::ffmpeg_info(), cancels: Arc::default(), streams: streams::StreamManager::new(), audio: audio::AudioManager::default(), budget }
    }

    /// 登记客户端进程（纹理句柄的复制目标）。打开失败不影响握手，帧流请求届时报错。
    fn register_client(&mut self, client_pid: Option<u32>) -> Value {
        let (Some(pid), Some(platform)) = (client_pid, &self.platform) else {
            return json!({ "pid": client_pid, "ready": false });
        };
        match platform.register_client(pid) {
            Ok(()) => json!({ "pid": pid, "ready": true }),
            Err(reason) => {
                logging::warn("client.open_failed", &reason, json!({ "pid": pid }));
                json!({ "pid": pid, "ready": false, "reason": reason })
            }
        }
    }

    /// 可用于帧流的平台（设备就绪且已登记客户端进程）。
    fn ready_platform(&self) -> Result<Arc<dyn platform::VideoPlatform>, ServiceError> {
        let platform = self.platform.clone().ok_or_else(|| ServiceError::new("GPU_UNAVAILABLE", "显卡设备不可用"))?;
        if !platform.client_ready() {
            return Err(ServiceError::new("CLIENT_UNAVAILABLE", "尚未登记客户端进程，无法共享纹理"));
        }
        Ok(platform)
    }

    fn start_test_stream(&mut self, options: streams::TestStreamOptions) -> Result<Value, ServiceError> {
        let platform = self.ready_platform()?;
        self.streams.start_test_stream(&platform, options)
    }

    /// 打开解码会话：会话线程打开文件后自行响应。
    fn open_decoder(&mut self, request_id: &str, options: decode::DecodeOptions) -> Result<(), ServiceError> {
        let platform = self.ready_platform()?;
        self.streams.start_decoder(request_id.to_string(), &platform, options, &self.budget)
    }

    fn close_client_handles(&self, handles: &[String]) -> Value {
        let mut closed = 0;
        let mut failed: Vec<String> = Vec::new();
        for handle in handles {
            match (handle.parse::<u64>(), &self.platform) {
                (Ok(value), Some(platform)) => match platform.close_client_handle(value) {
                    Ok(()) => closed += 1,
                    Err(_) => failed.push(handle.clone()),
                },
                _ => failed.push(handle.clone()),
            }
        }
        if closed > 0 || !failed.is_empty() {
            logging::info("client.handles_closed", "已关闭遗留的客户端纹理句柄", json!({ "closed": closed, "failed": failed.len() }));
        }
        json!({ "closed": closed, "failed": failed })
    }

    fn stats(&self) -> Value {
        let (cpu_ms, handle_count) = platform::process_usage();
        let (working_set, private_bytes) = platform::process_memory();
        let memory = self.platform.as_ref().and_then(|platform| platform.local_memory());
        json!({
            "pid": std::process::id(),
            "cpuMs": cpu_ms,
            "handleCount": handle_count,
            "workingSetBytes": working_set,
            "privateBytes": private_bytes,
            "gpuLocalMemory": memory.map(|(usage, budget)| json!({ "currentUsageBytes": usage, "budgetBytes": budget })),
            "streams": self.streams.stats(),
            "audioSessions": self.audio.count(),
            "budget": self.budget.stats(),
        })
    }

    fn hello(&self) -> Value {
        json!({
            "service": "henji-video-decoder",
            "serviceVersion": SERVICE_VERSION,
            "protocolVersion": protocol::PROTOCOL_VERSION,
            "pid": std::process::id(),
            "ffmpeg": self.ffmpeg,
            "d3d11": self.platform_summary,
            "gpuReady": self.platform.is_some(),
            "limits": self.budget.stats(),
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
    let mut service = Service::new();
    logging::info(
        "service.started",
        "原生视频解码服务已启动",
        json!({
            "pid": std::process::id(),
            "serviceVersion": SERVICE_VERSION,
            "ffmpegVersion": service.ffmpeg["version"],
            "gpuReady": service.platform.is_some(),
            "startupMs": started.elapsed().as_secs_f64() * 1000.0,
        }),
    );

    let mut stdin = BufReader::new(io::stdin().lock());
    loop {
        let body = match protocol::read_message(&mut stdin) {
            Ok(Some(body)) => body,
            Ok(None) => {
                logging::info("service.stdin_closed", "控制通道已关闭，服务退出", json!({}));
                service.streams.stop_all();
                service.audio.stop_all();
                break;
            }
            Err(error) => {
                logging::error("protocol.read_failed", "读取控制消息失败，服务退出", json!({ "error": error.to_string() }));
                std::process::exit(2);
            }
        };
        service.streams.reap();
        service.audio.reap();
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
            Command::Hello { client_pid, limits } => {
                if let Some(limits) = limits {
                    service.budget.override_limits(limits);
                }
                let client = service.register_client(client_pid);
                let mut hello = service.hello();
                hello["client"] = client;
                respond(&request.id, Ok(hello))
            }
            Command::Ping => respond(&request.id, Ok(json!({ "pong": true, "decoders": service.streams.decoder_count(), "audioSessions": service.audio.count() }))),
            Command::Probe { path } => service.start_probe(request.id, path),
            Command::Cancel { target_id } => respond(&request.id, Ok(service.cancel(&target_id))),
            Command::StartTestStream { stream_id, format, width, height, fps, pool_size, max_frames, keyed_mutex } => {
                let options = streams::TestStreamOptions {
                    stream_id,
                    format,
                    width,
                    height,
                    fps,
                    pool_size: pool_size.unwrap_or(streams::DEFAULT_POOL_SIZE),
                    max_frames,
                    keyed_mutex: keyed_mutex.unwrap_or(true),
                };
                let stream_id = options.stream_id.clone();
                let result = service.start_test_stream(options);
                let started = result.is_ok();
                if let Err(error) = &result {
                    logging::warn("stream.start_failed", &error.message, json!({ "code": error.code, "streamId": stream_id }));
                }
                respond(&request.id, result);
                if started {
                    service.streams.activate(&stream_id);
                }
            }
            Command::StopStream { stream_id } => {
                let stopped = service.streams.stop(&stream_id);
                respond(&request.id, Ok(json!({ "streamId": stream_id, "stopped": stopped.is_some(), "final": stopped })))
            }
            Command::ReleaseFrame { stream_id, slot } => service.streams.release_frame(&stream_id, slot),
            Command::Stats => respond(&request.id, Ok(service.stats())),
            Command::CloseClientHandles { handles } => respond(&request.id, Ok(service.close_client_handles(&handles))),
            Command::OpenDecoder { stream_id, path, stream_index, purpose, pool_size, hardware, format, transfer } => {
                let options = decode::DecodeOptions {
                    stream_id,
                    path,
                    stream_index,
                    purpose: match purpose {
                        Some(protocol::DecodePurpose::Seek) => decode::codec::Purpose::Seek,
                        _ => decode::codec::Purpose::Playback,
                    },
                    pool_size,
                    hardware: hardware != Some(protocol::HardwareMode::Off),
                    format,
                    transfer,
                };
                let stream_id = options.stream_id.clone();
                if let Err(error) = service.open_decoder(&request.id, options) {
                    logging::warn("decode.session.open_failed", &error.message, json!({ "code": error.code, "streamId": stream_id }));
                    respond(&request.id, Err(error));
                }
            }
            Command::FrameAt { stream_id, time, ticket } => {
                if let Err(error) = service.streams.dispatch(&stream_id, decode::SessionCommand::FrameAt { request_id: request.id.clone(), time, ticket }) {
                    respond(&request.id, Err(error));
                }
            }
            Command::Schedule { stream_id, schedule_id, times, range } => {
                let plan = match (times, range) {
                    (Some(times), None) if times.len() <= decode::MAX_SCHEDULE_TIMES => Ok(decode::SchedulePlan::Times(times)),
                    (Some(_), None) => Err(ServiceError::new("INVALID_REQUEST", "计划时间点过多")),
                    (None, Some(range)) => Ok(decode::SchedulePlan::Range { from: range.from, to: range.to }),
                    _ => Err(ServiceError::new("INVALID_REQUEST", "计划需要 times 或 range 之一")),
                };
                match plan {
                    Err(error) => respond(&request.id, Err(error)),
                    Ok(_) if !service.streams.is_decoder(&stream_id) => respond(&request.id, Err(ServiceError::new("INVALID_REQUEST", format!("解码会话 {stream_id} 不存在")))),
                    Ok(plan) => {
                        let count = match &plan {
                            decode::SchedulePlan::Times(times) => json!(times.len()),
                            decode::SchedulePlan::Range { .. } => Value::Null,
                        };
                        // 先确认再交给会话线程：客户端收到确认前不会看到本计划的帧。
                        respond(&request.id, Ok(json!({ "scheduleId": schedule_id, "count": count })));
                        if let Err(error) = service.streams.dispatch(&stream_id, decode::SessionCommand::Schedule { schedule_id: schedule_id.clone(), plan }) {
                            send(&json!({ "event": "schedule_done", "streamId": stream_id, "scheduleId": schedule_id, "reason": "error", "message": error.message, "counters": {} }));
                        }
                    }
                }
            }
            Command::CancelSchedule { stream_id, schedule_id } => {
                let cancelled = service.streams.dispatch(&stream_id, decode::SessionCommand::Cancel { schedule_id }).is_ok();
                respond(&request.id, Ok(json!({ "cancelled": cancelled })));
            }
            Command::OpenAudio { audio_id, path, audio_stream, sample_rate } => {
                let options = audio::AudioOpenOptions { audio_id: audio_id.clone(), path, audio_stream: audio_stream.unwrap_or(0), sample_rate };
                if let Err(error) = service.audio.open(request.id.clone(), options) {
                    logging::warn("audio.session.open_failed", &error.message, json!({ "code": error.code, "audioId": audio_id }));
                    respond(&request.id, Err(error));
                }
            }
            Command::ReadAudio { audio_id, start_frame, frames } => {
                if let Err(error) = service.audio.read(&request.id, &audio_id, start_frame, frames) {
                    respond(&request.id, Err(error));
                }
            }
            Command::CloseAudio { audio_id } => {
                if !service.audio.close(&request.id, &audio_id) {
                    respond(&request.id, Ok(json!({ "closed": false })));
                }
            }
            Command::Shutdown => {
                for flag in service.cancels.lock().unwrap().values() {
                    flag.store(true, Ordering::Relaxed);
                }
                service.streams.stop_all();
                service.audio.stop_all();
                respond(&request.id, Ok(json!({ "stopping": true })));
                logging::info("service.stopping", "收到关闭请求，服务退出", json!({}));
                break;
            }
        }
    }
}
