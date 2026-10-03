//! 声音会话（2.3）：解码一个文件的一条声音流，按请求的采样率（序列采样率）用 libswresample + libsoxr 重采样，
//! 输出平面 float32，经控制通道的二进制附件交给主进程（不走显卡通道）。
//!
//! 协议（协议版本 4）：
//! - `open_audio { audioId, path, audioStream?, sampleRate? }`：`audioStream` 只数声音流（从 0 起，缺省 0）；
//!   `sampleRate` 缺省为流自身采样率。没有这条声音流时响应 `{ found: false, audioStream }`。
//! - `read_audio { audioId, startFrame, frames }`：输出网格上的绝对样本 [startFrame, startFrame + frames)，
//!   响应 `{ audioId, startFrame, frames, channels, seeked, decodeMs }` 并带 `attachment`（平面 float32 小端，
//!   声道 × 帧 × 4 字节）。流开始前、缺口与结束后为 0。
//! - `close_audio { audioId }` → `{ closed }`。
//!
//! 时间口径：源文件绝对时间轴（容器呈现时间，不按流起点归零），与渲染层片段入点一致。声道顺序保持流的声道
//! （自定义顺序转为 FFmpeg 原生顺序，前左、前右在最前；未指定顺序按索引原样），不混缩，声道映射由渲染层统一做。
//!
//! 每个会话一个线程，独立解封装与解码；读取与上次相邻（或 2 秒内向前）时续解，否则定位并重建重采样器。

pub mod timing;

use std::collections::HashMap;
use std::ffi::{c_int, c_void};
use std::ptr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::Instant;

use ffmpeg_sys_next as ff;
use serde_json::{json, Value};

use crate::decode::codec::Frame;
use crate::decode::demux::Input;
use crate::decode::timing::{pts_to_seconds, seconds_to_ticks, TimeBase};
use crate::logging;
use crate::probe::error_text;
use crate::protocol::ServiceError;
use timing::{coarse_snap_limit, place, read_plan, sample_index, segment_start, snap_to_frame_grid, Placement, ReadPlan};

/// 单次读取的样本数上限（每声道，与主进程 `VIDEO_AUDIO_MAX_READ_FRAMES` 一致）。
pub const MAX_READ_FRAMES: usize = 2 * 192_000;
/// 每段解码在目标之前多送的输入样本：解码器（AAC/Opus 重叠窗口）与重采样滤波器预热，结果丢弃。
const PREROLL_INPUT_SAMPLES: i64 = 8192;
/// 定位时在预热起点之前再留的秒数（解封装定位落在包边界）。
const SEEK_MARGIN_SECONDS: f64 = 0.2;
/// 定位后首个声音晚于预热起点（解封装定位不准）时最多再往前定位的次数，每次 1 秒。
const MAX_SEEK_RETRIES: u32 = 3;
/// SoX 重采样精度（位）：28 位即 SoX 的 very high quality。
const SOXR_PRECISION: f64 = 28.0;
/// 一次补零送入的样本数。
const SILENCE_CHUNK: i64 = 4096;
/// Windows 下 FFmpeg（mingw 构建）的 EAGAIN。
const EAGAIN: c_int = 11;

pub struct AudioOpenOptions {
    pub audio_id: String,
    pub path: String,
    pub audio_stream: usize,
    pub sample_rate: Option<u32>,
}

pub enum AudioCommand {
    Read { request_id: String, start_frame: i64, frames: usize },
    Close { request_id: String },
}

struct ManagedSession {
    commands: Sender<AudioCommand>,
    stop: Arc<AtomicBool>,
    thread: JoinHandle<()>,
}

/// 全部声音会话。命令由会话线程处理并自行响应。
#[derive(Default)]
pub struct AudioManager {
    sessions: HashMap<String, ManagedSession>,
}

impl AudioManager {
    pub fn open(&mut self, request_id: String, options: AudioOpenOptions) -> Result<(), ServiceError> {
        if self.sessions.contains_key(&options.audio_id) {
            return Err(ServiceError::new("INVALID_REQUEST", format!("声音会话 {} 已存在", options.audio_id)));
        }
        if matches!(options.sample_rate, Some(rate) if !(8_000..=384_000).contains(&rate)) {
            return Err(ServiceError::new("INVALID_REQUEST", "输出采样率无效"));
        }
        let (sender, receiver) = channel();
        let stop = Arc::new(AtomicBool::new(false));
        let audio_id = options.audio_id.clone();
        let thread_stop = stop.clone();
        let thread = std::thread::Builder::new()
            .name(format!("audio-{audio_id}"))
            .spawn(move || run_session(request_id, options, thread_stop, receiver))
            .map_err(|error| ServiceError::new("INTERNAL", format!("无法创建声音会话线程：{error}")))?;
        self.sessions.insert(audio_id, ManagedSession { commands: sender, stop, thread });
        Ok(())
    }

    pub fn read(&self, request_id: &str, audio_id: &str, start_frame: i64, frames: usize) -> Result<(), ServiceError> {
        if frames == 0 || frames > MAX_READ_FRAMES {
            return Err(ServiceError::new("INVALID_REQUEST", "读取样本数无效"));
        }
        let session = self.sessions.get(audio_id).ok_or_else(|| ServiceError::new("INVALID_REQUEST", format!("声音会话 {audio_id} 不存在")))?;
        session
            .commands
            .send(AudioCommand::Read { request_id: request_id.to_string(), start_frame, frames })
            .map_err(|_| ServiceError::new("INVALID_REQUEST", format!("声音会话 {audio_id} 已结束")))
    }

    /// 关闭会话：会话线程处理完在途读取后响应；会话已不存在时返回 false（由调用方直接响应）。
    pub fn close(&mut self, request_id: &str, audio_id: &str) -> bool {
        let Some(session) = self.sessions.remove(audio_id) else { return false };
        session.stop.store(true, Ordering::Relaxed);
        if session.commands.send(AudioCommand::Close { request_id: request_id.to_string() }).is_err() {
            return false;
        }
        true
    }

    /// 回收已结束的会话线程（打开失败、没有这条声音流）。
    pub fn reap(&mut self) {
        self.sessions.retain(|_, session| !session.thread.is_finished());
    }

    pub fn stop_all(&mut self) {
        for (_, session) in self.sessions.drain() {
            session.stop.store(true, Ordering::Relaxed);
            drop(session.commands);
            let _ = session.thread.join();
        }
    }

    pub fn count(&self) -> usize {
        self.sessions.len()
    }
}

