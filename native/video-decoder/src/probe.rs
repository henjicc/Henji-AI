//! 素材探测：libavformat 打开文件并读取容器与各流信息。支持经中断回调取消。

use serde_json::{json, Value};
use std::ffi::{c_int, c_void, CString};
use std::path::Path;
use std::ptr;
use std::sync::atomic::{AtomicBool, Ordering};

use ffmpeg_sys_next as ff;

use crate::ffmpeg_info::c_text;
use crate::protocol::ServiceError;

/// 由像素格式描述得出的视频平面信息。
#[derive(Debug, Clone, PartialEq)]
pub struct PixelLayout {
    pub bit_depth: Option<i32>,
    pub chroma_subsampling: Option<&'static str>,
    pub has_alpha: bool,
    pub is_rgb: bool,
}

/// 色度采样只由描述符的 log2 采样因子、分量数与 RGB 标志决定（纯函数，便于测试）。
pub fn chroma_subsampling(log2_w: u8, log2_h: u8, components: u8, is_rgb: bool, has_alpha: bool) -> Option<&'static str> {
    let color_components = if has_alpha { components.saturating_sub(1) } else { components };
    if is_rgb {
        return Some("4:4:4");
    }
    if color_components <= 1 {
        return Some("4:0:0");
    }
    match (log2_w, log2_h) {
        (0, 0) => Some("4:4:4"),
        (1, 0) => Some("4:2:2"),
        (1, 1) => Some("4:2:0"),
        (2, 0) => Some("4:1:1"),
        (0, 1) => Some("4:4:0"),
        (2, 2) => Some("4:1:0"),
        _ => None,
    }
}

pub fn pixel_layout(format: c_int) -> Option<(String, PixelLayout)> {
    if format < 0 || format >= ff::AVPixelFormat::AV_PIX_FMT_NB as c_int {
        return None;
    }
    // SAFETY: 取值已限定在 [0, AV_PIX_FMT_NB)，绑定由同一份头文件生成，枚举值连续。
    let pixel_format: ff::AVPixelFormat = unsafe { std::mem::transmute::<c_int, ff::AVPixelFormat>(format) };
    let descriptor = unsafe { ff::av_pix_fmt_desc_get(pixel_format) };
    if descriptor.is_null() {
        return None;
    }
    let descriptor = unsafe { &*descriptor };
    let has_alpha = descriptor.flags & ff::AV_PIX_FMT_FLAG_ALPHA as u64 != 0;
    let is_rgb = descriptor.flags & ff::AV_PIX_FMT_FLAG_RGB as u64 != 0;
    let depth = descriptor.comp[0].depth;
    Some((
        c_text(descriptor.name).unwrap_or_default(),
        PixelLayout {
            bit_depth: (depth > 0).then_some(depth),
            chroma_subsampling: chroma_subsampling(descriptor.log2_chroma_w, descriptor.log2_chroma_h, descriptor.nb_components, is_rgb, has_alpha),
            has_alpha,
            is_rgb,
        },
    ))
}

pub fn rational_value(rational: ff::AVRational) -> Value {
    if rational.num > 0 && rational.den > 0 {
        json!({ "num": rational.num, "den": rational.den })
    } else {
        Value::Null
    }
}

pub fn rational_to_f64(rational: ff::AVRational) -> Option<f64> {
    (rational.num > 0 && rational.den > 0).then(|| rational.num as f64 / rational.den as f64)
}

/// 优先平均帧率（与 ffprobe avg_frame_rate 一致），缺失时退回 r_frame_rate。
pub fn preferred_frame_rate(average: ff::AVRational, real: ff::AVRational) -> Option<f64> {
    rational_to_f64(average).or_else(|| rational_to_f64(real))
}

pub fn timestamp_seconds(value: i64, time_base: ff::AVRational) -> Option<f64> {
    if value == ff::AV_NOPTS_VALUE || time_base.den == 0 {
        None
    } else {
        Some(value as f64 * time_base.num as f64 / time_base.den as f64)
    }
}

/// HDR 判断只看传输特性：PQ（smpte2084）与 HLG（arib-std-b67）。本次按 SDR 解释（重要记录 008）。
pub fn is_hdr_transfer(transfer: Option<&str>) -> bool {
    matches!(transfer, Some("smpte2084") | Some("arib-std-b67"))
}

