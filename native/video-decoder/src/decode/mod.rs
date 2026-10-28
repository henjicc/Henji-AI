//! 解码会话（1.3）：每个会话一个生产线程、一个解码器、一个共享纹理池（沿用 1.2 的流模型）。
//!
//! 协议（控制通道，版本 3）：
//! - `open_decoder { streamId, path, streamIndex?, purpose: playback|seek, poolSize?, hardware?: auto|off, format? }`
//!   → 会话线程打开文件、解出第一帧以确定像素格式与色彩，再响应流信息（与测试流同形，另含 `decoder`、时间信息）；
//! - `frame_at { streamId, time, ticket }`：命中时先发 `frame` 事件（`request.kind = frame_at`）再响应 `{ found: true, ptsUs… }`；
//!   被 `cancel` 取消（新请求取代了它）时在出队、每解出一帧、等槽位时停下，答复 CANCELLED，会话停在已解到的位置；
//! - `schedule { streamId, scheduleId, times | range }`：主线程立即确认，会话按请求顺序每项恰好发一个 `frame`
//!   （`request.kind = schedule, index`）或 `frame_missing`，最后发 `schedule_done`；新计划取消旧计划，计划进行中 `frame_at` 返回 BUSY；
//! - `cancel_schedule`、`stop_stream`、`release_frame` 同 1.2。
//!
//! 时间口径见 `timing.rs`；续解/新段/前导帧规则见 `plan.rs`。相邻请求续解不 flush；单帧定位与排空到文件末尾后
//! 回到前面时 flush。播放计划的剪辑点不 flush（帧内编码等软解保持多线程流水），但 HEVC/H.264 例外（3.1）：
//! 不 flush 时解码器按上一段推算新关键帧（CRA、非 IDR 的 I 帧）的图序号，相隔超过半个序号周期就算错，之后整段只剩
//! 关键帧一帧，所以这两种编码的剪辑点也先 flush。
//!
//! 剪辑点预先接续（3.6）：帧级多线程解码器要比输出多送“线程数 − 1”个包。时间点计划在剪辑点照常续送上一段时，这些包
//! 解出的帧在剪辑点全部作废，新段又要重新填满流水才出第一帧；CineForm 的熵解码在帧线程间串行，4K 每个剪辑点因此
//! 空出约 150ms，播放从此追不回来。所以全是关键包的段（帧内编码）在计划已知下一个剪辑点时，送完剪辑点之前所需的包
//! 就定位并开始送下一段，流水不空转、预解的帧都有用。H.264/HEVC（剪辑点必须 flush）与含非关键包的段照旧。

pub mod codec;
pub mod demux;
pub mod plan;
pub mod timing;

use serde_json::{json, Value};
use std::sync::atomic::Ordering;
use std::sync::mpsc::{Receiver, RecvTimeoutError, TryRecvError};
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::cancel::CancelToken;
use crate::logging;
use crate::protocol::ServiceError;
use crate::streams::StreamControl;
use crate::test_pattern::SharedFormat;
use codec::{Decoder, DecoderSetup, Frame, Purpose, Received};
use demux::{Input, Packet};
use plan::{handoff_wait, seek_decision, Claim, Decision, HandoffWait, Position, RunTracker, FORWARD_SEEK_SECONDS, NEAR_KEY_SECONDS};

/// 计划里向前跳过超过这么久（秒）也算剪辑点（预先接续直接定位过去，不解中间的帧）。
const CUT_FORWARD_SECONDS: f64 = 0.25;

/// 时间点计划中 `last` 之后跳到 `next` 的剪辑点（刻度）。
#[derive(Debug, Clone, Copy, PartialEq)]
struct Cut {
    last: i64,
    next: i64,
}

/// 计划中相邻两个时间之间是否为剪辑点（向后跳，或向前跳过一段）。
fn is_cut(from: f64, to: f64) -> bool {
    from.is_finite() && to.is_finite() && (to < from || to - from > CUT_FORWARD_SECONDS)
}
use timing::{duration_to_us, pts_to_seconds, pts_to_us, seconds_to_duration_ticks, seconds_to_ticks, TimeBase};

/// 单帧请求等空闲槽位的上限。
const FRAME_AT_SLOT_TIMEOUT: Duration = Duration::from_secs(2);
/// 单帧定位时，目标之前这么久（秒，至少 3 帧）以内的包照常全解，更早的跳过非参考帧。
const SKIP_NONREF_MARGIN_SECONDS: f64 = 0.1;
/// 近似取帧（`keyOnly`）在同一 GOP 内向前续解最多再解出这么多帧：快速拖动每次请求都很快交出画面，解码器边交边追。
/// 4K H.264 每帧约 4.6ms（显卡时间），跳过非参考帧后 2 帧约前进 4 帧画面。
const KEY_ONLY_FORWARD_FRAMES: u32 = 2;
/// 交出前等显卡完成的上限（3.8）：超时照常交出。
const SETTLE_TIMEOUT: Duration = Duration::from_secs(2);
/// 送入这么多包仍无输出视为解码器卡死。
const STALL_PACKETS: u32 = 600;
pub const MAX_SCHEDULE_TIMES: usize = 200_000;

#[derive(Debug, Clone, PartialEq)]
pub struct DecodeOptions {
    pub stream_id: String,
    pub path: String,
    pub stream_index: Option<i32>,
    pub purpose: Purpose,
    pub pool_size: Option<u32>,
    pub hardware: bool,
    /// 强制输出格式（诊断与实验）；nv12 只允许 8 位 4:2:0 无透明素材。
    pub format: Option<SharedFormat>,
    /// 色彩空间传输特性标注覆盖（诊断：重要记录 007 的标注实验）。
    pub transfer: Option<String>,
}