fn run_session(request_id: String, options: AudioOpenOptions, stop: Arc<AtomicBool>, commands: Receiver<AudioCommand>) {
    let started = Instant::now();
    let audio_id = options.audio_id.clone();
    let mut session = match AudioSession::open(&options, stop) {
        Ok(Some(session)) => session,
        Ok(None) => {
            crate::respond(&request_id, Ok(json!({ "found": false, "audioStream": options.audio_stream })));
            return;
        }
        Err(error) => {
            logging::warn("audio.session.open_failed", &error.message, json!({ "audioId": audio_id, "code": error.code }));
            crate::respond(&request_id, Err(error));
            return;
        }
    };
    let mut info = session.info();
    info["audioId"] = json!(audio_id);
    info["setupMs"] = json!(started.elapsed().as_secs_f64() * 1000.0);
    logging::info("audio.session.opened", "声音会话已打开", info.clone());
    crate::respond(&request_id, Ok(info));
    let mut reads: u64 = 0;
    let mut seeks: u64 = 0;
    while let Ok(command) = commands.recv() {
        match command {
            AudioCommand::Read { request_id, start_frame, frames } => {
                let started = Instant::now();
                match session.read(start_frame, frames) {
                    Ok((bytes, seeked)) => {
                        reads += 1;
                        seeks += seeked as u64;
                        let result = json!({ "audioId": audio_id, "startFrame": start_frame, "frames": frames, "channels": session.channels, "seeked": seeked, "decodeMs": started.elapsed().as_secs_f64() * 1000.0 });
                        crate::send_with_attachment(&json!({ "id": request_id, "ok": true, "result": result, "attachment": bytes.len() }), &bytes);
                    }
                    Err(error) => {
                        logging::warn("audio.session.read_failed", &error.message, json!({ "audioId": audio_id, "code": error.code, "startFrame": start_frame, "frames": frames }));
                        crate::respond(&request_id, Err(error));
                    }
                }
            }
            AudioCommand::Close { request_id } => {
                crate::respond(&request_id, Ok(json!({ "closed": true })));
                break;
            }
        }
    }
    logging::emit("debug", "audio.session.closed", "声音会话已关闭", json!({ "audioId": audio_id, "reads": reads, "seeks": seeks }));
}

/// 拥有所有权的声道布局。
struct Layout(ff::AVChannelLayout);

impl Layout {
    fn copy(source: &ff::AVChannelLayout) -> Result<Self, ServiceError> {
        let mut layout: ff::AVChannelLayout = unsafe { std::mem::zeroed() };
        if unsafe { ff::av_channel_layout_copy(&mut layout, source) } < 0 {
            return Err(ServiceError::new("INTERNAL", "无法复制声道布局"));
        }
        Ok(Self(layout))
    }

    /// 解码与重采样用的输入布局：未指定顺序时按声道数取默认布局（输出用同一布局，声道按索引原样传递）。
    fn input(source: &ff::AVChannelLayout) -> Result<Self, ServiceError> {
        if source.order == ff::AVChannelOrder::AV_CHANNEL_ORDER_UNSPEC {
            let mut layout: ff::AVChannelLayout = unsafe { std::mem::zeroed() };
            unsafe { ff::av_channel_layout_default(&mut layout, source.nb_channels.max(1)) };
            return Ok(Self(layout));
        }
        Self::copy(source)
    }

    /// 输出布局：自定义顺序转为原生顺序（重采样器只重排、不混缩）；其余与输入相同。
    fn output(input: &Self) -> Result<Self, ServiceError> {
        let mut layout = Self::copy(&input.0)?;
        if layout.0.order == ff::AVChannelOrder::AV_CHANNEL_ORDER_CUSTOM {
            let retyped = unsafe { ff::av_channel_layout_retype(&mut layout.0, ff::AVChannelOrder::AV_CHANNEL_ORDER_NATIVE, ff::AV_CHANNEL_LAYOUT_RETYPE_FLAG_LOSSLESS as c_int) };
            if retyped < 0 {
                return Self::copy(&input.0);
            }
        }
        Ok(layout)
    }

    fn describe(&self) -> Option<String> {
        if self.0.order == ff::AVChannelOrder::AV_CHANNEL_ORDER_UNSPEC {
            return None;
        }
        let mut text = [0 as std::ffi::c_char; 128];
        let written = unsafe { ff::av_channel_layout_describe(&self.0, text.as_mut_ptr(), text.len()) };
        (written > 0).then(|| crate::ffmpeg_info::c_text(text.as_ptr())).flatten()
    }

    fn same(&self, other: &ff::AVChannelLayout) -> bool {
        unsafe { ff::av_channel_layout_compare(&self.0, other) == 0 }
    }
}

impl Drop for Layout {
    fn drop(&mut self) {
        unsafe { ff::av_channel_layout_uninit(&mut self.0) };
    }
}

unsafe impl Send for Layout {}

/// 解码器上下文。
struct AudioDecoder {
    context: *mut ff::AVCodecContext,
    name: String,
}

unsafe impl Send for AudioDecoder {}

impl AudioDecoder {
    fn open(parameters: &ff::AVCodecParameters, time_base: ff::AVRational) -> Result<Self, ServiceError> {
        let codec = unsafe { ff::avcodec_find_decoder(parameters.codec_id) };
        if codec.is_null() {
            return Err(ServiceError::new("UNSUPPORTED_FORMAT", "没有该声音编码的解码器"));
        }
        let name = crate::ffmpeg_info::c_text(unsafe { (*codec).name }).unwrap_or_default();
        let mut context = unsafe { ff::avcodec_alloc_context3(codec) };
        if context.is_null() {
            return Err(ServiceError::new("INTERNAL", "无法分配声音解码器上下文"));
        }
        let fail = |context: &mut *mut ff::AVCodecContext, message: String| {
            unsafe { ff::avcodec_free_context(context) };
            ServiceError::new("DECODE_FAILED", message)
        };
        if unsafe { ff::avcodec_parameters_to_context(context, parameters) } < 0 {
            return Err(fail(&mut context, "无法设置声音解码参数".into()));
        }
        unsafe { (*context).pkt_timebase = time_base };
        let opened = unsafe { ff::avcodec_open2(context, codec, ptr::null_mut()) };
        if opened < 0 {
            return Err(fail(&mut context, format!("无法打开声音解码器 {name}：{}", error_text(opened))));
        }
        Ok(Self { context, name })
    }
}

impl Drop for AudioDecoder {
    fn drop(&mut self) {
        unsafe { ff::avcodec_free_context(&mut self.context) };
    }
}