pub fn fourcc(tag: u32) -> Option<String> {
    if tag == 0 {
        return None;
    }
    let bytes = tag.to_le_bytes();
    if bytes.iter().all(|byte| byte.is_ascii_graphic() || *byte == b' ') {
        Some(String::from_utf8_lossy(&bytes).trim_end().to_string())
    } else {
        Some(format!("0x{tag:08x}"))
    }
}

fn dictionary_value(dictionary: *const ff::AVDictionary, key: &str) -> Option<String> {
    let key = CString::new(key).ok()?;
    let entry = unsafe { ff::av_dict_get(dictionary, key.as_ptr(), ptr::null(), 0) };
    if entry.is_null() {
        None
    } else {
        c_text(unsafe { (*entry).value })
    }
}

pub(crate) fn error_text(code: c_int) -> String {
    let mut buffer = [0 as std::ffi::c_char; 256];
    unsafe { ff::av_strerror(code, buffer.as_mut_ptr(), buffer.len()) };
    c_text(buffer.as_ptr()).unwrap_or_else(|| format!("FFmpeg 错误 {code}"))
}

unsafe extern "C" fn interrupt_callback(opaque: *mut c_void) -> c_int {
    let flag = unsafe { &*(opaque as *const AtomicBool) };
    flag.load(Ordering::Relaxed) as c_int
}

pub(crate) struct FormatContext(pub(crate) *mut ff::AVFormatContext);

impl Drop for FormatContext {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe { ff::avformat_close_input(&mut self.0) };
        }
    }
}

struct Dictionary(*mut ff::AVDictionary);

impl Drop for Dictionary {
    fn drop(&mut self) {
        unsafe { ff::av_dict_free(&mut self.0) };
    }
}

fn media_kind(kind: ff::AVMediaType) -> &'static str {
    match kind {
        ff::AVMediaType::AVMEDIA_TYPE_VIDEO => "video",
        ff::AVMediaType::AVMEDIA_TYPE_AUDIO => "audio",
        ff::AVMediaType::AVMEDIA_TYPE_SUBTITLE => "subtitle",
        ff::AVMediaType::AVMEDIA_TYPE_DATA => "data",
        ff::AVMediaType::AVMEDIA_TYPE_ATTACHMENT => "attachment",
        _ => "unknown",
    }
}

/// 显示矩阵给出的旋转角度（度）。
pub(crate) fn stream_rotation(parameters: &ff::AVCodecParameters) -> Option<f64> {
    unsafe {
        let side_data = ff::av_packet_side_data_get(parameters.coded_side_data, parameters.nb_coded_side_data, ff::AVPacketSideDataType::AV_PKT_DATA_DISPLAYMATRIX);
        if side_data.is_null() || (*side_data).size < 36 {
            None
        } else {
            let degrees = ff::av_display_rotation_get((*side_data).data as *const i32);
            degrees.is_finite().then_some(degrees)
        }
    }
}

/// 视频流是否带透明：像素格式、`alpha_mode` 标签（WebM VP8/VP9 透明）或参数声明。
pub(crate) fn stream_has_alpha(stream: &ff::AVStream, parameters: &ff::AVCodecParameters) -> bool {
    let alpha_tag = dictionary_value(stream.metadata, "alpha_mode").is_some_and(|value| value == "1");
    let alpha_declared = parameters.alpha_mode != ff::AVAlphaMode::AVALPHA_MODE_UNSPECIFIED;
    pixel_layout(parameters.format).is_some_and(|(_, layout)| layout.has_alpha) || alpha_tag || alpha_declared
}