impl DecodeOptions {
    pub fn validate(&self) -> Result<(), ServiceError> {
        let invalid = |message: &str| Err(ServiceError::new("INVALID_REQUEST", message));
        if self.stream_id.is_empty() || self.stream_id.len() > 128 {
            return invalid("streamId 无效");
        }
        if self.path.is_empty() || self.path.len() > 4096 {
            return invalid("路径无效");
        }
        if self.pool_size.is_some_and(|size| !(2..=crate::streams::MAX_POOL_SIZE).contains(&size)) {
            return invalid("纹理池大小超出范围");
        }
        if self.format.is_some_and(|format| !matches!(format, SharedFormat::Nv12 | SharedFormat::Rgbaf16)) {
            return invalid("解码输出只支持 nv12 或 rgbaf16");
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum SchedulePlan {
    Times(Vec<f64>),
    Range { from: f64, to: Option<f64> },
}

#[derive(Debug)]
pub enum SessionCommand {
    FrameAt { request_id: String, time: f64, ticket: String, key_only: bool, cancel: CancelToken },
    Schedule { schedule_id: String, plan: SchedulePlan },
    Cancel { schedule_id: String },
}

/// 计划为什么中止。
enum Abort {
    Cancelled,
    Stopped,
    Failed(ServiceError),
}

impl From<ServiceError> for Abort {
    fn from(error: ServiceError) -> Self {
        if error.code == "CANCELLED" {
            Abort::Stopped
        } else {
            Abort::Failed(error)
        }
    }
}

/// 单帧取帧被客户端取消（新请求取代了它）。
fn superseded() -> ServiceError {
    ServiceError::new("CANCELLED", "取帧已被新请求取代")
}

/// 会话已停止（关闭流、服务关闭）：在途与排队的单帧取帧都这样答复。
fn session_stopped() -> ServiceError {
    ServiceError::new("CANCELLED", "解码会话已停止")
}

#[derive(Clone)]
enum RequestTag {
    FrameAt(String),
    Schedule { id: String, index: usize },
}

impl RequestTag {
    fn value(&self) -> Value {
        match self {
            RequestTag::FrameAt(ticket) => json!({ "kind": "frame_at", "id": ticket }),
            RequestTag::Schedule { id, index } => json!({ "kind": "schedule", "id": id, "index": index }),
        }
    }
}

pub use imp::spawn;

/// 会话实现：只经平台层接口（`platform::VideoPlatform` / `FrameOutput`）接触显卡与共享纹理。
mod imp {
    use super::*;
    use crate::convert::{format_info, output_format, write_path, ColorInfo};
    use crate::platform::{FrameOutput, VideoPlatform};
    use crate::streams::StreamResources;

    /// 预先接续的下一段。
    struct Queued {
        next: i64,
        /// 下一段已出的第一帧（出现即说明正在交付的段已出完）。
        first: Option<Frame>,
        ended: bool,
        /// 下一段没有可解的关键帧：已改为排空当前段，剪辑点照常定位。
        failed: bool,
    }

    /// 送包取帧的结果。
    enum Fetched {
        Frame(Frame),
        /// 当前段没有更多帧（文件结束）。
        End,
        /// 预先接续的下一段的帧。
        Queued(Frame),
        /// 下一个包已超出剪辑点前所需的范围（留在 pending，未送入）。
        Limit,
    }

    /// 打开失败的会话没有资源。
    struct NoResources;
    impl StreamResources for NoResources {
        fn release(self: Box<Self>) -> Vec<String> {
            Vec::new()
        }
    }

    struct Session {
        stream_id: String,
        /// 显存登记与硬解名额（3.1 预算）：随会话结束归还。
        _vram: crate::budget::VramTicket,
        _hardware: Option<crate::budget::HardwareTicket>,
        platform: Arc<dyn VideoPlatform>,
        control: Arc<StreamControl>,
        commands: Receiver<SessionCommand>,
        deferred: Option<SessionCommand>,
        schedule: Option<String>,
        input: Input,
        decoder: Decoder,
        /// 平台层输出（共享纹理池 + 转换器）。
        frames: Box<dyn FrameOutput>,
        output: SharedFormat,
        visible: (u32, u32),
        color: ColorInfo,
        time_base: TimeBase,
        frame_rate: f64,
        tracker: RunTracker,
        pending_packet: Option<Packet>,
        candidate: Option<Frame>,
        lookahead: Option<Frame>,
        last_fed_dts: Option<i64>,
        /// 文件第一个关键包的时间（刻度）：目标早于它时不再向前回退。
        first_key_ts: Option<i64>,
        draining: bool,
        drained: bool,
        fed_since_output: u32,
        delivered: u64,
        forward_limit: i64,
        /// 见 `plan::NEAR_KEY_SECONDS`（刻度）。
        near_key: i64,
        /// 剪辑点是否 flush：图序号跨关键帧推算的编码（H.264、HEVC）必须 flush（3.1）。
        flush_cuts: bool,
        /// 时间点计划中当前段之后的剪辑点（计划逐项设置）。
        cut: Option<Cut>,
        queued: Option<Queued>,
        /// 送入当前送包段的包是否都是关键包（预先接续的前提：无重排，按包时间即可判断剪辑点前所需的包）。
        run_all_key: bool,
        fallback_logged: bool,
        decode_error_count: u64,
        /// 上次交出帧时本会话已解出（含丢弃）的帧数；交出前按差值判断是否先等显卡完成（3.8）。
        decoded_at_handoff: u64,
        /// 正在执行有终点的区间取帧（拖动的解码窗口）：每帧交出前等上一帧的显卡工作完成（3.8）。
        paced: bool,
        settle_logged: bool,
        /// 单帧定位走向目标时，呈现时间早于它的包跳过非参考帧：这些帧既不显示也不被参考，4 秒 GOP 的 4K 录屏
        /// 定位到 GOP 末尾实测从 1.1 秒降到 0.58 秒。只在 `frame_at` 推进期间设置，播放计划与预打开不跳。
        skip_before: Option<i64>,
        /// 当前段里按 `skip_before` 标记跳过、呈现时间晚于候选帧的包（开新段时清空，每次单帧取帧后去掉不晚于候选帧的）。
        /// 解码器送包领先于出帧，半途停下（近似取帧、被取消）时这里会留下候选帧之后跳过的包；之后的取帧若有落在
        /// 候选帧与目标之间的，那里可能缺被跳过的帧：单帧取帧不跳过重解，播放计划与区间取帧先重新定位（`force_seek`）。
        /// 只记最晚的一个不够：它晚于目标时，目标之前同样可能缺帧。
        run_skipped: Vec<i64>,
        /// 下一次 `locate` 必须开新段（见 `run_skipped`）。
        force_seek: bool,
        /// 正在处理的单帧取帧的取消标志（只在 `frame_at` 期间有值）。
        cancel: Option<CancelToken>,
    }

    fn frame_ts(frame: &Frame) -> i64 {
        frame.timestamp().unwrap_or(i64::MIN)
    }

    /// 启动会话线程：打开文件并响应 `request_id`，之后处理命令直到停止。
    pub fn spawn(request_id: String, platform: Arc<dyn VideoPlatform>, options: DecodeOptions, control: Arc<StreamControl>, commands: Receiver<SessionCommand>, budget: crate::budget::Budget) -> std::io::Result<std::thread::JoinHandle<Box<dyn StreamResources>>> {
        std::thread::Builder::new().name(format!("decode-{}", options.stream_id)).spawn(move || -> Box<dyn StreamResources> {
            let started = Instant::now();
            let device = platform.clone();
            match Session::open(platform, &options, control.clone(), commands, &budget) {
                Ok((mut session, mut info)) => {
                    info["setupMs"] = json!(started.elapsed().as_secs_f64() * 1000.0);
                    let phases = info.as_object_mut().and_then(|fields| fields.remove("openPhasesMs"));
                    logging::info("decode.session.opened", "解码会话已打开", json!({ "streamId": options.stream_id, "path": options.path, "purpose": format!("{:?}", options.purpose), "decoder": info["decoder"], "format": info["format"], "color": info["color"], "setupMs": info["setupMs"], "openPhasesMs": phases }));
                    crate::respond(&request_id, Ok(info));
                    session.run();
                    let Session { frames, .. } = session;
                    frames.into_resources()
                }
                Err(error) => {
                    // A lost device fails every session the same way: exit so the main process restarts with a new one.
                    if matches!(error.code, "GPU_FAILED" | "DECODE_FAILED") {
                        crate::platform::exit_if_device_lost(device.as_ref(), "open_decoder");
                    }
                    control.open_failed.store(true, Ordering::Release);
                    logging::warn("decode.session.open_failed", &error.message, json!({ "streamId": options.stream_id, "path": options.path, "code": error.code }));
                    crate::respond(&request_id, Err(error));
                    Box::new(NoResources)
                }
            }
        })
    }

    impl Session {
        fn open(platform: Arc<dyn VideoPlatform>, options: &DecodeOptions, control: Arc<StreamControl>, commands: Receiver<SessionCommand>, budget: &crate::budget::Budget) -> Result<(Self, Value), ServiceError> {
            let opening = Instant::now();
            let input = Input::open(&options.path, options.stream_index, control.stop.clone())?;
            let input_ms = opening.elapsed().as_secs_f64() * 1000.0;
            let stream = input.stream();
            let parameters = input.parameters();
            let has_alpha_tag = crate::probe::stream_has_alpha(stream, parameters);
            // Hardware decoders are a bounded resource (3.1): past the limit this session decodes in software.
            let mut hardware_ticket = if options.hardware { budget.hardware() } else { None };
            if options.hardware && hardware_ticket.is_none() {
                logging::warn("decode.budget.software_fallback", "硬件解码会话已达上限，本会话改用软解", json!({ "streamId": options.stream_id, "limits": budget.stats() }));
            }
            let hardware = if hardware_ticket.is_some() {
                match platform.hardware_device() {
                    Ok(device) => Some(device),
                    Err(reason) => {
                        logging::warn("decode.hardware_unavailable", &reason, json!({}));
                        None
                    }
                }
            } else {
                None
            };
            let profiles = |name: &str| platform.has_decoder_profile(name);
            let decoder = Decoder::open(DecoderSetup { parameters, time_base: stream.time_base, has_alpha: has_alpha_tag, purpose: options.purpose, hardware, device_profiles: &profiles })?;
            let time_base = input.time_base;
            let frame_rate = crate::probe::preferred_frame_rate(stream.avg_frame_rate, stream.r_frame_rate).unwrap_or(0.0);
            let start_ticks = (stream.start_time != ffmpeg_sys_next::AV_NOPTS_VALUE).then_some(stream.start_time);
            let duration_ticks = (stream.duration > 0).then_some(stream.duration);
            let rotation = crate::probe::stream_rotation(parameters);
            let codec_name = crate::ffmpeg_info::c_text(unsafe { ffmpeg_sys_next::avcodec_get_name(parameters.codec_id) });
            let container = input.format_name();
            let forward_limit = seconds_to_duration_ticks(FORWARD_SEEK_SECONDS, time_base);
            let near_key = seconds_to_duration_ticks(NEAR_KEY_SECONDS, time_base);
            let flush_cuts = matches!(parameters.codec_id, ffmpeg_sys_next::AVCodecID::AV_CODEC_ID_H264 | ffmpeg_sys_next::AVCodecID::AV_CODEC_ID_HEVC);

            // 先解出第一帧：确定实际像素格式（硬解或软解）与色彩，再按它建纹理池。
            let decoder_ms = opening.elapsed().as_secs_f64() * 1000.0;
            let mut session_parts = Primer { input, decoder, tracker: RunTracker::default(), pending: None, last_fed_dts: None, draining: false, drained: false, tracker_key: None, all_key: true };
            let mut first = session_parts.first_frame(&control)?;
            if !first.is_hardware() && session_parts.decoder.single_thread_for_hardware {
                // 硬件初始化没成功、落到了软解：按硬解开的单线程软解太慢，按软解（多线程）重新打开。
                logging::info("decode.hardware_fallback_reopen", "硬解未生效，按软解重新打开解码器", json!({ "streamId": options.stream_id, "decoder": session_parts.decoder.name }));
                drop(first);
                let Primer { mut input, .. } = session_parts;
                input.seek_start()?;
                let decoder = Decoder::open(DecoderSetup { parameters: input.parameters(), time_base: input.stream().time_base, has_alpha: has_alpha_tag, purpose: options.purpose, hardware: None, device_profiles: &profiles })?;
                session_parts = Primer { input, decoder, tracker: RunTracker::default(), pending: None, last_fed_dts: None, draining: false, drained: false, tracker_key: None, all_key: true };
                first = session_parts.first_frame(&control)?;
            }
            let content = first.content_format();
            let info = format_info(content).ok_or_else(|| ServiceError::new("UNSUPPORTED_FORMAT", "无法识别解码输出的像素格式"))?;
            let has_alpha = info.has_alpha || has_alpha_tag;
            let natural = if has_alpha { SharedFormat::Rgbaf16 } else { output_format(&info) };
            let output = match options.format {
                Some(SharedFormat::Nv12) if natural != SharedFormat::Nv12 => return Err(ServiceError::new("INVALID_REQUEST", "该素材不是 8 位 4:2:0 无透明画面，不能输出 nv12")),
                Some(format) => format,
                None => natural,
            };
            let (width, height) = first.size();
            if width == 0 || height == 0 || width > crate::streams::MAX_DIMENSION || height > crate::streams::MAX_DIMENSION {
                return Err(ServiceError::new("UNSUPPORTED_FORMAT", format!("画面尺寸 {width}x{height} 超出范围")));
            }
            let pool_dimensions = if output == SharedFormat::Nv12 { (width.next_multiple_of(2), height.next_multiple_of(2)) } else { (width, height) };
            let frame = unsafe { &*first.0 };
            let color = ColorInfo::resolve(frame.colorspace, frame.color_primaries, frame.color_trc, frame.color_range, frame.chroma_location, content);
            if color.hdr {
                logging::warn("decode.hdr_as_sdr", "素材带 HDR 传输特性，按 SDR 解释", json!({ "path": options.path }));
            }
            // 首帧之后的路径检查：主流格式不应落到 CPU 回落（性能验收不得依赖）。
            let path = write_path(output, first.format(), first.hardware_sw_format()).map_err(|message| ServiceError::new("UNSUPPORTED_FORMAT", message))?;
            let default_pool = match (options.purpose, output) {
                (Purpose::Seek, _) => 3,
                (Purpose::Playback, SharedFormat::Nv12) => 8,
                (Purpose::Playback, _) => 6,
            };
            let pool_size = options.pool_size.unwrap_or(default_pool);
            let hardware_active = first.is_hardware();
            if !hardware_active {
                // Software decode after all (no hardware profile, or the device refused): the slot goes back.
                hardware_ticket = None;
            }
            // Video memory budget (3.1): the pool, this path's intermediates and the hardware surface pool.
            let surface = hardware_active.then(|| if first.hardware_sw_format().and_then(format_info).is_some_and(|info| info.depth > 8) { SharedFormat::P010le } else { SharedFormat::Nv12 });
            let memory_bytes = crate::budget::session_bytes(output, pool_dimensions, pool_size, path, surface);
            let vram = budget.reserve_vram(&options.stream_id, memory_bytes)?;
            let first_ms = opening.elapsed().as_secs_f64() * 1000.0;
            let frames = platform.create_frame_output(output, pool_dimensions, (width, height), pool_size).map_err(|message| ServiceError::new("GPU_FAILED", message))?;
            let output_ms = opening.elapsed().as_secs_f64() * 1000.0;
            control.slots.resize(pool_size as usize);
            control.set_info(output, pool_dimensions.0, pool_dimensions.1);
            let handles: Vec<Value> = frames.remote_handles().iter().enumerate().map(|(slot, handle)| json!({ "slot": slot, "handle": handle.to_string() })).collect();
            let color_space = color.electron_color_space(output, options.transfer.as_deref());
            let decoder_info = json!({
                "codec": codec_name,
                "decoderName": session_parts.decoder.name,
                "hardware": hardware_active,
                "hardwareRequested": session_parts.decoder.hardware_requested,
                "pixelFormat": info.name,
                "bitDepth": info.depth,
                "chromaLog2": [info.log2_chroma_w, info.log2_chroma_h],
                "hasAlpha": has_alpha,
                "path": path.name(),
                "intraOnly": session_parts.decoder.intra_only,
            });
            let first_ts = frame_ts(&first);
            let response = json!({
                "streamId": options.stream_id,
                "format": output.name(),
                "codedSize": { "width": pool_dimensions.0, "height": pool_dimensions.1 },
                "visibleRect": { "x": 0, "y": 0, "width": width, "height": height },
                "colorSpace": color_space,
                "fps": frame_rate,
                "keyedMutex": true,
                "slots": handles,
                "decoder": decoder_info,
                "color": color.describe(),
                "container": container,
                "timeBase": { "num": time_base.num, "den": time_base.den },
                "startSeconds": start_ticks.map(|ticks| pts_to_seconds(ticks, time_base)),
                "endSeconds": start_ticks.zip(duration_ticks).map(|(start, duration)| pts_to_seconds(start + duration, time_base)),
                "firstFramePtsUs": pts_to_us(first_ts, time_base),
                "frameRate": frame_rate,
                "rotationDegrees": rotation,
                "purpose": format!("{:?}", options.purpose).to_lowercase(),
                "memoryBytes": memory_bytes,
                // 打开各阶段的累计耗时（诊断）：解封装、建解码器、解出第一帧、建共享纹理池。
                "openPhasesMs": { "input": input_ms, "decoder": decoder_ms, "firstFrame": first_ms, "output": output_ms },
            });
            let first_key_ts = session_parts.tracker_key;
            let Primer { input, decoder, tracker, pending, last_fed_dts, draining, drained, all_key, .. } = session_parts;
            let session = Session {
                stream_id: options.stream_id.clone(),
                _vram: vram,
                _hardware: hardware_ticket,
                platform,
                control,
                commands,
                deferred: None,
                schedule: None,
                input,
                decoder,
                frames,
                output,
                visible: (width, height),
                color,
                time_base,
                frame_rate,
                tracker,
                pending_packet: pending,
                candidate: None,
                lookahead: Some(first),
                last_fed_dts,
                first_key_ts,
                draining,
                drained,
                fed_since_output: 0,
                delivered: 0,
                forward_limit,
                near_key,
                flush_cuts,
                cut: None,
                queued: None,
                run_all_key: all_key,
                fallback_logged: false,
                decode_error_count: 0,
                decoded_at_handoff: 0,
                paced: false,
                settle_logged: false,
                skip_before: None,
                run_skipped: Vec::new(),
                force_seek: false,
                cancel: None,
            };
            Ok((session, response))
        }

        fn stopped(&self) -> bool {
            self.control.stop.load(Ordering::Relaxed)
        }

        /// 正在处理的单帧取帧已被客户端取消。
        fn cancelled(&self) -> bool {
            self.cancel.as_ref().is_some_and(CancelToken::is_cancelled)
        }

        fn run(&mut self) {
            loop {
                if self.stopped() {
                    break;
                }
                let command = match self.deferred.take() {
                    Some(command) => command,
                    None => match self.commands.recv_timeout(Duration::from_millis(50)) {
                        Ok(command) => command,
                        Err(RecvTimeoutError::Timeout) => continue,
                        Err(RecvTimeoutError::Disconnected) => break,
                    },
                };
                match command {
                    SessionCommand::FrameAt { request_id, time, ticket, key_only, cancel } => {
                        let result = self.answer_frame_at(time, ticket, key_only, cancel);
                        crate::respond(&request_id, result);
                    }
                    SessionCommand::Schedule { schedule_id, plan } => self.run_schedule(schedule_id, plan),
                    SessionCommand::Cancel { .. } => {}
                }
            }
            // 停止时队列里还没处理的单帧取帧逐个答复，客户端不必等到超时。
            for request_id in self.unanswered_frame_ats() {
                crate::respond(&request_id, Err(session_stopped()));
            }
        }

        /// 取出队列里剩下的单帧取帧（会话停止后调用），返回它们的请求 ID；取消标志随命令出表。
        /// 停止时主线程不再派发新命令，取完即全部。计划已在派发前确认，随会话停止不另答复。
        fn unanswered_frame_ats(&mut self) -> Vec<String> {
            std::iter::from_fn(|| self.commands.try_recv().ok())
                .filter_map(|command| match command {
                    SessionCommand::FrameAt { request_id, .. } => Some(request_id),
                    _ => None,
                })
                .collect()
        }

        fn position(&self) -> Position {
            Position {
                last_fed_dts: self.tracker.current().and(self.last_fed_dts.or(Some(i64::MIN))),
                candidate_pts: self.candidate.as_ref().map(frame_ts),
                latest_pts: self.lookahead.as_ref().or(self.candidate.as_ref()).map(frame_ts),
                drained: self.drained,
            }
        }

        /// 定位到 `ticks` 所在关键帧，返回段首关键包。落点晚于目标时向前回退重试。
        fn seek_to_key(&mut self, ticks: i64) -> Result<Option<Packet>, ServiceError> {
            let mut target = ticks;
            let mut previous_key: Option<i64> = None;
            for attempt in 0..5 {
                if attempt == 4 {
                    self.input.seek_start()?;
                } else {
                    self.input.seek(target)?;
                }
                let key = loop {
                    match self.input.read()? {
                        None => break None,
                        Some(packet) if packet.is_key() => break Some(packet),
                        Some(_) => {}
                    }
                };
                let Some(packet) = key else {
                    if attempt == 4 {
                        return Ok(None);
                    }
                    target = ticks.saturating_sub(seconds_to_duration_ticks(3f64.powi(attempt), self.time_base));
                    continue;
                };
                let key_ts = packet.timestamp().unwrap_or(i64::MIN);
                // 落点不晚于目标、已是文件第一个关键帧（目标早于首帧），或已回到开头，就用它。
                if key_ts <= ticks || attempt == 4 || self.first_key_ts.is_some_and(|first| key_ts <= first) {
                    return Ok(Some(packet));
                }
                // 无索引容器（如 MPEG-PS）的定位不精确：同一落点重复出现时直接加大回退量。
                let repeated = previous_key == Some(key_ts);
                previous_key = Some(key_ts);
                // 落在目标之后（B 帧使关键帧解码时间早于呈现时间，或解封装定位不准）：再往前。
                let backoff = if repeated { attempt } else { attempt - 1 };
                target = if attempt == 0 { packet.dts().unwrap_or(key_ts).min(ticks).saturating_sub(1) } else { ticks.saturating_sub(seconds_to_duration_ticks(3f64.powi(backoff), self.time_base)) };
            }
            Ok(None)
        }

        /// 开新段。`flush` 为真时清空解码器（单帧会话、H.264/HEVC 的剪辑点）；为假时旧段帧按认领规则丢弃。
        fn start_run(&mut self, ticks: i64, flush: bool) -> Result<(), ServiceError> {
            self.candidate = None;
            self.lookahead = None;
            self.pending_packet = None;
            // 放弃尚未用上的预接续段：新段开始后它的帧都不再认领。
            self.queued = None;
            self.run_all_key = true;
            self.run_skipped.clear();
            self.force_seek = false;
            let key = self.seek_to_key(ticks)?;
            let counters = &self.control.counters;
            counters.seeks.fetch_add(1, Ordering::Relaxed);
            // 排空到文件末尾后，FFmpeg 只能经 flush 复位（与“播放中不 flush”分开计数）。
            let must_flush = flush || self.draining || self.drained;
            if flush {
                counters.flushes.fetch_add(1, Ordering::Relaxed);
            } else if must_flush {
                counters.eof_flushes.fetch_add(1, Ordering::Relaxed);
            } else {
                counters.cuts.fetch_add(1, Ordering::Relaxed);
            }
            if must_flush {
                self.decoder.flush();
            }
            self.draining = false;
            self.drained = false;
            self.fed_since_output = 0;
            match key {
                Some(packet) => {
                    self.tracker.begin(packet.timestamp().unwrap_or(i64::MIN));
                    if must_flush {
                        self.tracker.flushed();
                    }
                    self.pending_packet = Some(packet);
                }
                None => {
                    // 目标之后没有可解的关键帧：本段没有画面。
                    self.tracker.begin(i64::MAX);
                    self.draining = true;
                    self.drained = true;
                }
            }
            Ok(())
        }

        /// 下一个属于当前段的帧（呈现顺序）；文件结束、或预先接续时当前段已出完，返回 None。
        fn next_frame(&mut self) -> Result<Option<Frame>, ServiceError> {
            loop {
                if self.queued.as_ref().is_some_and(|queued| queued.ended) {
                    return Ok(None);
                }
                let limit = self.prefeed_limit();
                let feed = Feed { pending: &mut self.pending_packet, last_fed_dts: &mut self.last_fed_dts, draining: &mut self.draining, drained: &mut self.drained, fed_since_output: &mut self.fed_since_output, decode_errors: &mut self.decode_error_count, all_key: &mut self.run_all_key, skip_before: self.skip_before, skipped: &mut self.run_skipped };
                match next_frame(&mut self.decoder, &mut self.input, &mut self.tracker, feed, &self.control, limit)? {
                    Fetched::Frame(frame) => return Ok(Some(frame)),
                    Fetched::End => return Ok(None),
                    Fetched::Queued(frame) => match self.queued.as_mut() {
                        Some(queued) => {
                            queued.first = Some(frame);
                            queued.ended = true;
                            return Ok(None);
                        }
                        // 只有预接续段的帧才是 Queued；没有预接续段时不会出现。
                        None => return Ok(Some(frame)),
                    },
                    Fetched::Limit => self.prefeed()?,
                }
            }
        }

        /// 当前段只送时间不晚于它的包：时间点计划已知下一个剪辑点、尚未预先接续、段内全是关键包。
        fn prefeed_limit(&self) -> Option<i64> {
            let cut = self.cut?;
            (self.queued.is_none() && !self.flush_cuts && self.run_all_key && !self.draining && !self.drained).then_some(cut.last)
        }

        /// 剪辑点之前所需的包已送完：定位到剪辑点之后的关键帧，开始送下一段（流水不空转）。
        fn prefeed(&mut self) -> Result<(), ServiceError> {
            let Some(cut) = self.cut else { return Ok(()) };
            // 已读出、超出剪辑点的上一段的包不再送入。
            self.pending_packet = None;
            let key = self.seek_to_key(cut.next)?;
            self.control.counters.seeks.fetch_add(1, Ordering::Relaxed);
            match key {
                Some(packet) => {
                    self.tracker.begin_queued(packet.timestamp().unwrap_or(i64::MIN));
                    self.run_all_key = true;
                    self.pending_packet = Some(packet);
                    self.queued = Some(Queued { next: cut.next, first: None, ended: false, failed: false });
                }
                None => {
                    // 剪辑点之后没有可解的关键帧：排空当前段让它出完，剪辑点照常定位（排空后会 flush）。
                    self.decoder.send(None)?;
                    self.draining = true;
                    self.queued = Some(Queued { next: cut.next, first: None, ended: false, failed: true });
                }
            }
            Ok(())
        }

        /// 剪辑点到了：预先接续的段成为当前段，它已出的第一帧作为前瞻帧。
        fn activate_queued(&mut self) {
            let Some(queued) = self.queued.take() else { return };
            self.tracker.activate_queued();
            self.candidate = None;
            self.lookahead = queued.first;
            let counters = &self.control.counters;
            counters.cuts.fetch_add(1, Ordering::Relaxed);
            counters.prefed_cuts.fetch_add(1, Ordering::Relaxed);
        }

        /// 推进到 `ticks`：候选帧 = 呈现时间 ≤ ticks 的最后一帧，前瞻帧 = 其后一帧。
        /// 帧内编码且无输出延迟（单帧会话）时只需看下一个包的时间就知道候选帧是否最终，不必多解一帧。
        fn advance_to(&mut self, ticks: i64) -> Result<(), ServiceError> {
            self.advance_within(ticks, None).map(|_| ())
        }

        /// 同 `advance_to`，但最多再解出 `max_frames` 帧就停在已解出的候选帧上（至少要有一帧）。返回是否已推进到目标。
        /// 按帧数而不按时间限：硬解提交是异步的，几毫秒就能交给显卡十几帧，真正的解码时间在交出前等显卡完成时才付。
        /// 单帧取帧被取消时在同一处停下（已有候选帧时才停，停下的状态与半途停下的近似取帧相同）。
        fn advance_within(&mut self, ticks: i64, max_frames: Option<u32>) -> Result<bool, ServiceError> {
            let mut decoded = 0u32;
            loop {
                if self.stopped() {
                    return Err(ServiceError::new("CANCELLED", "解码已停止"));
                }
                if let Some(next) = &self.lookahead {
                    if frame_ts(next) <= ticks {
                        self.candidate = self.lookahead.take();
                        continue;
                    }
                    return Ok(true);
                }
                if self.decoder.immediate_output && self.candidate.is_some() && !self.draining && !self.drained {
                    if self.pending_packet.is_none() {
                        self.pending_packet = self.input.read()?;
                    }
                    if self.pending_packet.as_ref().and_then(|packet| packet.pts()).is_some_and(|pts| pts > ticks) {
                        return Ok(true);
                    }
                }
                if self.candidate.is_some() {
                    if self.cancelled() {
                        return Err(superseded());
                    }
                    if max_frames.is_some_and(|limit| decoded >= limit) {
                        return Ok(false);
                    }
                }
                match self.next_frame()? {
                    Some(frame) => {
                        decoded += 1;
                        self.lookahead = Some(frame);
                    }
                    None => return Ok(true),
                }
            }
        }

        /// 当前候选帧已是 `ticks` 处的画面（候选帧不晚于它，且下一帧晚于它）。
        fn covers(&self, ticks: i64) -> bool {
            let Some(candidate) = self.candidate.as_ref().map(frame_ts) else { return false };
            candidate <= ticks && self.lookahead.as_ref().map(frame_ts).is_some_and(|next| ticks < next)
        }

        /// 取 `ticks` 是否必须重新定位（向后、或跳到别的 GOP）；同一 GOP 内向前时续解即可，近似取帧也照常续解到精确帧。
        fn needs_seek(&self, ticks: i64) -> bool {
            let key = self.input.key_before(ticks);
            seek_decision(ticks, &self.position(), key, self.forward_limit, self.near_key) == Decision::Seek
        }

        /// 定位到 `ticks` 所在关键帧，只解出这一帧作为候选帧（不再向前推进到目标）。返回是否定位过（总是）。
        fn locate_key(&mut self, ticks: i64) -> Result<bool, ServiceError> {
            self.start_run(ticks, true)?;
            self.candidate = self.next_frame()?;
            Ok(true)
        }

        /// 按需定位并推进到 `ticks`。返回是否定位过。
        fn locate(&mut self, ticks: i64, flush_on_seek: bool) -> Result<bool, ServiceError> {
            if self.force_seek {
                self.start_run(ticks, true)?;
                self.advance_to(ticks)?;
                return Ok(true);
            }
            if let Some(queued) = &self.queued {
                // 预先接续中：剪辑点之后的第一个时间切到下一段；剪辑点之前的时间仍在当前段续解（已送的包属于下一段，
                // 不能再按送包位置判断续解还是定位）；其余（计划变了、单帧定位）放弃预接续段，照常定位。
                if !flush_on_seek && !queued.failed && ticks == queued.next {
                    self.activate_queued();
                    self.advance_to(ticks)?;
                    return Ok(true);
                }
                let in_current = self.cut.is_some_and(|cut| ticks <= cut.last) && self.candidate.as_ref().is_none_or(|frame| ticks >= frame_ts(frame));
                if !flush_on_seek && in_current {
                    self.advance_to(ticks)?;
                    return Ok(false);
                }
                self.start_run(ticks, flush_on_seek || self.flush_cuts)?;
                self.advance_to(ticks)?;
                return Ok(true);
            }
            let key = self.input.key_before(ticks);
            let decision = seek_decision(ticks, &self.position(), key, self.forward_limit, self.near_key);
            let seeked = decision == Decision::Seek;
            if seeked {
                self.start_run(ticks, flush_on_seek || self.flush_cuts)?;
            }
            self.advance_to(ticks)?;
            Ok(seeked)
        }

        /// 处理排队的命令（计划进行中）。返回 true 表示当前计划应中止。
        fn poll_interrupt(&mut self) -> bool {
            loop {
                match self.commands.try_recv() {
                    Ok(SessionCommand::Cancel { schedule_id }) => {
                        if self.schedule.as_deref() == Some(schedule_id.as_str()) {
                            return true;
                        }
                    }
                    Ok(command @ SessionCommand::Schedule { .. }) => {
                        self.deferred = Some(command);
                        return true;
                    }
                    Ok(SessionCommand::FrameAt { request_id, .. }) => {
                        crate::respond(&request_id, Err(ServiceError::new("BUSY", "该会话正在执行连续取帧计划")));
                    }
                    Err(TryRecvError::Empty) => return false,
                    Err(TryRecvError::Disconnected) => return true,
                }
            }
        }

        /// 等一个空闲槽位。单帧取帧被取消时不再等（`Abort::Cancelled`）。
        fn wait_slot(&mut self, deadline: Option<Instant>, interruptible: bool) -> Result<u32, Abort> {
            let started = Instant::now();
            let result = loop {
                if self.stopped() {
                    break Err(Abort::Stopped);
                }
                if self.cancelled() {
                    break Err(Abort::Cancelled);
                }
                if let Some(slot) = self.control.slots.acquire() {
                    break Ok(slot);
                }
                if interruptible && self.poll_interrupt() {
                    break Err(Abort::Cancelled);
                }
                if deadline.is_some_and(|deadline| Instant::now() > deadline) {
                    break Err(Abort::Failed(ServiceError::new("BUSY", "纹理池已满：消费方未及时交回帧")));
                }
                self.control.slots.wait_freed(Duration::from_millis(2));
            };
            self.control.counters.wait_us.fetch_add(started.elapsed().as_micros() as u64, Ordering::Relaxed);
            result
        }

        /// 把候选帧写入一个槽位并发出 `frame` 事件。
        fn deliver(&mut self, request: RequestTag, deadline: Option<Instant>, interruptible: bool) -> Result<Value, Abort> {
            let Some(frame) = self.candidate.as_ref() else {
                return Err(Abort::Failed(ServiceError::new("INTERNAL", "没有候选帧")));
            };
            if frame.size() != self.visible {
                return Err(Abort::Failed(ServiceError::new("FORMAT_CHANGED", format!("画面尺寸由 {:?} 变为 {:?}", self.visible, frame.size()))));
            }
            let path = write_path(self.output, frame.format(), frame.hardware_sw_format()).map_err(|message| Abort::Failed(ServiceError::new("FORMAT_CHANGED", message)))?;
            let slot = self.wait_slot(deadline, interruptible)?;
            let frame = self.candidate.as_ref().expect("上面已确认");
            let result = unsafe { self.frames.write(frame.0, slot, path, &self.color, frame.premultiplied()) };
            let stats = match result {
                Ok(stats) => stats,
                Err(message) => {
                    self.control.slots.release(slot);
                    crate::platform::exit_if_device_lost(self.platform.as_ref(), "write_frame");
                    return Err(Abort::Failed(ServiceError::new("GPU_FAILED", message)));
                }
            };
            if self.frames.cpu_fallback_used() && !self.fallback_logged {
                self.fallback_logged = true;
                logging::warn("decode.cpu_convert_fallback", "罕见像素格式改用 CPU 转换", json!({ "streamId": self.stream_id, "pixelFormat": format_info(frame.format()).map(|info| info.name) }));
            }
            let counters = &self.control.counters;
            counters.produced.fetch_add(1, Ordering::Relaxed);
            counters.upload_us.fetch_add(stats.upload_us, Ordering::Relaxed);
            counters.map_us.fetch_add(stats.map_us, Ordering::Relaxed);
            counters.render_us.fetch_add(stats.submit_us, Ordering::Relaxed);
            let ts = frame_ts(frame);
            let duration = frame.duration();
            let pts_us = pts_to_us(ts, self.time_base);
            let duration_us = if duration > 0 { duration_to_us(ts, duration, self.time_base) } else if self.frame_rate > 0.0 { (1e6 / self.frame_rate).round() as i64 } else { 0 };
            self.wait_before_handoff();
            let frame_index = self.delivered;
            self.delivered += 1;
            crate::send(&json!({
                "event": "frame",
                "streamId": self.stream_id,
                "slot": slot,
                "frameIndex": frame_index,
                "timestampUs": pts_us,
                "ptsUs": pts_us,
                "durationUs": duration_us,
                "request": request.value(),
            }));
            Ok(json!({ "ptsUs": pts_us, "timestampSeconds": pts_to_seconds(ts, self.time_base), "durationSeconds": duration_us as f64 / 1e6 }))
        }

        /// 交出前按 `handoff_wait` 等本服务的显卡工作（3.8）：会话第一帧与定位后解过多帧才交出的帧等全部完成，
        /// 拖动的解码窗口等上一帧完成。等待失败或超时只记录一次，帧照常交出（客户端退回到在显卡上等待）。
        fn wait_before_handoff(&mut self) {
            let counters = &self.control.counters;
            let decoded = counters.decoded.load(Ordering::Relaxed) + counters.discarded.load(Ordering::Relaxed);
            let backlog = decoded.saturating_sub(self.decoded_at_handoff);
            self.decoded_at_handoff = decoded;
            let (result, waits, waited) = match handoff_wait(self.delivered, backlog, self.paced) {
                HandoffWait::None => return,
                HandoffWait::Full => (self.frames.settle(SETTLE_TIMEOUT), &counters.settles, &counters.settle_us),
                HandoffWait::Lagged => (self.frames.pace(SETTLE_TIMEOUT), &counters.paces, &counters.pace_us),
            };
            match result {
                Ok(waited_us) => {
                    waits.fetch_add(1, Ordering::Relaxed);
                    waited.fetch_add(waited_us, Ordering::Relaxed);
                }
                Err(message) => {
                    if !self.settle_logged {
                        self.settle_logged = true;
                        logging::warn("decode.settle_failed", &message, json!({ "streamId": self.stream_id, "backlog": backlog }));
                    }
                }
            }
        }

        /// 单帧取帧的答复。`cancel` 在处理期间挂在会话上：出队时已取消就不解码，解码途中与等槽位时取消就停下。
        /// 会话同时停止（关闭流、服务关闭）时答复会话已停止，不算被新请求取代。
        fn answer_frame_at(&mut self, time: f64, ticket: String, key_only: bool, cancel: CancelToken) -> Result<Value, ServiceError> {
            let started = Instant::now();
            self.cancel = Some(cancel);
            let result = if self.cancelled() { Err(superseded()) } else { self.frame_at_result(time, ticket, key_only, started) };
            let cancelled = self.cancelled();
            self.cancel = None;
            match result {
                Err(error) if error.code == "CANCELLED" && self.stopped() => Err(session_stopped()),
                Err(error) if error.code == "CANCELLED" && cancelled => {
                    self.control.counters.cancelled.fetch_add(1, Ordering::Relaxed);
                    Err(error)
                }
                other => other,
            }
        }

        fn frame_at_result(&mut self, time: f64, ticket: String, key_only: bool, started: Instant) -> Result<Value, ServiceError> {
            if !time.is_finite() {
                return Err(ServiceError::new("INVALID_REQUEST", "时间无效"));
            }
            let (seeked, approximate) = self.locate_frame(seconds_to_ticks(time, self.time_base), key_only).inspect_err(|error| {
                if error.code == "DECODE_FAILED" {
                    crate::platform::exit_if_device_lost(self.platform.as_ref(), "frame_at");
                }
            })?;
            if self.candidate.is_none() {
                self.control.counters.missing.fetch_add(1, Ordering::Relaxed);
                return Ok(json!({ "ticket": ticket, "found": false, "seeked": seeked, "decodeMs": started.elapsed().as_secs_f64() * 1000.0 }));
            }
            let mut value = match self.deliver(RequestTag::FrameAt(ticket.clone()), Some(Instant::now() + FRAME_AT_SLOT_TIMEOUT), false) {
                Ok(value) => value,
                Err(Abort::Failed(error)) => return Err(error),
                Err(Abort::Cancelled) => return Err(superseded()),
                Err(Abort::Stopped) => return Err(session_stopped()),
            };
            value["ticket"] = json!(ticket);
            value["found"] = json!(true);
            value["seeked"] = json!(seeked);
            if approximate {
                value["approximate"] = json!(true);
            }
            value["decodeMs"] = json!(started.elapsed().as_secs_f64() * 1000.0);
            Ok(value)
        }

        /// 按需定位并推进到 `ticks`，候选帧即答复的画面。返回（是否定位过，是否近似）。
        fn locate_frame(&mut self, ticks: i64, key_only: bool) -> Result<(bool, bool), ServiceError> {
            // 走向目标的途中跳过离目标足够远的非参考帧（`skip_before`）；目标附近照常全解，精确画面不变。
            let margin = seconds_to_duration_ticks(SKIP_NONREF_MARGIN_SECONDS.max(if self.frame_rate > 0.0 { 3.0 / self.frame_rate } else { 0.0 }), self.time_base);
            self.skip_before = Some(ticks.saturating_sub(margin));
            // 近似取帧（快速拖动、远距离跳转先出的画面）：已解出的候选帧就是目标时照常给精确帧；必须重新定位时只解目标所在
            // 关键帧；同一 GOP 内向前续解最多再解 `KEY_ONLY_FORWARD_FRAMES` 帧，没到目标就交出已解到的最后一帧（不晚于目标）。
            // 会话停在已解到的位置，同一时间随后的精确请求按“续解”从这里接着向前解。
            let mut approximate = false;
            let located = if key_only && !self.covers(ticks) && self.queued.is_none() {
                if self.needs_seek(ticks) {
                    approximate = true;
                    self.locate_key(ticks)
                } else {
                    self.advance_within(ticks, Some(KEY_ONLY_FORWARD_FRAMES)).map(|reached| {
                        approximate = !reached;
                        false
                    })
                }
            } else {
                self.locate(ticks, true)
            };
            // 候选帧之后、目标之前（含）有被标记跳过的包：目标前有一段超过边界的空档（可变帧率），或者之前半途停下的
            // 取帧在这里跳过了帧，被跳过的非参考帧里可能就有目标的画面，不跳过重解一次。
            let located = match located {
                Ok(_) if !approximate && self.candidate.as_ref().map(frame_ts).is_some_and(|candidate| self.run_skipped.iter().any(|&skipped| skipped > candidate && skipped <= ticks)) => {
                    logging::info("decode.skip_redo", "目标前可能缺被跳过的帧，不跳过重解", json!({ "streamId": self.stream_id, "ticks": ticks, "candidate": self.candidate.as_ref().map(frame_ts), "skipped": self.run_skipped.iter().max() }));
                    self.skip_before = None;
                    self.start_run(ticks, true).and_then(|_| self.advance_to(ticks)).map(|_| true)
                }
                other => other,
            };
            self.skip_before = None;
            // 不晚于候选帧的跳过不影响之后的取帧：同一段里候选帧只向前走，向后的取帧先开新段。
            if let Some(candidate) = self.candidate.as_ref().map(frame_ts) {
                self.run_skipped.retain(|&skipped| skipped > candidate);
            }
            located.map(|seeked| (seeked, approximate))
        }

        fn missing(&self, schedule_id: &str, index: usize, reason: &str) {
            self.control.counters.missing.fetch_add(1, Ordering::Relaxed);
            crate::send(&json!({ "event": "frame_missing", "streamId": self.stream_id, "scheduleId": schedule_id, "index": index, "reason": reason }));
        }

        fn run_schedule(&mut self, schedule_id: String, plan: SchedulePlan) {
            let started = Instant::now();
            self.schedule = Some(schedule_id.clone());
            self.cut = None;
            // 单帧取帧在当前段的候选帧之后跳过过帧：计划要逐帧交出，先重新定位。
            if !self.run_skipped.is_empty() {
                self.force_seek = true;
            }
            let delivered_before = self.delivered;
            let cuts_before = self.control.counters.cuts.load(Ordering::Relaxed);
            let prefed_before = self.control.counters.prefed_cuts.load(Ordering::Relaxed);
            // 有终点的区间是拖动的解码窗口；无终点的区间是顺序读取（导出、预滚），照常流水。
            self.paced = matches!(plan, SchedulePlan::Range { to: Some(_), .. });
            let result = match &plan {
                SchedulePlan::Times(times) => self.schedule_times(&schedule_id, times),
                SchedulePlan::Range { from, to } => self.schedule_range(&schedule_id, *from, *to),
            };
            self.paced = false;
            self.schedule = None;
            self.cut = None;
            let (reason, message) = match &result {
                Ok(()) => ("completed", None),
                Err(Abort::Cancelled) => ("cancelled", None),
                Err(Abort::Stopped) => return,
                Err(Abort::Failed(error)) => ("error", Some(error.message.clone())),
            };
            let summary = json!({
                "delivered": self.delivered - delivered_before,
                "cuts": self.control.counters.cuts.load(Ordering::Relaxed) - cuts_before,
                "prefedCuts": self.control.counters.prefed_cuts.load(Ordering::Relaxed) - prefed_before,
                "elapsedMs": started.elapsed().as_secs_f64() * 1000.0,
            });
            if let Some(message) = &message {
                logging::warn("decode.schedule.failed", message, json!({ "streamId": self.stream_id, "scheduleId": schedule_id, "summary": summary }));
            } else {
                logging::emit("debug", "decode.schedule.completed", "连续取帧计划结束", json!({ "streamId": self.stream_id, "scheduleId": schedule_id, "reason": reason, "summary": summary }));
            }
            crate::send(&json!({ "event": "schedule_done", "streamId": self.stream_id, "scheduleId": schedule_id, "reason": reason, "message": message, "counters": summary }));
        }

        fn schedule_times(&mut self, schedule_id: &str, times: &[f64]) -> Result<(), Abort> {
            let cuts: Vec<usize> = times.windows(2).enumerate().filter(|(_, pair)| is_cut(pair[0], pair[1])).map(|(index, _)| index).collect();
            let mut next_cut = 0;
            for (index, time) in times.iter().enumerate() {
                if self.stopped() {
                    return Err(Abort::Stopped);
                }
                // 当前段之后的第一个剪辑点（送包时据此预先接续下一段）。
                while next_cut < cuts.len() && cuts[next_cut] < index {
                    next_cut += 1;
                }
                self.cut = cuts.get(next_cut).map(|&last| Cut { last: seconds_to_ticks(times[last], self.time_base), next: seconds_to_ticks(times[last + 1], self.time_base) });
                if self.poll_interrupt() {
                    return Err(Abort::Cancelled);
                }
                if !time.is_finite() {
                    self.missing(schedule_id, index, "no_picture");
                    continue;
                }
                let ticks = seconds_to_ticks(*time, self.time_base);
                match self.locate(ticks, false) {
                    Ok(_) => {}
                    Err(error) if error.code == "CANCELLED" => return Err(Abort::Stopped),
                    Err(error) => {
                        crate::platform::exit_if_device_lost(self.platform.as_ref(), "schedule");
                        logging::warn("decode.schedule.frame_failed", &error.message, json!({ "streamId": self.stream_id, "index": index }));
                        self.missing(schedule_id, index, "decode_error");
                        continue;
                    }
                }
                if self.candidate.is_none() {
                    self.missing(schedule_id, index, "no_picture");
                    continue;
                }
                self.deliver(RequestTag::Schedule { id: schedule_id.to_string(), index }, None, true)?;
            }
            Ok(())
        }

        fn schedule_range(&mut self, schedule_id: &str, from: f64, to: Option<f64>) -> Result<(), Abort> {
            if !from.is_finite() {
                return Err(Abort::Failed(ServiceError::new("INVALID_REQUEST", "起点无效")));
            }
            let from_ticks = seconds_to_ticks(from, self.time_base);
            // [from, to)：to 换成“严格小于”的刻度上界。
            let to_ticks = to.filter(|value| value.is_finite()).map(|value| seconds_to_ticks(value, self.time_base)).unwrap_or(i64::MAX);
            self.locate(from_ticks, false)?;
            let mut index = 0;
            if self.candidate.as_ref().is_some_and(|frame| frame_ts(frame) < to_ticks) {
                self.deliver(RequestTag::Schedule { id: schedule_id.to_string(), index }, None, true)?;
                index += 1;
            }
            loop {
                if self.stopped() {
                    return Err(Abort::Stopped);
                }
                if self.poll_interrupt() {
                    return Err(Abort::Cancelled);
                }
                let next = match self.lookahead.take() {
                    Some(frame) => Some(frame),
                    None => self.next_frame()?,
                };
                let Some(frame) = next else { return Ok(()) };
                if frame_ts(&frame) >= to_ticks {
                    self.lookahead = Some(frame);
                    return Ok(());
                }
                self.candidate = Some(frame);
                self.deliver(RequestTag::Schedule { id: schedule_id.to_string(), index }, None, true)?;
                index += 1;
            }
        }
    }

    /// 送包状态（会话与打开阶段共用）。
    struct Feed<'a> {
        pending: &'a mut Option<Packet>,
        last_fed_dts: &'a mut Option<i64>,
        draining: &'a mut bool,
        drained: &'a mut bool,
        fed_since_output: &'a mut u32,
        decode_errors: &'a mut u64,
        all_key: &'a mut bool,
        /// 呈现时间早于它的包跳过非参考帧（单帧定位走向目标的途中，见 `Session::skip_before`）。
        skip_before: Option<i64>,
        /// 按 `skip_before` 标记跳过的包的呈现时间（见 `Session::run_skipped`）。
        skipped: &'a mut Vec<i64>,
    }

    /// 送包取帧的公共实现（打开时取第一帧与会话共用）。`limit`：只送时间不晚于它的包（预先接续，3.6）。
    fn next_frame(decoder: &mut Decoder, input: &mut Input, tracker: &mut RunTracker, feed: Feed<'_>, control: &StreamControl, limit: Option<i64>) -> Result<Fetched, ServiceError> {
        let Feed { pending, last_fed_dts, draining, drained, fed_since_output, decode_errors, all_key, skip_before, skipped } = feed;
        let counters = &control.counters;
        loop {
            if control.stop.load(Ordering::Relaxed) {
                return Err(ServiceError::new("CANCELLED", "解码已停止"));
            }
            match decoder.receive()? {
                Received::Frame(frame) => {
                    *fed_since_output = 0;
                    if frame.timestamp().is_none() || frame.is_corrupt() {
                        counters.discarded.fetch_add(1, Ordering::Relaxed);
                        continue;
                    }
                    // 没有自身 PTS 的帧（时间戳由解码时间推算）无法按段认领，视为当前段。
                    let claim = if frame.has_own_pts() { tracker.claim(frame_ts(&frame)) } else { Claim::Current };
                    match claim {
                        Claim::Current => {
                            counters.decoded.fetch_add(1, Ordering::Relaxed);
                            return Ok(Fetched::Frame(frame));
                        }
                        Claim::Queued => {
                            counters.decoded.fetch_add(1, Ordering::Relaxed);
                            return Ok(Fetched::Queued(frame));
                        }
                        Claim::Leading | Claim::Stale | Claim::Unknown => {
                            counters.discarded.fetch_add(1, Ordering::Relaxed);
                        }
                    }
                }
                Received::Eof => {
                    *drained = true;
                    return Ok(Fetched::End);
                }
                Received::Again => {
                    if *drained || *draining {
                        // 已在排空：解码器不应再要输入。
                        *drained = true;
                        return Ok(Fetched::End);
                    }
                    let packet = match pending.take() {
                        Some(packet) => Some(packet),
                        None => input.read()?,
                    };
                    if let (Some(limit), Some(next)) = (limit, &packet) {
                        if next.timestamp().is_some_and(|ts| ts > limit) {
                            *pending = packet;
                            return Ok(Fetched::Limit);
                        }
                    }
                    let Some(packet) = packet else {
                        decoder.send(None)?;
                        *draining = true;
                        continue;
                    };
                    if !packet.is_key() {
                        *all_key = false;
                    }
                    let skip_pts = skip_before.and_then(|limit| packet.pts().filter(|&pts| pts < limit));
                    if let Some(pts) = skip_pts {
                        skipped.push(pts);
                    }
                    let skip = skip_pts.is_some();
                    decoder.skip_nonref(skip);
                    let started = Instant::now();
                    match decoder.send(Some(&packet)) {
                        Ok(true) => {}
                        Ok(false) => {
                            *pending = Some(packet);
                            continue;
                        }
                        Err(error) => {
                            *decode_errors += 1;
                            counters.decode_errors.fetch_add(1, Ordering::Relaxed);
                            if *decode_errors == 1 || *decode_errors % 100 == 0 {
                                logging::warn("decode.packet_failed", &error.message, json!({ "count": *decode_errors }));
                            }
                        }
                    }
                    counters.decode_us.fetch_add(started.elapsed().as_micros() as u64, Ordering::Relaxed);
                    if let Some(pts) = packet.pts() {
                        tracker.fed(pts);
                    }
                    *last_fed_dts = packet.dts().or(packet.pts()).or(*last_fed_dts);
                    *fed_since_output += 1;
                    if *fed_since_output > STALL_PACKETS {
                        return Err(ServiceError::new("DECODE_FAILED", "解码器长时间没有输出画面"));
                    }
                }
            }
        }
    }

    /// 打开阶段：在会话结构建立前取得第一帧。
    struct Primer {
        input: Input,
        decoder: Decoder,
        tracker: RunTracker,
        pending: Option<Packet>,
        last_fed_dts: Option<i64>,
        draining: bool,
        drained: bool,
        /// 第一个关键包的时间。
        tracker_key: Option<i64>,
        all_key: bool,
    }

    impl Primer {
        fn first_frame(&mut self, control: &StreamControl) -> Result<Frame, ServiceError> {
            // 从文件开头的第一个关键包开始。
            let key = loop {
                match self.input.read()? {
                    None => return Err(ServiceError::new("DECODE_FAILED", "文件中没有可解码的关键帧")),
                    Some(packet) if packet.is_key() => break packet,
                    Some(_) => {}
                }
            };
            self.tracker_key = key.timestamp();
            self.tracker.begin(key.timestamp().unwrap_or(i64::MIN));
            self.pending = Some(key);
            let (mut fed, mut errors) = (0u32, 0u64);
            let feed = Feed { pending: &mut self.pending, last_fed_dts: &mut self.last_fed_dts, draining: &mut self.draining, drained: &mut self.drained, fed_since_output: &mut fed, decode_errors: &mut errors, all_key: &mut self.all_key, skip_before: None, skipped: &mut Vec::new() };
            match next_frame(&mut self.decoder, &mut self.input, &mut self.tracker, feed, control, None)? {
                Fetched::Frame(frame) | Fetched::Queued(frame) => Ok(frame),
                Fetched::End | Fetched::Limit => Err(ServiceError::new("DECODE_FAILED", "无法解出第一帧画面")),
            }
        }
    }

    #[cfg(test)]
    mod reuse_measurement {
        use super::*;

        /// 仅显式运行：两份相同码流、不同文件路径，测复用 AVCodecContext 的最佳收益上界。
        /// 只测 demux + 解到首帧；共享纹理池未参与，不把这个数字当完整 open_decoder 耗时。
        #[test]
        #[ignore = "需要 HENJI_DECODER_REUSE_SAMPLE 指向本机真实视频"]
        fn compare_recycled_decoder() {
            let path = std::env::var("HENJI_DECODER_REUSE_SAMPLE").expect("指定真实视频路径");
            let second = std::env::temp_dir().join(format!("henji-decoder-reuse-{}.mp4", std::process::id()));
            std::fs::copy(&path, &second).unwrap();
            let platform = crate::platform::create().unwrap();
            let paths = [path, second.to_string_lossy().into_owned()];
            let mut reused: Option<Decoder> = None;
            let mut rows = Vec::new();
            for index in 0..14 {
                // 交替先后顺序，剔除首次冷读，减少文件缓存和显卡频率造成的偏差。
                for recycle in if index % 2 == 0 { [false, true] } else { [true, false] } {
                    let started = Instant::now();
                    let control = StreamControl::new(0);
                    let input = Input::open(&paths[index % 2], None, control.stop.clone()).unwrap();
                    let opened = started.elapsed().as_secs_f64() * 1000.0;
                    let parameters = input.parameters();
                    let decoder = if recycle && reused.is_some() {
                        let mut decoder = reused.take().unwrap(); decoder.flush(); decoder
                    } else {
                        Decoder::open(DecoderSetup { parameters, time_base: input.stream().time_base, has_alpha: false, purpose: Purpose::Playback, hardware: Some(platform.hardware_device().unwrap()), device_profiles: &|name| platform.has_decoder_profile(name) }).unwrap()
                    };
                    let mut primer = Primer { input, decoder, tracker: RunTracker::default(), pending: None, last_fed_dts: None, draining: false, drained: false, tracker_key: None, all_key: true };
                    let picture = primer.first_frame(&control).unwrap();
                    assert!(picture.is_hardware(), "此实验必须实际硬解");
                    let elapsed = started.elapsed().as_secs_f64() * 1000.0;
                    drop(picture);
                    if recycle { reused = Some(primer.decoder); }
                    if index >= 2 { rows.push(json!({ "recycled": recycle, "demuxMs": opened, "firstFrameMs": elapsed })); }
                }
            }
            eprintln!("REUSE_MEASUREMENT {}", json!({ "sample": paths[0], "rows": rows }));
            drop(reused);
            std::fs::remove_file(second).unwrap();
        }
    }

    #[cfg(test)]
    mod cancel_tests {
        use super::*;
        use crate::cancel::CancelMap;
        use crate::convert::WritePath;
        use crate::platform::{HardwareDevice, TestStream, WriteStats};

        /// 软解会话不需要显卡：写入槽位什么也不做。
        struct NoOutput(u32);
        impl FrameOutput for NoOutput {
            fn remote_handles(&self) -> Vec<u64> {
                vec![0; self.0 as usize]
            }
            unsafe fn write(&mut self, _: *const ffmpeg_sys_next::AVFrame, _: u32, _: WritePath, _: &ColorInfo, _: bool) -> Result<WriteStats, String> {
                Ok(WriteStats::default())
            }
            fn settle(&mut self, _: Duration) -> Result<u64, String> {
                Ok(0)
            }
            fn pace(&mut self, _: Duration) -> Result<u64, String> {
                Ok(0)
            }
            fn cpu_fallback_used(&self) -> bool {
                false
            }
            fn into_resources(self: Box<Self>) -> Box<dyn StreamResources> {
                Box::new(NoResources)
            }
        }

        struct SoftwareOnly;
        impl VideoPlatform for SoftwareOnly {
            fn summary(&self) -> Value {
                json!({})
            }
            fn register_client(&self, _: u32) -> Result<(), String> {
                Ok(())
            }
            fn client_ready(&self) -> bool {
                true
            }
            fn close_client_handle(&self, _: u64) -> Result<(), String> {
                Ok(())
            }
            fn local_memory(&self) -> Option<(u64, u64)> {
                None
            }
            fn device_lost(&self) -> Option<String> {
                None
            }
            fn hardware_device(&self) -> Result<HardwareDevice, String> {
                Err("测试只用软解".into())
            }
            fn has_decoder_profile(&self, _: &str) -> bool {
                false
            }
            fn create_frame_output(&self, _: SharedFormat, _: (u32, u32), _: (u32, u32), count: u32) -> Result<Box<dyn FrameOutput>, String> {
                Ok(Box::new(NoOutput(count)))
            }
            fn start_test_stream(&self, _: &crate::streams::TestStreamOptions, _: Arc<StreamControl>) -> Result<TestStream, String> {
                Err("测试不用合成画面".into())
            }
        }

        /// 30fps、2 秒一个关键帧、带 B 帧的 H.264（FFmpeg CLI 生成，`video-decoder-ffmpeg.cjs test` 已把它放进 PATH）。
        fn generate(name: &str) -> Option<String> {
            let path = std::env::temp_dir().join(format!("henji-decode-cancel-{}-{name}.mp4", std::process::id()));
            let status = std::process::Command::new("ffmpeg")
                .args(["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=30:duration=4", "-c:v", "libx264", "-preset", "veryfast", "-bf", "3", "-g", "60", "-keyint_min", "60", "-sc_threshold", "0", "-pix_fmt", "yuv420p"])
                .arg(&path)
                .status()
                .ok()?;
            status.success().then(|| path.to_string_lossy().into_owned())
        }

        fn open_with_commands(path: &str) -> (std::sync::mpsc::Sender<SessionCommand>, Session) {
            let (commands, receiver) = std::sync::mpsc::channel();
            let options = DecodeOptions { stream_id: "cancel-test".into(), path: path.into(), stream_index: None, purpose: Purpose::Seek, pool_size: None, hardware: false, format: None, transfer: None };
            let budget = crate::budget::Budget::new(crate::budget::Limits::for_adapter(None));
            (commands, Session::open(Arc::new(SoftwareOnly), &options, Arc::new(StreamControl::new(0)), receiver, &budget).map(|(session, _)| session).expect("打开测试视频"))
        }

        fn open(path: &str) -> Session {
            open_with_commands(path).1
        }

        fn exact(session: &mut Session, seconds: f64) -> i64 {
            let ticks = seconds_to_ticks(seconds, session.time_base);
            let (_, approximate) = session.locate_frame(ticks, false).expect("精确取帧");
            assert!(!approximate);
            frame_ts(session.candidate.as_ref().expect("有画面"))
        }

        /// 定位到第二个 GOP 末尾的取帧被取消：会话停在解出的关键帧上，而帧级多线程解码器已经按“跳过非参考帧”多送了
        /// 一批包。之后同一时刻、以及这批包范围内更早时刻的精确取帧，必须与新会话直接取到的画面相同。
        #[test]
        fn cancelled_frame_at_keeps_position_and_later_exact_reads_match() {
            let Some(path) = generate("position") else {
                eprintln!("跳过：没有 ffmpeg");
                return;
            };
            let table = CancelMap::default();
            let cancelled = |session: &mut Session, seconds: f64| {
                session.cancel = Some(CancelToken::register(&table, "frame-at"));
                crate::cancel::cancel(&table, "frame-at");
                let ticks = seconds_to_ticks(seconds, session.time_base);
                assert_eq!(session.locate_frame(ticks, false).unwrap_err().code, "CANCELLED");
                session.cancel = None;
                assert!(frame_ts(session.candidate.as_ref().expect("停在已解出的帧上")) < ticks, "半途停下");
            };
            let far = 3.9;
            let mut session = open(&path);
            cancelled(&mut session, far);
            assert_eq!(exact(&mut session, far), exact(&mut open(&path), far));
            for frame in 1..=12 {
                let seconds = 2.0 + (frame as f64 + 0.25) / 30.0;
                let mut session = open(&path);
                cancelled(&mut session, far);
                assert_eq!(exact(&mut session, seconds), exact(&mut open(&path), seconds), "第二个 GOP 第 {frame} 帧");
            }
            assert!(table.lock().unwrap().is_empty(), "取消标志随持有者出表");
            let _ = std::fs::remove_file(path);
        }

        /// 出队时已取消的取帧不解码；等空闲槽位时被取消立即答复，不等到槽位超时；二者都计入取消计数。会话同时停止
        /// （关闭流、服务关闭）时答复“会话已停止”，不计入。
        #[test]
        fn cancel_is_checked_when_dequeued_and_while_waiting_for_a_slot() {
            let Some(path) = generate("checks") else {
                eprintln!("跳过：没有 ffmpeg");
                return;
            };
            let table = CancelMap::default();
            let token = |cancel: bool| {
                let token = CancelToken::register(&table, "frame-at");
                if cancel {
                    crate::cancel::cancel(&table, "frame-at");
                }
                token
            };
            let mut session = open(&path);
            let counters = session.control.clone();
            let decoded = counters.counters.decoded.load(Ordering::Relaxed);
            assert_eq!(session.answer_frame_at(1.0, "t1".into(), false, token(true)).unwrap_err(), superseded());
            assert_eq!(counters.counters.decoded.load(Ordering::Relaxed), decoded, "出队时已取消：不解码");
            // 目标已解出、只差交出，而槽位全被占着：等待中被取消。
            exact(&mut session, 1.0);
            while counters.slots.acquire().is_some() {}
            let canceller = {
                let table = table.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_millis(50));
                    crate::cancel::cancel(&table, "frame-at")
                })
            };
            let waiting = Instant::now();
            assert_eq!(session.answer_frame_at(1.0, "t2".into(), false, token(false)).unwrap_err(), superseded());
            assert!(canceller.join().unwrap(), "取消时取帧仍在等槽位");
            assert!(waiting.elapsed() < FRAME_AT_SLOT_TIMEOUT, "取消后不再等槽位");
            assert_eq!(counters.counters.cancelled.load(Ordering::Relaxed), 2);
            counters.stop.store(true, Ordering::Relaxed);
            assert_eq!(session.answer_frame_at(1.0, "t3".into(), false, token(true)).unwrap_err(), session_stopped());
            assert_eq!(counters.counters.cancelled.load(Ordering::Relaxed), 2, "会话停止不算被取代");
            assert!(table.lock().unwrap().is_empty());
            let _ = std::fs::remove_file(path);
        }

        /// 会话停止时队列里还没处理的取帧都要答复（`run` 逐个答复会话已停止），取消标志随命令出表。
        #[test]
        fn queued_frame_ats_are_collected_for_an_answer_when_the_session_stops() {
            let Some(path) = generate("queued") else {
                eprintln!("跳过：没有 ffmpeg");
                return;
            };
            let (commands, mut session) = open_with_commands(&path);
            let table = CancelMap::default();
            for id in ["q1", "q2"] {
                commands.send(SessionCommand::FrameAt { request_id: id.into(), time: 1.0, ticket: id.into(), key_only: false, cancel: CancelToken::register(&table, id) }).unwrap();
            }
            commands.send(SessionCommand::Cancel { schedule_id: "s".into() }).unwrap();
            session.control.stop.store(true, Ordering::Relaxed);
            drop(commands);
            assert_eq!(session.unanswered_frame_ats(), ["q1", "q2"]);
            assert!(table.lock().unwrap().is_empty(), "取消标志随命令出表");
            let _ = std::fs::remove_file(path);
        }
    }
}