/// 重采样器：输入为解码帧的格式，输出为平面 float32、输出布局与采样率。
struct Resampler {
    context: *mut ff::SwrContext,
    in_format: c_int,
    in_rate: u32,
    /// 帧原样给出的声道布局（未指定顺序时送给重采样器的是默认布局，判断格式是否改变时用原样的）。
    source_layout: Layout,
    channels: usize,
    planar: bool,
    bytes_per_sample: usize,
    /// 输入格式的静音（补零用），按需分配。
    silence: Vec<u8>,
}

unsafe impl Send for Resampler {}

impl Resampler {
    fn new(source_layout: Layout, in_layout: Layout, in_format: c_int, in_rate: u32, out_layout: &Layout, out_rate: u32) -> Result<Self, ServiceError> {
        let sample_format: ff::AVSampleFormat = if in_format >= 0 && in_format < ff::AVSampleFormat::AV_SAMPLE_FMT_NB as c_int {
            // SAFETY: 取值已限定在 [0, AV_SAMPLE_FMT_NB)。
            unsafe { std::mem::transmute::<c_int, ff::AVSampleFormat>(in_format) }
        } else {
            return Err(ServiceError::new("UNSUPPORTED_FORMAT", "声音采样格式无效"));
        };
        let mut context: *mut ff::SwrContext = ptr::null_mut();
        let allocated = unsafe { ff::swr_alloc_set_opts2(&mut context, &out_layout.0, ff::AVSampleFormat::AV_SAMPLE_FMT_FLTP, out_rate as c_int, &in_layout.0, sample_format, in_rate as c_int, 0, ptr::null_mut()) };
        if allocated < 0 || context.is_null() {
            return Err(ServiceError::new("INTERNAL", format!("无法创建重采样器：{}", error_text(allocated))));
        }
        let mut resampler = Self {
            context,
            in_format,
            in_rate,
            channels: in_layout.0.nb_channels.max(1) as usize,
            source_layout,
            planar: unsafe { ff::av_sample_fmt_is_planar(sample_format) } != 0,
            bytes_per_sample: unsafe { ff::av_get_bytes_per_sample(sample_format) }.max(1) as usize,
            silence: Vec::new(),
        };
        if in_rate != out_rate {
            // libsoxr（成熟的高质量重采样器，记录 012）；精度 28 位为 SoX 的 very high quality。
            let engine = unsafe { ff::av_opt_set(context as *mut c_void, c"resampler".as_ptr(), c"soxr".as_ptr(), 0) };
            let precision = unsafe { ff::av_opt_set_double(context as *mut c_void, c"precision".as_ptr(), SOXR_PRECISION, 0) };
            if engine < 0 || precision < 0 {
                return Err(ServiceError::new("INTERNAL", "无法启用 SoX 重采样器"));
            }
        }
        let initialized = unsafe { ff::swr_init(resampler.context) };
        if initialized < 0 {
            return Err(ServiceError::new("INTERNAL", format!("无法初始化重采样器：{}", error_text(initialized))));
        }
        resampler.silence = vec![0u8; SILENCE_CHUNK as usize * resampler.bytes_per_sample * resampler.channels];
        if sample_format == ff::AVSampleFormat::AV_SAMPLE_FMT_U8 || sample_format == ff::AVSampleFormat::AV_SAMPLE_FMT_U8P {
            // 无符号 8 位的静音是 0x80。
            resampler.silence.fill(0x80);
        }
        Ok(resampler)
    }

    fn matches(&self, frame: &ff::AVFrame) -> bool {
        frame.format == self.in_format && frame.sample_rate as u32 == self.in_rate && self.source_layout.same(&frame.ch_layout)
    }

    /// 送入 `count` 个输入样本（`inputs` 为各平面从第一个要送的样本起的指针；None 为排空），输出追加到 `output`。
    fn convert(&mut self, inputs: Option<&[*const u8]>, count: usize, output: &mut [Vec<f32>]) -> Result<usize, ServiceError> {
        let capacity = unsafe { ff::swr_get_out_samples(self.context, count as c_int) }.max(0) as usize + 32;
        let starts: Vec<usize> = output.iter().map(Vec::len).collect();
        for plane in output.iter_mut() {
            plane.resize(plane.len() + capacity, 0.0);
        }
        let pointers: Vec<*mut u8> = output.iter_mut().zip(&starts).map(|(plane, start)| unsafe { plane.as_mut_ptr().add(*start) } as *mut u8).collect();
        let produced = unsafe {
            ff::swr_convert(self.context, pointers.as_ptr(), capacity as c_int, inputs.map_or(ptr::null(), |planes| planes.as_ptr()), if inputs.is_some() { count as c_int } else { 0 })
        };
        let produced = if produced < 0 { 0 } else { produced as usize };
        for (plane, start) in output.iter_mut().zip(&starts) {
            plane.truncate(start + produced);
        }
        Ok(produced)
    }

    /// 帧中从第 `offset` 个样本起的各平面指针。
    fn frame_planes(&self, frame: &ff::AVFrame, offset: usize) -> Vec<*const u8> {
        let planes = if self.planar { self.channels } else { 1 };
        let stride = if self.planar { self.bytes_per_sample } else { self.bytes_per_sample * self.channels };
        (0..planes).map(|plane| unsafe { (*frame.extended_data.add(plane)).add(offset * stride) } as *const u8).collect()
    }

    fn silence_planes(&self) -> Vec<*const u8> {
        let planes = if self.planar { self.channels } else { 1 };
        let plane_bytes = self.silence.len() / planes;
        (0..planes).map(|plane| unsafe { self.silence.as_ptr().add(plane * plane_bytes) }).collect()
    }
}

impl Drop for Resampler {
    fn drop(&mut self) {
        unsafe { ff::swr_free(&mut self.context) };
    }
}

/// 一段连续解码：从输入样本 `next_in` 起送入重采样器，下一个输出样本是 `next_out`。
struct Segment {
    resampler: Option<Resampler>,
    next_in: i64,
    next_out: i64,
    /// 已取出、尚未（全部）送入的帧、其起始输入样本序号，以及是否已判定为缺口后的帧（之后精确落位，不再按容差合并）。
    pending: Option<(Frame, i64, bool)>,
    /// 定位后还没有处理过任何帧（用于检查定位是否落得太晚）。
    awaiting_first: bool,
    /// 本段定位的目标（秒）与重试次数。
    seek_seconds: f64,
    seek_retries: u32,
    demux_eof: bool,
    decoder_eof: bool,
    /// 本段已送入解码出的样本。之前的帧一律精确落位（2.10）：段起点 `next_in` 是按目标算出的位置，不是上一帧的
    /// 延续，按容差合并会把跨过起点的整帧错位最多 1ms（Opus 20ms 帧、AAC 1024 样本帧定位时约 1/10 概率命中）。
    fed: bool,
    /// 流结束（含重采样器排空）后的输出位置；之后全是静音。
    ended_at: Option<i64>,
}

