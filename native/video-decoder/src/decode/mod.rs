//! 解码会话（1.3）：每个会话一个生产线程、一个解码器、一个共享纹理池（沿用 1.2 的流模型）。
//!
//! 协议（控制通道，版本 3）：
//! - `open_decoder { streamId, path, streamIndex?, purpose: playback|seek, poolSize?, hardware?: auto|off, format? }`
//!   → 会话线程打开文件、解出第一帧以确定像素格式与色彩，再响应流信息（与测试流同形，另含 `decoder`、时间信息）；
//! - `frame_at { streamId, time, ticket }`：命中时先发 `frame` 事件（`request.kind = frame_at`）再响应 `{ found: true, ptsUs… }`；
//! - `schedule { streamId, scheduleId, times | range }`：主线程立即确认，会话按请求顺序每项恰好发一个 `frame`
//!   （`request.kind = schedule, index`）或 `frame_missing`，最后发 `schedule_done`；新计划取消旧计划，计划进行中 `frame_at` 返回 BUSY；
//! - `cancel_schedule`、`stop_stream`、`release_frame` 同 1.2。
//!
//! 时间口径见 `timing.rs`；续解/新段/前导帧规则见 `plan.rs`。相邻请求续解不 flush；单帧定位与排空到文件末尾后
//! 回到前面时 flush。播放计划的剪辑点不 flush（帧内编码等软解保持多线程流水），但 HEVC/H.264 例外（3.1）：
//! 不 flush 时解码器按上一段推算新关键帧（CRA、非 IDR 的 I 帧）的图序号，相隔超过半个序号周期就算错，之后整段只剩
//! 关键帧一帧，所以这两种编码的剪辑点也先 flush。

pub mod codec;
pub mod demux;
pub mod plan;
pub mod timing;

use serde_json::{json, Value};
use std::sync::atomic::Ordering;
use std::sync::mpsc::{Receiver, RecvTimeoutError, TryRecvError};
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::logging;
use crate::protocol::ServiceError;
use crate::streams::StreamControl;
use crate::test_pattern::SharedFormat;
use codec::{Decoder, DecoderSetup, Frame, Purpose, Received};
use demux::{Input, Packet};
use plan::{seek_decision, Claim, Decision, Position, RunTracker, FORWARD_SEEK_SECONDS};
use timing::{duration_to_us, pts_to_seconds, pts_to_us, seconds_to_duration_ticks, seconds_to_ticks, TimeBase};