fn video_details(stream: &ff::AVStream, parameters: &ff::AVCodecParameters) -> Value {
    let layout = pixel_layout(parameters.format);
    let transfer = c_text(unsafe { ff::av_color_transfer_name(parameters.color_trc) });
    let rotation = stream_rotation(parameters);
    json!({
        "width": parameters.width,
        "height": parameters.height,
        "pixelFormat": layout.as_ref().map(|(name, _)| name.clone()),
        "bitDepth": layout.as_ref().and_then(|(_, layout)| layout.bit_depth).or((parameters.bits_per_raw_sample > 0).then_some(parameters.bits_per_raw_sample)),
        "chromaSubsampling": layout.as_ref().and_then(|(_, layout)| layout.chroma_subsampling),
        "isRgb": layout.as_ref().is_some_and(|(_, layout)| layout.is_rgb),
        "hasAlpha": stream_has_alpha(stream, parameters),
        "avgFrameRate": rational_value(stream.avg_frame_rate),
        "realFrameRate": rational_value(stream.r_frame_rate),
        "frameRate": preferred_frame_rate(stream.avg_frame_rate, stream.r_frame_rate),
        "sampleAspectRatio": rational_value(parameters.sample_aspect_ratio),
        "fieldOrder": format!("{:?}", parameters.field_order).trim_start_matches("AV_FIELD_").to_ascii_lowercase(),
        "rotationDegrees": rotation,
        "color": {
            "range": c_text(unsafe { ff::av_color_range_name(parameters.color_range) }),
            "primaries": c_text(unsafe { ff::av_color_primaries_name(parameters.color_primaries) }),
            "transfer": transfer,
            "matrix": c_text(unsafe { ff::av_color_space_name(parameters.color_space) }),
            "chromaLocation": c_text(unsafe { ff::av_chroma_location_name(parameters.chroma_location) }),
        },
        "hdr": is_hdr_transfer(transfer.as_deref()),
    })
}

fn audio_details(parameters: &ff::AVCodecParameters) -> Value {
    let mut layout = [0 as std::ffi::c_char; 128];
    let described = unsafe { ff::av_channel_layout_describe(&parameters.ch_layout, layout.as_mut_ptr(), layout.len()) };
    let sample_format = if parameters.format >= 0 && parameters.format < ff::AVSampleFormat::AV_SAMPLE_FMT_NB as c_int {
        // SAFETY: 取值已限定在 [0, AV_SAMPLE_FMT_NB)。
        let format: ff::AVSampleFormat = unsafe { std::mem::transmute::<c_int, ff::AVSampleFormat>(parameters.format) };
        c_text(unsafe { ff::av_get_sample_fmt_name(format) })
    } else {
        None
    };
    let bits = if parameters.bits_per_raw_sample > 0 { parameters.bits_per_raw_sample } else { parameters.bits_per_coded_sample };
    json!({
        "sampleRate": parameters.sample_rate,
        "channels": parameters.ch_layout.nb_channels,
        // 声道顺序未指定（如 MXF 单声道 PCM 轨）时不给布局名，与 ffprobe 一致。
        "channelLayout": if described > 0 && parameters.ch_layout.order != ff::AVChannelOrder::AV_CHANNEL_ORDER_UNSPEC { c_text(layout.as_ptr()) } else { None },
        "sampleFormat": sample_format,
        "bitsPerSample": (bits > 0).then_some(bits),
    })
}

/// 安全打开本地文件并读取流信息：只允许绝对路径与 `file` 协议；`cancelled` 被置位后阻塞 I/O 经中断回调尽快返回。
/// `cancelled` 的地址在返回的上下文存续期间必须有效（中断回调持有该指针）。
pub(crate) fn open_input(path: &str, cancelled: &AtomicBool) -> Result<FormatContext, ServiceError> {
    if !Path::new(path).is_absolute() {
        return Err(ServiceError::new("INVALID_REQUEST", "探测路径必须是绝对路径"));
    }
    // 只允许本地文件协议：显式 file: 前缀避免路径被解析成其他协议，白名单阻止容器内引用网络资源。
    let url = CString::new(format!("file:{path}")).map_err(|_| ServiceError::new("INVALID_REQUEST", "路径包含空字符"))?;
    let mut options = Dictionary(ptr::null_mut());
    unsafe {
        ff::av_dict_set(&mut options.0, c"protocol_whitelist".as_ptr(), c"file".as_ptr(), 0);
    }

    let mut context = FormatContext(unsafe { ff::avformat_alloc_context() });
    if context.0.is_null() {
        return Err(ServiceError::new("INTERNAL", "无法分配格式上下文"));
    }
    unsafe {
        (*context.0).interrupt_callback = ff::AVIOInterruptCB {
            callback: Some(interrupt_callback),
            opaque: cancelled as *const AtomicBool as *mut c_void,
        };
    }
    let opened = unsafe { ff::avformat_open_input(&mut context.0, url.as_ptr(), ptr::null(), &mut options.0) };
    if opened < 0 {
        // avformat_open_input 失败时会释放上下文并置空。
        context.0 = ptr::null_mut();
    }
    if cancelled.load(Ordering::Relaxed) {
        return Err(ServiceError::new("CANCELLED", "探测已取消"));
    }
    if opened < 0 {
        return Err(ServiceError::new("OPEN_FAILED", format!("无法打开文件：{}", error_text(opened))));
    }
    let found = unsafe { ff::avformat_find_stream_info(context.0, ptr::null_mut()) };
    if cancelled.load(Ordering::Relaxed) {
        return Err(ServiceError::new("CANCELLED", "探测已取消"));
    }
    if found < 0 {
        return Err(ServiceError::new("STREAM_INFO_FAILED", format!("无法读取流信息：{}", error_text(found))));
    }
    Ok(context)
}