impl Segment {
    fn new(next_in: i64, next_out: i64, seek_seconds: f64, seek_retries: u32) -> Self {
        Self { resampler: None, next_in, next_out, pending: None, awaiting_first: true, seek_seconds, seek_retries, demux_eof: false, decoder_eof: false, fed: false, ended_at: None }
    }
}

/// 固定帧长编码在粗时间基容器中的帧网格（2.10）：从流起点按帧长连续累加，输入样本序号。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct FrameGrid {
    anchor: i64,
    frame: i64,
    limit: i64,
}

impl FrameGrid {
    /// 只对每帧样本数固定的编码启用；Opus、Vorbis 等可变帧长编码在毫秒时间基下定位仍可能偏最多半个刻度（已知边界）。
    fn new(parameters: &ff::AVCodecParameters, time_base: TimeBase, start_time: i64) -> Option<Self> {
        use ff::AVCodecID::*;
        let fixed = matches!(parameters.codec_id, AV_CODEC_ID_AAC | AV_CODEC_ID_MP3 | AV_CODEC_ID_MP2 | AV_CODEC_ID_MP1 | AV_CODEC_ID_AC3 | AV_CODEC_ID_EAC3);
        // AC-3/E-AC-3 的解码参数不带帧长：按 6 个音频块（1536）；E-AC-3 可用更少的块，落位时还会核对实际帧长。
        let frame = match (parameters.frame_size, parameters.codec_id) {
            (size, _) if size > 0 => size as i64,
            (_, AV_CODEC_ID_AC3 | AV_CODEC_ID_EAC3) => 1536,
            _ => return None,
        };
        if !fixed || parameters.sample_rate <= 0 || start_time == ff::AV_NOPTS_VALUE {
            return None;
        }
        let rate = parameters.sample_rate as u32;
        let limit = coarse_snap_limit(time_base, rate)?;
        // 流起点是丢掉编码器延迟（`initial_padding`，如 MKV 里 MP3 的 1105、AAC 的 1024）之后的第一个样本；
        // 完整的帧从首包算起，所以网格原点是起点之前 `initial_padding` 个样本（MP3 首帧只剩 47 个样本，之后才是整帧）。
        let anchor = sample_index(start_time, time_base, rate) - parameters.initial_padding.max(0) as i64;
        Some(Self { anchor, frame, limit })
    }

    fn snap(&self, index: i64) -> i64 {
        snap_to_frame_grid(index, self.anchor, self.frame, self.limit)
    }
}

struct AudioSession {
    input: Input,
    decoder: AudioDecoder,
    stream_index: i32,
    audio_stream: usize,
    in_rate: u32,
    out_rate: u32,
    channels: usize,
    in_layout_template: Layout,
    out_layout: Layout,
    stream_start_seconds: Option<f64>,
    stream_end_seconds: Option<f64>,
    codec: Option<String>,
    frame_grid: Option<FrameGrid>,
    /// 已输出的样本（每声道），第一个样本的输出序号为 `buffer_start`。
    buffer: Vec<Vec<f32>>,
    buffer_start: i64,
    segment: Option<Segment>,
    stop: Arc<AtomicBool>,
}

impl AudioSession {
    fn open(options: &AudioOpenOptions, stop: Arc<AtomicBool>) -> Result<Option<Self>, ServiceError> {
        let Some(input) = Input::open_audio(&options.path, options.audio_stream, stop.clone())? else { return Ok(None) };
        let parameters = input.parameters();
        if parameters.sample_rate <= 0 || parameters.ch_layout.nb_channels <= 0 {
            return Err(ServiceError::new("UNSUPPORTED_FORMAT", "声音流的采样率或声道数无效"));
        }
        let in_rate = parameters.sample_rate as u32;
        let stream = input.stream();
        let decoder = AudioDecoder::open(parameters, stream.time_base)?;
        let in_layout_template = Layout::input(&parameters.ch_layout)?;
        let out_layout = Layout::output(&in_layout_template)?;
        let start = (stream.start_time != ff::AV_NOPTS_VALUE).then(|| pts_to_seconds(stream.start_time, input.time_base));
        let end = (stream.duration != ff::AV_NOPTS_VALUE && stream.duration > 0).then(|| pts_to_seconds(stream.duration, input.time_base) + start.unwrap_or(0.0));
        let codec = crate::ffmpeg_info::c_text(unsafe { ff::avcodec_get_name(parameters.codec_id) });
        let channels = out_layout.0.nb_channels as usize;
        let frame_grid = FrameGrid::new(parameters, input.time_base, stream.start_time);
        Ok(Some(Self {
            stream_index: input.stream_index,
            input,
            decoder,
            audio_stream: options.audio_stream,
            in_rate,
            out_rate: options.sample_rate.unwrap_or(in_rate),
            channels,
            in_layout_template,
            out_layout,
            stream_start_seconds: start,
            stream_end_seconds: end,
            codec,
            frame_grid,
            buffer: vec![Vec::new(); channels],
            buffer_start: 0,
            segment: None,
            stop,
        }))
    }

    fn info(&self) -> Value {
        json!({
            "found": true,
            "audioStream": self.audio_stream,
            "streamIndex": self.stream_index,
            "codec": self.codec,
            "decoderName": self.decoder.name,
            "sampleRate": self.out_rate,
            "sourceSampleRate": self.in_rate,
            "channels": self.channels,
            "channelLayout": self.out_layout.describe(),
            "resampler": if self.in_rate != self.out_rate { "soxr" } else { "none" },
            "startSeconds": self.stream_start_seconds,
            "endSeconds": self.stream_end_seconds,
        })
    }

    fn decoded_end(&self) -> i64 {
        self.buffer_start + self.buffer.first().map_or(0, Vec::len) as i64
    }