/// 单帧请求等空闲槽位的上限。
const FRAME_AT_SLOT_TIMEOUT: Duration = Duration::from_secs(2);
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
    FrameAt { request_id: String, time: f64, ticket: String },
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
        /// 剪辑点是否 flush：图序号跨关键帧推算的编码（H.264、HEVC）必须 flush（3.1）。
        flush_cuts: bool,
        fallback_logged: bool,
        decode_error_count: u64,
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
                    logging::info("decode.session.opened", "解码会话已打开", json!({ "streamId": options.stream_id, "path": options.path, "purpose": format!("{:?}", options.purpose), "decoder": info["decoder"], "format": info["format"], "color": info["color"], "setupMs": info["setupMs"] }));
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
            let input = Input::open(&options.path, options.stream_index, control.stop.clone())?;
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
            let flush_cuts = matches!(parameters.codec_id, ffmpeg_sys_next::AVCodecID::AV_CODEC_ID_H264 | ffmpeg_sys_next::AVCodecID::AV_CODEC_ID_HEVC);

            // 先解出第一帧：确定实际像素格式（硬解或软解）与色彩，再按它建纹理池。
            let mut session_parts = Primer { input, decoder, tracker: RunTracker::default(), pending: None, last_fed_dts: None, draining: false, drained: false, tracker_key: None };
            let first = session_parts.first_frame(&control)?;
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
            let frames = platform.create_frame_output(output, pool_dimensions, (width, height), pool_size).map_err(|message| ServiceError::new("GPU_FAILED", message))?;
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
            });
            let first_key_ts = session_parts.tracker_key;
            let Primer { input, decoder, tracker, pending, last_fed_dts, draining, drained, .. } = session_parts;
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
                flush_cuts,
                fallback_logged: false,
                decode_error_count: 0,
            };
            Ok((session, response))
        }

        fn stopped(&self) -> bool {
            self.control.stop.load(Ordering::Relaxed)
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
                    SessionCommand::FrameAt { request_id, time, ticket } => self.frame_at(&request_id, time, ticket),
                    SessionCommand::Schedule { schedule_id, plan } => self.run_schedule(schedule_id, plan),
                    SessionCommand::Cancel { .. } => {}
                }
            }
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

        /// 下一个属于当前段的帧（呈现顺序）；文件结束返回 None。
        fn next_frame(&mut self) -> Result<Option<Frame>, ServiceError> {
            next_frame(&mut self.decoder, &mut self.input, &mut self.tracker, &mut self.pending_packet, &mut self.last_fed_dts, &mut self.draining, &mut self.drained, &mut self.fed_since_output, &self.control, &mut self.decode_error_count)
        }

        /// 推进到 `ticks`：候选帧 = 呈现时间 ≤ ticks 的最后一帧，前瞻帧 = 其后一帧。
        /// 帧内编码且无输出延迟（单帧会话）时只需看下一个包的时间就知道候选帧是否最终，不必多解一帧。
        fn advance_to(&mut self, ticks: i64) -> Result<(), ServiceError> {
            loop {
                if self.stopped() {
                    return Err(ServiceError::new("CANCELLED", "解码已停止"));
                }
                if let Some(next) = &self.lookahead {
                    if frame_ts(next) <= ticks {
                        self.candidate = self.lookahead.take();
                        continue;
                    }
                    return Ok(());
                }
                if self.decoder.immediate_output && self.candidate.is_some() && !self.draining && !self.drained {
                    if self.pending_packet.is_none() {
                        self.pending_packet = self.input.read()?;
                    }
                    if self.pending_packet.as_ref().and_then(|packet| packet.pts()).is_some_and(|pts| pts > ticks) {
                        return Ok(());
                    }
                }
                match self.next_frame()? {
                    Some(frame) => self.lookahead = Some(frame),
                    None => return Ok(()),
                }
            }
        }

        /// 按需定位并推进到 `ticks`。返回是否定位过。
        fn locate(&mut self, ticks: i64, flush_on_seek: bool) -> Result<bool, ServiceError> {
            let key = self.input.key_before(ticks);
            let decision = seek_decision(ticks, &self.position(), key, self.forward_limit);
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

        /// 等一个空闲槽位。
        fn wait_slot(&mut self, deadline: Option<Instant>, interruptible: bool) -> Result<u32, Abort> {
            let started = Instant::now();
            let result = loop {
                if self.stopped() {
                    break Err(Abort::Stopped);
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

        fn frame_at(&mut self, request_id: &str, time: f64, ticket: String) {
            let started = Instant::now();
            if !time.is_finite() {
                crate::respond(request_id, Err(ServiceError::new("INVALID_REQUEST", "时间无效")));
                return;
            }
            let ticks = seconds_to_ticks(time, self.time_base);
            let seeked = match self.locate(ticks, true) {
                Ok(seeked) => seeked,
                Err(error) => {
                    if error.code == "DECODE_FAILED" {
                        crate::platform::exit_if_device_lost(self.platform.as_ref(), "frame_at");
                    }
                    crate::respond(request_id, Err(error));
                    return;
                }
            };
            if self.candidate.is_none() {
                self.control.counters.missing.fetch_add(1, Ordering::Relaxed);
                crate::respond(request_id, Ok(json!({ "ticket": ticket, "found": false, "seeked": seeked, "decodeMs": started.elapsed().as_secs_f64() * 1000.0 })));
                return;
            }
            match self.deliver(RequestTag::FrameAt(ticket.clone()), Some(Instant::now() + FRAME_AT_SLOT_TIMEOUT), false) {
                Ok(mut value) => {
                    value["ticket"] = json!(ticket);
                    value["found"] = json!(true);
                    value["seeked"] = json!(seeked);
                    value["decodeMs"] = json!(started.elapsed().as_secs_f64() * 1000.0);
                    crate::respond(request_id, Ok(value));
                }
                Err(Abort::Failed(error)) => crate::respond(request_id, Err(error)),
                Err(_) => crate::respond(request_id, Err(ServiceError::new("CANCELLED", "解码已停止"))),
            }
        }

        fn missing(&self, schedule_id: &str, index: usize, reason: &str) {
            self.control.counters.missing.fetch_add(1, Ordering::Relaxed);
            crate::send(&json!({ "event": "frame_missing", "streamId": self.stream_id, "scheduleId": schedule_id, "index": index, "reason": reason }));
        }

        fn run_schedule(&mut self, schedule_id: String, plan: SchedulePlan) {
            let started = Instant::now();
            self.schedule = Some(schedule_id.clone());
            let delivered_before = self.delivered;
            let cuts_before = self.control.counters.cuts.load(Ordering::Relaxed);
            let result = match &plan {
                SchedulePlan::Times(times) => self.schedule_times(&schedule_id, times),
                SchedulePlan::Range { from, to } => self.schedule_range(&schedule_id, *from, *to),
            };
            self.schedule = None;
            let (reason, message) = match &result {
                Ok(()) => ("completed", None),
                Err(Abort::Cancelled) => ("cancelled", None),
                Err(Abort::Stopped) => return,
                Err(Abort::Failed(error)) => ("error", Some(error.message.clone())),
            };
            let summary = json!({
                "delivered": self.delivered - delivered_before,
                "cuts": self.control.counters.cuts.load(Ordering::Relaxed) - cuts_before,
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
            for (index, time) in times.iter().enumerate() {
                if self.stopped() {
                    return Err(Abort::Stopped);
                }
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

    /// 送包取帧的公共实现（打开时取第一帧与会话共用）。
    #[allow(clippy::too_many_arguments)]
    fn next_frame(decoder: &mut Decoder, input: &mut Input, tracker: &mut RunTracker, pending: &mut Option<Packet>, last_fed_dts: &mut Option<i64>, draining: &mut bool, drained: &mut bool, fed_since_output: &mut u32, control: &StreamControl, decode_errors: &mut u64) -> Result<Option<Frame>, ServiceError> {
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
                    if claim == Claim::Current {
                        counters.decoded.fetch_add(1, Ordering::Relaxed);
                        return Ok(Some(frame));
                    }
                    counters.discarded.fetch_add(1, Ordering::Relaxed);
                }
                Received::Eof => {
                    *drained = true;
                    return Ok(None);
                }
                Received::Again => {
                    if *drained || *draining {
                        // 已在排空：解码器不应再要输入。
                        *drained = true;
                        return Ok(None);
                    }
                    let packet = match pending.take() {
                        Some(packet) => Some(packet),
                        None => input.read()?,
                    };
                    let Some(packet) = packet else {
                        decoder.send(None)?;
                        *draining = true;
                        continue;
                    };
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
            next_frame(&mut self.decoder, &mut self.input, &mut self.tracker, &mut self.pending, &mut self.last_fed_dts, &mut self.draining, &mut self.drained, &mut fed, control, &mut errors)?.ok_or_else(|| ServiceError::new("DECODE_FAILED", "无法解出第一帧画面"))
        }
    }
}