/// 打开并探测文件。`cancelled` 被置位后 FFmpeg 的阻塞 I/O 会经中断回调尽快返回。
pub fn probe(path: &str, cancelled: &AtomicBool) -> Result<Value, ServiceError> {
    let context = open_input(path, cancelled)?;

    let format = unsafe { &*context.0 };
    let input_format = unsafe { &*format.iformat };
    let microseconds = ff::AVRational { num: 1, den: ff::AV_TIME_BASE };
    let streams = unsafe { std::slice::from_raw_parts(format.streams, format.nb_streams as usize) };
    let mut stream_values = Vec::with_capacity(streams.len());
    for &stream_pointer in streams {
        let stream = unsafe { &*stream_pointer };
        let parameters = unsafe { &*stream.codecpar };
        let kind = media_kind(parameters.codec_type);
        let descriptor = unsafe { ff::avcodec_descriptor_get(parameters.codec_id) };
        let mut value = json!({
            "index": stream.index,
            "kind": kind,
            // 无编解码器的流（如 MOV 时间码 tmcd）返回 null，与 ffprobe 不输出 codec_name 一致。
            "codec": if parameters.codec_id == ff::AVCodecID::AV_CODEC_ID_NONE { None } else { c_text(unsafe { ff::avcodec_get_name(parameters.codec_id) }) },
            "codecLongName": if descriptor.is_null() { None } else { c_text(unsafe { (*descriptor).long_name }) },
            "profile": c_text(unsafe { ff::avcodec_profile_name(parameters.codec_id, parameters.profile) }),
            "codecTag": fourcc(parameters.codec_tag),
            "timeBase": rational_value(stream.time_base),
            "startTimeSeconds": timestamp_seconds(stream.start_time, stream.time_base),
            "durationSeconds": timestamp_seconds(stream.duration, stream.time_base),
            "frameCount": (stream.nb_frames > 0).then_some(stream.nb_frames),
            "bitRate": (parameters.bit_rate > 0).then_some(parameters.bit_rate),
            "isDefault": stream.disposition & ff::AV_DISPOSITION_DEFAULT as c_int != 0,
            "isAttachedPicture": stream.disposition & ff::AV_DISPOSITION_ATTACHED_PIC as c_int != 0,
        });
        if kind == "video" {
            value["video"] = video_details(stream, parameters);
        } else if kind == "audio" {
            value["audio"] = audio_details(parameters);
        }
        stream_values.push(value);
    }
    let best = |kind: ff::AVMediaType| {
        let index = unsafe { ff::av_find_best_stream(context.0, kind, -1, -1, ptr::null_mut(), 0) };
        (index >= 0).then_some(index)
    };
    Ok(json!({
        "path": path,
        "container": {
            "formatName": c_text(input_format.name),
            "formatLongName": c_text(input_format.long_name),
            "durationSeconds": timestamp_seconds(format.duration, microseconds),
            "startTimeSeconds": timestamp_seconds(format.start_time, microseconds),
            "bitRate": (format.bit_rate > 0).then_some(format.bit_rate),
        },
        "primaryVideoStreamIndex": best(ff::AVMediaType::AVMEDIA_TYPE_VIDEO),
        "primaryAudioStreamIndex": best(ff::AVMediaType::AVMEDIA_TYPE_AUDIO),
        "streams": stream_values,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pix(name: &str) -> c_int {
        let name = CString::new(name).unwrap();
        unsafe { ff::av_get_pix_fmt(name.as_ptr()) as c_int }
    }

    #[test]
    fn maps_common_pixel_formats() {
        let cases = [
            ("yuv420p", 8, "4:2:0", false),
            ("yuvj420p", 8, "4:2:0", false),
            ("yuv420p10le", 10, "4:2:0", false),
            ("yuv422p10le", 10, "4:2:2", false),
            ("yuv444p12le", 12, "4:4:4", false),
            ("yuva444p12le", 12, "4:4:4", true),
            ("nv12", 8, "4:2:0", false),
            ("p010le", 10, "4:2:0", false),
            ("gbrp10le", 10, "4:4:4", false),
            ("gray", 8, "4:0:0", false),
            ("yuv411p", 8, "4:1:1", false),
        ];
        for (name, depth, chroma, alpha) in cases {
            let (resolved, layout) = pixel_layout(pix(name)).unwrap_or_else(|| panic!("{name} 未识别"));
            assert_eq!(resolved, name);
            assert_eq!(layout.bit_depth, Some(depth), "{name}");
            assert_eq!(layout.chroma_subsampling, Some(chroma), "{name}");
            assert_eq!(layout.has_alpha, alpha, "{name}");
        }
        assert!(pixel_layout(-1).is_none());
        assert!(pixel_layout(ff::AVPixelFormat::AV_PIX_FMT_NB as c_int).is_none());
    }

    #[test]
    fn chroma_rules() {
        assert_eq!(chroma_subsampling(1, 1, 3, false, false), Some("4:2:0"));
        assert_eq!(chroma_subsampling(1, 0, 4, false, true), Some("4:2:2"));
        assert_eq!(chroma_subsampling(0, 0, 4, true, true), Some("4:4:4"));
        assert_eq!(chroma_subsampling(0, 0, 2, false, true), Some("4:0:0"));
        assert_eq!(chroma_subsampling(3, 3, 3, false, false), None);
    }

    #[test]
    fn rational_and_timestamp_rules() {
        let ntsc = ff::AVRational { num: 60000, den: 1001 };
        assert!((rational_to_f64(ntsc).unwrap() - 59.94).abs() < 0.001);
        assert_eq!(rational_value(ff::AVRational { num: 0, den: 1 }), Value::Null);
        assert_eq!(preferred_frame_rate(ff::AVRational { num: 0, den: 0 }, ff::AVRational { num: 30, den: 1 }), Some(30.0));
        assert_eq!(timestamp_seconds(ff::AV_NOPTS_VALUE, ntsc), None);
        assert_eq!(timestamp_seconds(1_500_000, ff::AVRational { num: 1, den: 1_000_000 }), Some(1.5));
        assert_eq!(timestamp_seconds(10, ff::AVRational { num: 1, den: 0 }), None);
    }

    #[test]
    fn hdr_and_fourcc_rules() {
        assert!(is_hdr_transfer(Some("smpte2084")));
        assert!(is_hdr_transfer(Some("arib-std-b67")));
        assert!(!is_hdr_transfer(Some("bt709")));
        assert!(!is_hdr_transfer(None));
        assert_eq!(fourcc(u32::from_le_bytes(*b"apch")).as_deref(), Some("apch"));
        assert_eq!(fourcc(0), None);
        assert_eq!(fourcc(0x0000_001b).as_deref(), Some("0x0000001b"));
    }

    #[test]
    fn rejects_relative_and_missing_paths() {
        let flag = AtomicBool::new(false);
        assert_eq!(probe("relative.mp4", &flag).unwrap_err().code, "INVALID_REQUEST");
        let missing = std::env::temp_dir().join("henji-video-decoder-missing-样本.mp4");
        assert_eq!(probe(missing.to_str().unwrap(), &flag).unwrap_err().code, "OPEN_FAILED");
    }

    #[test]
    fn cancelled_flag_aborts_probe() {
        let flag = AtomicBool::new(true);
        let existing = std::env::current_exe().unwrap();
        assert_eq!(probe(existing.to_str().unwrap(), &flag).unwrap_err().code, "CANCELLED");
    }
}