    /// 读取 [start, start + frames)：平面 float32 小端字节；第二项为是否重新定位。
    fn read(&mut self, start: i64, frames: usize) -> Result<(Vec<u8>, bool), ServiceError> {
        let end = start + frames as i64;
        let plan = read_plan(start, self.segment.as_ref().map(|_| self.buffer_start), self.decoded_end(), self.out_rate as i64 * 2);
        let seeked = plan == ReadPlan::Restart;
        if seeked {
            self.restart(start)?;
        }
        self.fill(end)?;
        let mut bytes = Vec::with_capacity(frames * self.channels * 4);
        for plane in &self.buffer {
            for index in start..end {
                let offset = index - self.buffer_start;
                let value = if offset >= 0 && (offset as usize) < plane.len() { plane[offset as usize] } else { 0.0 };
                bytes.extend_from_slice(&value.to_le_bytes());
            }
        }
        // 保留最近约半秒（相邻读取的保护重叠与小幅回退不必重新定位）。
        let keep_from = (end - self.out_rate as i64 / 2).min(self.decoded_end());
        if keep_from > self.buffer_start {
            let drop = (keep_from - self.buffer_start) as usize;
            for plane in &mut self.buffer {
                plane.drain(..drop.min(plane.len()));
            }
            self.buffer_start = keep_from;
        }
        Ok((bytes, seeked))
    }

    /// 在输出样本 `target` 之前按对齐周期开始新的一段：定位、清空解码器与重采样器。
    fn restart(&mut self, target: i64) -> Result<(), ServiceError> {
        let (m0, n0) = segment_start(target, self.in_rate, self.out_rate, PREROLL_INPUT_SAMPLES);
        let seek_seconds = m0 as f64 / self.in_rate as f64 - SEEK_MARGIN_SECONDS;
        self.seek(seek_seconds)?;
        for plane in &mut self.buffer {
            plane.clear();
        }
        self.buffer_start = n0;
        self.segment = Some(Segment::new(m0, n0, seek_seconds, 0));
        Ok(())
    }

    fn seek(&mut self, seconds: f64) -> Result<(), ServiceError> {
        let before_start = self.stream_start_seconds.map_or(true, |start| seconds <= start);
        if before_start {
            self.input.seek_start()?;
        } else {
            self.input.seek(seconds_to_ticks(seconds, self.input.time_base))?;
        }
        // 重新打开解码器而不是 flush（2.10，与 FFmpeg CLI 定位后新建解码器一致）：`avcodec_flush_buffers` 只清重叠缓冲，
        // 不重置 AAC 感知噪声替代（PNS）等解码器内部的随机数状态，定位后的输出会随此前读过多少而变，回到开头也与完整解码不同。
        self.decoder = AudioDecoder::open(self.input.parameters(), self.input.stream().time_base)?;
        Ok(())
    }

    /// 解码并重采样，直到输出到 `end`（或流结束）。
    fn fill(&mut self, end: i64) -> Result<(), ServiceError> {
        let tolerance = (self.in_rate as i64 / 1000).max(1);
        loop {
            if self.stop.load(Ordering::Relaxed) {
                return Err(ServiceError::new("CANCELLED", "声音会话已关闭"));
            }
            let segment = self.segment.as_mut().expect("读取前已建立解码段");
            if segment.next_out >= end || segment.ended_at.is_some() {
                return Ok(());
            }
            if segment.pending.is_none() && !segment.decoder_eof {
                match self.next_frame()? {
                    Some(frame) => {
                        let segment = self.segment.as_mut().expect("解码段存在");
                        let raw = unsafe { &*frame.0 };
                        let timestamp = frame.timestamp();
                        let index = match timestamp {
                            Some(pts) => sample_index(pts, self.input.time_base, raw.sample_rate.max(1) as u32),
                            None => segment.next_in,
                        };
                        if segment.awaiting_first {
                            segment.awaiting_first = false;
                            // 解封装定位落得比预热起点晚（没有索引的容器）：再往前定位，流开头之前除外。
                            let late = index > segment.next_in + tolerance;
                            let after_start = self.stream_start_seconds.is_some_and(|start| segment.seek_seconds > start + 0.05);
                            if late && after_start && segment.seek_retries < MAX_SEEK_RETRIES {
                                let retries = segment.seek_retries + 1;
                                let seconds = segment.seek_seconds - 1.0;
                                let (next_in, next_out) = (segment.next_in, segment.next_out);
                                self.seek(seconds)?;
                                self.segment = Some(Segment::new(next_in, next_out, seconds, retries));
                                continue;
                            }
                        }
                        let exact = !segment.fed;
                        // 本段送入样本前的帧（定位后的首帧）：粗时间基下吸附到帧长网格，与连续读取的位置一致。
                        // 之后的帧按容差连续累加，本来就在网格上。
                        let index = match self.frame_grid {
                            Some(grid) if exact && raw.nb_samples as i64 == grid.frame => grid.snap(index),
                            _ => index,
                        };
                        segment.pending = Some((frame, index, exact));
                    }
                    None => {
                        let segment = self.segment.as_mut().expect("解码段存在");
                        segment.decoder_eof = true;
                    }
                }
                continue;
            }
            if let Some((frame, index, exact)) = segment.pending.take() {
                self.feed_frame(frame, index, if exact { 0 } else { tolerance })?;
                continue;
            }
            // 解码器已排空：排空重采样器，记下流结束的位置。
            self.drain()?;
        }
    }

    /// 取下一个解出的帧；文件结束返回 None。损坏的包跳过并记录。
    fn next_frame(&mut self) -> Result<Option<Frame>, ServiceError> {
        loop {
            let frame = Frame(unsafe { ff::av_frame_alloc() });
            if frame.0.is_null() {
                return Err(ServiceError::new("INTERNAL", "无法分配帧"));
            }
            let received = unsafe { ff::avcodec_receive_frame(self.decoder.context, frame.0) };
            if received >= 0 {
                return Ok(Some(frame));
            }
            if received == ff::AVERROR_EOF {
                return Ok(None);
            }
            if received != ff::AVERROR(EAGAIN) {
                return Err(ServiceError::new("DECODE_FAILED", format!("声音解码失败：{}", error_text(received))));
            }
            let segment = self.segment.as_mut().expect("解码段存在");
            if segment.demux_eof {
                return Ok(None);
            }
            match self.input.read()? {
                Some(packet) => {
                    let sent = unsafe { ff::avcodec_send_packet(self.decoder.context, packet.0) };
                    if sent < 0 && sent != ff::AVERROR(EAGAIN) {
                        logging::warn("audio.session.packet_failed", "跳过无法解码的声音包", json!({ "error": error_text(sent) }));
                    }
                }
                None => {
                    self.segment.as_mut().expect("解码段存在").demux_eof = true;
                    unsafe { ff::avcodec_send_packet(self.decoder.context, ptr::null()) };
                }
            }
        }
    }

    fn ensure_resampler(&mut self, frame: &ff::AVFrame) -> Result<(), ServiceError> {
        let segment = self.segment.as_mut().expect("解码段存在");
        if segment.resampler.as_ref().is_some_and(|resampler| resampler.matches(frame)) {
            return Ok(());
        }
        if segment.resampler.is_some() {
            logging::warn("audio.session.format_changed", "声音格式在流中改变，重建重采样器", json!({ "sampleRate": frame.sample_rate, "channels": frame.ch_layout.nb_channels }));
            if frame.ch_layout.nb_channels as usize != self.channels {
                return Err(ServiceError::new("UNSUPPORTED_FORMAT", "声音声道数在流中改变"));
            }
        }
        let (source_layout, in_layout) = if frame.ch_layout.nb_channels > 0 { (Layout::copy(&frame.ch_layout)?, Layout::input(&frame.ch_layout)?) } else { (Layout::copy(&frame.ch_layout)?, Layout::copy(&self.in_layout_template.0)?) };
        let resampler = Resampler::new(source_layout, in_layout, frame.format, frame.sample_rate.max(1) as u32, &self.out_layout, self.out_rate)?;
        self.segment.as_mut().expect("解码段存在").resampler = Some(resampler);
        Ok(())
    }

    /// 按落位规则送入一帧（缺口先补零）；补零只补到够用为止，剩下的帧留待下次。
    fn feed_frame(&mut self, frame: Frame, index: i64, tolerance: i64) -> Result<(), ServiceError> {
        let raw = unsafe { &*frame.0 };
        self.ensure_resampler(raw)?;
        let segment = self.segment.as_mut().expect("解码段存在");
        let count = raw.nb_samples.max(0) as i64;
        let skip = match place(index, segment.next_in, tolerance) {
            Placement::Contiguous => 0,
            Placement::Overlap(samples) => samples,
            Placement::Gap(samples) => {
                // 帧之前是静音（流开始前或缺口）：补零，补够本次需要后保留这一帧。
                let chunk = samples.min(SILENCE_CHUNK);
                let resampler = segment.resampler.as_mut().expect("重采样器已建立");
                let planes = resampler.silence_planes();
                let produced = resampler.convert(Some(&planes), chunk as usize, &mut self.buffer)?;
                segment.next_in += chunk;
                segment.next_out += produced as i64;
                // 缺口没补完时下一轮继续补（精确补到帧的位置）；够用时 `fill` 停止，这一帧留待下次读取。
                segment.pending = Some((frame, index, true));
                return Ok(());
            }
        };
        if skip >= count {
            return Ok(());
        }
        let resampler = segment.resampler.as_mut().expect("重采样器已建立");
        let planes = resampler.frame_planes(raw, skip as usize);
        let fed = (count - skip) as usize;
        let produced = resampler.convert(Some(&planes), fed, &mut self.buffer)?;
        segment.next_in += fed as i64;
        segment.next_out += produced as i64;
        segment.fed = true;
        Ok(())
    }

    fn drain(&mut self) -> Result<(), ServiceError> {
        let segment = self.segment.as_mut().expect("解码段存在");
        if let Some(resampler) = segment.resampler.as_mut() {
            loop {
                let produced = resampler.convert(None, 0, &mut self.buffer)?;
                segment.next_out += produced as i64;
                if produced == 0 {
                    break;
                }
            }
        }
        segment.ended_at = Some(segment.next_out);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 用 FFmpeg CLI 生成测试文件（与链接的库同一构建，`video-decoder-ffmpeg.cjs test` 已把 bin 放进 PATH）。
    fn generate(name: &str, args: &[&str]) -> Option<String> {
        let path = std::env::temp_dir().join(format!("henji-audio-test-{}-{name}", std::process::id()));
        let status = std::process::Command::new("ffmpeg").args(["-v", "error", "-y"]).args(args).arg(&path).status().ok()?;
        status.success().then(|| path.to_string_lossy().into_owned())
    }

    fn read(session: &mut AudioSession, start: i64, frames: usize) -> Vec<Vec<f32>> {
        let (bytes, _) = session.read(start, frames).expect("读取成功");
        let values: Vec<f32> = bytes.chunks_exact(4).map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]])).collect();
        values.chunks(frames).map(<[f32]>::to_vec).collect()
    }

    fn open(path: &str, rate: Option<u32>) -> AudioSession {
        AudioSession::open(&AudioOpenOptions { audio_id: "va-1".into(), path: path.into(), audio_stream: 0, sample_rate: rate }, Arc::new(AtomicBool::new(false))).expect("打开成功").expect("有声音流")
    }

    fn peak(plane: &[f32]) -> (usize, f32) {
        plane.iter().enumerate().fold((0, 0.0), |best, (index, value)| if value.abs() > best.1 { (index, value.abs()) } else { best })
    }

    #[test]
    fn soxr_output_is_aligned_to_the_absolute_grid_from_any_start() {
        // 44.1kHz 单声道：第 4410 个样本（0.1s）一个冲激。重采样到 48kHz 后应在第 4800 个样本。
        let Some(path) = generate("impulse.wav", &["-f", "lavfi", "-i", "aevalsrc='if(eq(n,4410)+eq(n,44100),1,0)':s=44100:d=2", "-c:a", "pcm_f32le"]) else {
            eprintln!("跳过：没有 ffmpeg");
            return;
        };
        let mut session = open(&path, Some(48_000));
        assert_eq!(session.info()["resampler"], "soxr");
        // 从开头连续读、从中间任意起点定位读，冲激都落在同一个绝对样本上。
        let whole = read(&mut session, 0, 96_000);
        assert_eq!(peak(&whole[0]).0, 4800);
        assert_eq!(peak(&whole[0][10_000..]).0 + 10_000, 48_000);
        let mut fresh = open(&path, Some(48_000));
        let late = read(&mut fresh, 47_123, 2000);
        assert_eq!(peak(&late[0]).0 + 47_123, 48_000);
        assert!(peak(&late[0]).1 > 0.9);
        // 流结束后是静音。
        let after = read(&mut fresh, 200_000, 1000);
        assert!(after[0].iter().all(|value| *value == 0.0));
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn same_rate_is_bit_exact_and_reads_continue_without_seeking() {
        let Some(path) = generate("ramp.wav", &["-f", "lavfi", "-i", "aevalsrc='(mod(n,1000)/1000)|(-mod(n,1000)/1000)':s=48000:d=3", "-c:a", "pcm_f32le"]) else {
            return;
        };
        let mut session = open(&path, Some(48_000));
        assert_eq!(session.info()["resampler"], "none");
        assert_eq!(session.channels, 2);
        let (_, first_seeked) = session.read(23_999, 24_003).unwrap();
        assert!(first_seeked);
        // 相邻混音块的读取（约 3 个样本保护重叠）续解，不重新定位。
        let (bytes, seeked) = session.read(47_999, 24_003).unwrap();
        assert!(!seeked);
        let values: Vec<f32> = bytes.chunks_exact(4).map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]])).collect();
        for (offset, value) in values[..24_003].iter().enumerate() {
            let sample = 47_999 + offset as i64;
            assert_eq!(*value, (sample % 1000) as f32 / 1000.0, "左声道第 {sample} 个样本");
        }
        assert_eq!(values[24_003], -((47_999 % 1000) as f32 / 1000.0));
        // 负起点：流开始前补零。
        let mut fresh = open(&path, None);
        let early = read(&mut fresh, -10, 20);
        assert!(early[0][..10].iter().all(|value| *value == 0.0));
        assert_eq!(early[0][11], 0.001);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn missing_stream_is_not_found_and_aac_priming_is_removed() {
        let Some(path) = generate("tone.m4a", &["-f", "lavfi", "-i", "aevalsrc='if(eq(n,9600),1,0)':s=48000:d=1", "-c:a", "aac", "-b:a", "256k"]) else {
            return;
        };
        let missing = AudioSession::open(&AudioOpenOptions { audio_id: "va-2".into(), path: path.clone(), audio_stream: 1, sample_rate: None }, Arc::new(AtomicBool::new(false))).unwrap();
        assert!(missing.is_none());
        // AAC 编码器延迟（起始填充）由 FFmpeg 去掉：冲激仍在 0.2s 附近（AAC 有损，允许 ±2 个样本）。
        let mut session = open(&path, Some(48_000));
        let samples = read(&mut session, 0, 48_000);
        let (index, _) = peak(&samples[0]);
        assert!((index as i64 - 9600).abs() <= 2, "冲激位置 {index}");
        let _ = std::fs::remove_file(path);
    }

    /// 双声道测试信号：每个声道一个正弦加一个扫频（非周期，任何样本错位都会产生大误差；与 2.6 场景同一形式）。
    fn tone_args(rate: u32) -> Vec<String> {
        let source = |frequency: u32| format!("aevalsrc='0.2*sin(2*PI*{frequency}*t)+0.1*sin(2*PI*({}+{}*t)*t)':s={rate}:d=4", frequency * 2 + 37, 50 + frequency / 10);
        ["-f", "lavfi", "-i", &source(700), "-f", "lavfi", "-i", &source(900), "-filter_complex", "[0:a][1:a]join=inputs=2:channel_layout=stereo[a]", "-map", "[a]"].iter().map(|text| text.to_string()).collect()
    }

    fn generate_tone(name: &str, rate: u32, codec: &[&str]) -> Option<String> {
        let mut args = tone_args(rate);
        args.extend(codec.iter().map(|text| text.to_string()));
        generate(name, &args.iter().map(String::as_str).collect::<Vec<_>>())
    }

    /// FFmpeg CLI 完整解码第 `stream` 条声音流的参考 PCM（交错 float32，从流的第一个输出样本起）。
    fn reference(path: &str, stream: usize, filter: Option<&str>) -> Vec<f32> {
        let map = format!("0:a:{stream}");
        let mut args = vec!["-v", "error", "-i", path, "-map", &map];
        if let Some(filter) = filter {
            args.extend(["-af", filter]);
        }
        args.extend(["-f", "f32le", "-"]);
        let output = std::process::Command::new("ffmpeg").args(&args).output().expect("ffmpeg 可运行");
        assert!(output.status.success(), "参考解码失败");
        output.stdout.chunks_exact(4).map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]])).collect()
    }

    /// 读取 [start, start + frames) 与参考（第一个参考样本在绝对样本 `offset`）逐样本比较，返回最大绝对误差。
    fn max_error(session: &mut AudioSession, reference: &[f32], offset: i64, start: i64, frames: usize) -> f32 {
        let channels = session.channels;
        let total = (reference.len() / channels) as i64;
        let planes = read(session, start, frames);
        let mut worst = 0f32;
        for (channel, plane) in planes.iter().enumerate() {
            for (index, value) in plane.iter().enumerate() {
                let position = start + index as i64 - offset;
                let expected = if (0..total).contains(&position) { reference[position as usize * channels + channel] } else { 0.0 };
                worst = worst.max((value - expected).abs());
            }
        }
        worst
    }

    #[test]
    fn aac_with_priming_and_noise_substitution_matches_ffmpeg_from_start_to_end() {
        // 2.10 缺陷 1、2：MP4 编辑列表下 AAC 首包 pts 为 -1024、带 skip_samples；末包带 discard_padding。
        // FFmpeg 默认的 AAC 编码器启用感知噪声替代（PNS），解码器的噪声随机数状态从第一个包起累积。
        let Some(path) = generate_tone("pns.mp4", 48_000, &["-c:a", "aac", "-b:a", "192k"]) else { return };
        let expected = reference(&path, 0, None);
        let total = expected.len() / 2;
        assert_eq!(total, 192_000, "参考按编辑列表裁掉首尾填充");
        // 流开头之前起读、0.5 秒块带 3 个样本保护重叠续读到流结束之后：逐样本与完整解码相同（首帧、末帧都不例外）。
        let mut session = open(&path, Some(48_000));
        let mut start = -480i64;
        while start < total as i64 + 24_000 {
            assert_eq!(max_error(&mut session, &expected, 0, start, 24_003), 0.0, "从 {start} 起的块");
            start += 24_000;
        }
        // 读过别处之后重新定位回开头：解码器重新打开，噪声随机数状态与完整解码一致。
        let mut session = open(&path, Some(48_000));
        assert!(max_error(&mut session, &expected, 0, 120_000, 4800) < 0.01);
        assert_eq!(max_error(&mut session, &expected, 0, 0, 24_000), 0.0, "回到开头");
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn seeks_place_the_first_frame_exactly_at_every_phase() {
        // 2.10：定位后跨过段起点的那一帧必须精确落位（此前按 1ms 容差合并，整帧错位最多 1ms）。
        // 关闭 PNS 的 AAC 定位解码与完整解码逐样本相同；目标覆盖段起点相对 1024 样本帧的各种相位。
        let Some(path) = generate_tone("nopns.mp4", 48_000, &["-c:a", "aac", "-b:a", "192k", "-aac_pns", "0"]) else { return };
        let expected = reference(&path, 0, None);
        for step in 0..48i64 {
            let target = 30_000 + step * 1031;
            let mut session = open(&path, Some(48_000));
            assert_eq!(max_error(&mut session, &expected, 0, target, 2000), 0.0, "定位到 {target}");
        }
        let _ = std::fs::remove_file(path);
        // Opus（20ms 帧、pre-skip 312）：此前目标 150000 处整段晚 40 个样本。Opus 定位后需约 80ms 收敛，误差为浮点级。
        let Some(path) = generate_tone("opus.ogg", 48_000, &["-c:a", "libopus", "-b:a", "160k"]) else { return };
        let expected = reference(&path, 0, None);
        let mut session = open(&path, Some(48_000));
        assert_eq!(max_error(&mut session, &expected, 0, -480, 4800), 0.0, "Opus 流开头（pre-skip）");
        for target in [150_000i64, 72_000, 30_011, 100_003] {
            let mut session = open(&path, Some(48_000));
            let error = max_error(&mut session, &expected, 0, target, 9600);
            assert!(error < 1e-5, "Opus 定位到 {target} 误差 {error}");
        }
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn mp3_encoder_delay_and_resampling_stay_on_the_absolute_grid() {
        // LAME 头的编码器延迟与末尾填充由 FFmpeg 去掉，流起点 1105/44100 秒不在 48k 输出网格上：
        // 参考先在流开头前补零到绝对 0 再用 soxr 重采样（与原生同一口径），开头、定位与结尾都应一致。
        let Some(path) = generate_tone("lame.mp3", 44_100, &["-c:a", "libmp3lame", "-b:a", "192k"]) else { return };
        let mut session = open(&path, Some(48_000));
        let start = session.stream_start_seconds.expect("有起点");
        let delay = (start * 44_100.0).round() as i64;
        assert_eq!(delay, 1105);
        let expected = reference(&path, 0, Some(&format!("adelay={delay}S:all=1,aresample=48000:resampler=soxr:precision=28")));
        let total = (expected.len() / 2) as i64;
        assert!(max_error(&mut session, &expected, 0, -480, 48_000) < 1e-6, "开头");
        assert!(max_error(&mut session, &expected, 0, 100_000, 24_000) < 1e-6, "定位");
        assert!(max_error(&mut session, &expected, 0, total - 12_000, 24_000) < 1e-6, "结尾");
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn millisecond_containers_snap_seeks_to_the_frame_grid() {
        // 2.10：OBS 风格 MKV（H.264 + 两条 AAC 立体声）。Matroska 时间戳只到毫秒，流中间定位后首帧时间最多偏半毫秒；
        // 固定帧长编码吸附到帧长网格后，任意定位与连续读取逐样本相同（关 PNS，排除噪声替代的随机数差异）。
        let mut args: Vec<String> = ["-f", "lavfi", "-i", "testsrc2=s=320x240:r=30:d=4"].iter().map(|text| text.to_string()).collect();
        let source = |frequency: u32| format!("aevalsrc='0.2*sin(2*PI*{frequency}*t)+0.1*sin(2*PI*({}+{}*t)*t)':s=48000:d=4", frequency * 2 + 37, 50 + frequency / 10);
        for frequency in [300, 600, 700, 900] {
            args.extend(["-f".to_string(), "lavfi".to_string(), "-i".to_string(), source(frequency)]);
        }
        args.extend(
            ["-filter_complex", "[1:a][2:a]join=inputs=2:channel_layout=stereo[game];[3:a][4:a]join=inputs=2:channel_layout=stereo[mic]", "-map", "0:v", "-map", "[game]", "-map", "[mic]", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-aac_pns", "0", "-shortest"]
                .iter()
                .map(|text| text.to_string()),
        );
        let Some(path) = generate("obs.mkv", &args.iter().map(String::as_str).collect::<Vec<_>>()) else { return };
        for stream in [0usize, 1] {
            let expected = reference(&path, stream, None);
            let open_stream = || AudioSession::open(&AudioOpenOptions { audio_id: "va-mkv".into(), path: path.clone(), audio_stream: stream, sample_rate: Some(48_000) }, Arc::new(AtomicBool::new(false))).unwrap().unwrap();
            let grid = open_stream().frame_grid.expect("毫秒时间基的 AAC 启用帧网格");
            assert_eq!((grid.frame, grid.limit), (1024, 25));
            let mut session = open_stream();
            assert_eq!(max_error(&mut session, &expected, 0, -480, 96_000), 0.0, "第 {stream} 条流从开头连续读");
            for step in 0..24i64 {
                let target = 30_000 + step * 4099;
                let mut session = open_stream();
                assert_eq!(max_error(&mut session, &expected, 0, target, 2000), 0.0, "第 {stream} 条流定位到 {target}");
            }
        }
        let _ = std::fs::remove_file(path);
        // MP3、AC-3 放进 MKV：帧长 1152、1536。AC-3 解码带抖动随机数，定位后误差为噪声级。
        for (name, codec, frame, tolerance) in [("mp3.mkv", "libmp3lame", 1152i64, 1e-6f32), ("ac3.mkv", "ac3", 1536, 1e-4)] {
            let Some(path) = generate_tone(name, 48_000, &["-c:a", codec, "-b:a", "192k"]) else { return };
            let expected = reference(&path, 0, None);
            assert_eq!(open(&path, Some(48_000)).frame_grid.map(|grid| grid.frame), Some(frame), "{name}");
            for step in 0..12i64 {
                let target = 30_000 + step * 7001;
                let mut session = open(&path, Some(48_000));
                let error = max_error(&mut session, &expected, 0, target, 2000);
                assert!(error < tolerance, "{name} 定位到 {target} 误差 {error}");
            }
            let _ = std::fs::remove_file(path);
        }
        // 可变帧长（Opus）与细时间基（MP4）不吸附。
        let Some(path) = generate_tone("opus.webm", 48_000, &["-c:a", "libopus", "-b:a", "160k"]) else { return };
        assert_eq!(open(&path, Some(48_000)).frame_grid, None);
        let _ = std::fs::remove_file(path);
        let Some(path) = generate_tone("aac-grid.mp4", 48_000, &["-c:a", "aac", "-b:a", "192k"]) else { return };
        assert_eq!(open(&path, Some(48_000)).frame_grid, None);
        let _ = std::fs::remove_file(path);
    }
}
