//! 解码器：选择 FFmpeg 解码器、硬件解码协商（`get_format`，设备类型由平台层给出，Windows 为 D3D11VA）、
//! 线程配置、送包与取帧。本模块只用 FFmpeg 通用的硬件帧接口，不接触具体图形 API。

use std::ffi::{c_int, CString};
use std::ptr;

use ffmpeg_sys_next as ff;

use crate::probe::error_text;
use crate::protocol::ServiceError;

/// Windows 下 FFmpeg（mingw 构建）的 EAGAIN。
const EAGAIN: c_int = 11;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Purpose {
    /// 连续计划（播放）：帧级 + 片级多线程。
    Playback,
    /// 按时间取单帧（定位/拖动/导出）：帧内编码用片级多线程避免帧线程的输出延迟。
    Seek,
}

/// 拥有所有权的帧。
pub struct Frame(pub *mut ff::AVFrame);

unsafe impl Send for Frame {}

impl Frame {
    /// 帧时间（刻度）：pts，缺失时 best_effort_timestamp。
    pub fn timestamp(&self) -> Option<i64> {
        let frame = unsafe { &*self.0 };
        [frame.pts, frame.best_effort_timestamp].into_iter().find(|value| *value != ff::AV_NOPTS_VALUE)
    }

    pub fn has_own_pts(&self) -> bool {
        unsafe { (*self.0).pts != ff::AV_NOPTS_VALUE }
    }

    pub fn duration(&self) -> i64 {
        unsafe { (*self.0).duration }
    }

    pub fn is_corrupt(&self) -> bool {
        unsafe { (*self.0).flags & ff::AV_FRAME_FLAG_CORRUPT != 0 }
    }

    pub fn is_hardware(&self) -> bool {
        unsafe { !(*self.0).hw_frames_ctx.is_null() }
    }

    pub fn format(&self) -> ff::AVPixelFormat {
        crate::convert::pixel_format(unsafe { (*self.0).format }).unwrap_or(ff::AVPixelFormat::AV_PIX_FMT_NONE)
    }

    /// 硬件帧的软件格式；软解帧为 None。
    pub fn hardware_sw_format(&self) -> Option<ff::AVPixelFormat> {
        if !self.is_hardware() {
            return None;
        }
        unsafe { frame_sw_format(self.0) }
    }

    /// 帧上实际承载内容的像素格式（硬件帧取软件格式）。
    pub fn content_format(&self) -> ff::AVPixelFormat {
        self.hardware_sw_format().unwrap_or_else(|| self.format())
    }

    pub fn premultiplied(&self) -> bool {
        unsafe { (*self.0).alpha_mode == ff::AVAlphaMode::AVALPHA_MODE_PREMULTIPLIED }
    }

    pub fn size(&self) -> (u32, u32) {
        unsafe { ((*self.0).width as u32, (*self.0).height as u32) }
    }
}

impl Drop for Frame {
    fn drop(&mut self) {
        unsafe { ff::av_frame_free(&mut self.0) };
    }
}

/// 硬件帧的软件像素格式（来自 FFmpeg 帧池上下文，与图形 API 无关）。
///
/// # Safety
/// `frame` 必须是有效帧。
pub unsafe fn frame_sw_format(frame: *const ff::AVFrame) -> Option<ff::AVPixelFormat> {
    unsafe {
        let frames = (*frame).hw_frames_ctx;
        if frames.is_null() {
            return None;
        }
        Some((*((*frames).data as *const ff::AVHWFramesContext)).sw_format)
    }
}

pub enum Received {
    Frame(Frame),
    /// 需要更多输入。
    Again,
    /// 已排空。
    Eof,
}

pub struct Decoder {
    context: *mut ff::AVCodecContext,
    pub name: String,
    pub hardware_requested: bool,
    pub intra_only: bool,
    /// 帧内编码且不用帧级多线程：每送一个包就出一帧，没有输出延迟（取帧时可用下一个包的时间判定候选帧）。
    pub immediate_output: bool,
}

unsafe impl Send for Decoder {}

impl Drop for Decoder {
    fn drop(&mut self) {
        unsafe { ff::avcodec_free_context(&mut self.context) };
    }
}

/// 硬件格式优先（打开时把平台设备对应的硬件像素格式记在 `opaque`）；硬件初始化失败时 FFmpeg 会去掉该格式
/// 再问一次，这时返回第一个软件格式。
unsafe extern "C" fn get_format(context: *mut ff::AVCodecContext, formats: *const ff::AVPixelFormat) -> ff::AVPixelFormat {
    let mut software = ff::AVPixelFormat::AV_PIX_FMT_NONE;
    let mut cursor = formats;
    unsafe {
        let hardware = (*context).opaque as usize as c_int;
        while *cursor != ff::AVPixelFormat::AV_PIX_FMT_NONE {
            let format = *cursor;
            if !(*context).hw_device_ctx.is_null() && hardware > 0 && format as c_int == hardware {
                return format;
            }
            let descriptor = ff::av_pix_fmt_desc_get(format);
            if software == ff::AVPixelFormat::AV_PIX_FMT_NONE && !descriptor.is_null() && (*descriptor).flags & ff::AV_PIX_FMT_FLAG_HWACCEL as u64 == 0 {
                software = format;
            }
            cursor = cursor.add(1);
        }
    }
    software
}

fn find_decoder(name: &str) -> *const ff::AVCodec {
    let name = CString::new(name).expect("解码器名不含空字符");
    unsafe { ff::avcodec_find_decoder_by_name(name.as_ptr()) }
}

/// 解码器对该硬件设备类型的硬件像素格式（不支持返回 None）。
fn hardware_pixel_format(codec: *const ff::AVCodec, device_type: ff::AVHWDeviceType) -> Option<ff::AVPixelFormat> {
    let mut index = 0;
    loop {
        let config = unsafe { ff::avcodec_get_hw_config(codec, index) };
        if config.is_null() {
            return None;
        }
        let config = unsafe { &*config };
        if config.device_type == device_type && config.methods & ff::AV_CODEC_HW_CONFIG_METHOD_HW_DEVICE_CTX as c_int != 0 {
            return Some(config.pix_fmt);
        }
        index += 1;
    }
}

/// 选择解码器：AV1 有硬解配置时用 `av1`（只能硬解），否则 `libdav1d`；带透明的 VP9 用 `libvpx-vp9`（原生 vp9 解码器不解透明层）。
pub fn choose_decoder(codec_id: ff::AVCodecID, hardware_available: bool, has_alpha: bool, device_profiles: &dyn Fn(&str) -> bool) -> Option<&'static str> {
    use ff::AVCodecID::*;
    match codec_id {
        AV_CODEC_ID_AV1 => Some(if hardware_available && device_profiles("av1_profile0") { "av1" } else { "libdav1d" }),
        AV_CODEC_ID_VP9 if has_alpha => Some("libvpx-vp9"),
        AV_CODEC_ID_VP8 if has_alpha => Some("libvpx"),
        _ => None,
    }
}

pub struct DecoderSetup<'a> {
    pub parameters: &'a ff::AVCodecParameters,
    pub time_base: ff::AVRational,
    pub has_alpha: bool,
    pub purpose: Purpose,
    /// 平台硬件解码设备的新引用（不硬解时为 None）。
    pub hardware: Option<crate::platform::HardwareDevice>,
    pub device_profiles: &'a dyn Fn(&str) -> bool,
}

impl Decoder {
    pub fn open(setup: DecoderSetup<'_>) -> Result<Self, ServiceError> {
        let parameters = setup.parameters;
        let preferred = choose_decoder(parameters.codec_id, setup.hardware.is_some(), setup.has_alpha, setup.device_profiles);
        let mut codec = preferred.map(find_decoder).unwrap_or(ptr::null());
        if codec.is_null() {
            codec = unsafe { ff::avcodec_find_decoder(parameters.codec_id) };
        }
        if codec.is_null() {
            if let Some(mut hardware) = setup.hardware {
                unsafe { ff::av_buffer_unref(&mut hardware.reference) };
            }
            return Err(ServiceError::new("UNSUPPORTED_FORMAT", "没有该编码的解码器"));
        }
        let name = crate::ffmpeg_info::c_text(unsafe { (*codec).name }).unwrap_or_default();
        let descriptor = unsafe { ff::avcodec_descriptor_get(parameters.codec_id) };
        let intra_only = !descriptor.is_null() && unsafe { (*descriptor).props } & ff::AV_CODEC_PROP_INTRA_ONLY != 0;
        let mut context = unsafe { ff::avcodec_alloc_context3(codec) };
        if context.is_null() {
            return Err(ServiceError::new("INTERNAL", "无法分配解码器上下文"));
        }
        let fail = |context: &mut *mut ff::AVCodecContext, message: String| {
            unsafe { ff::avcodec_free_context(context) };
            ServiceError::new("DECODE_FAILED", message)
        };
        if unsafe { ff::avcodec_parameters_to_context(context, parameters) } < 0 {
            return Err(fail(&mut context, "无法设置解码参数".into()));
        }
        let hardware_requested = match setup.hardware {
            Some(mut device) => match hardware_pixel_format(codec, device.device_type) {
                Some(format) => {
                    unsafe {
                        (*context).hw_device_ctx = device.reference;
                        (*context).opaque = format as c_int as usize as *mut std::ffi::c_void;
                        (*context).get_format = Some(get_format);
                        // 解码表面复制后立即归还；多留几张给候选帧、前瞻帧与在途复制。
                        (*context).extra_hw_frames = 4;
                    }
                    true
                }
                None => {
                    unsafe { ff::av_buffer_unref(&mut device.reference) };
                    false
                }
            },
            None => false,
        };
        let cores = std::thread::available_parallelism().map(|count| count.get()).unwrap_or(4);
        unsafe {
            (*context).pkt_timebase = setup.time_base;
            // 不输出缺参考的损坏帧。
            (*context).flags &= !(ff::AV_CODEC_FLAG_OUTPUT_CORRUPT as c_int);
            (*context).thread_count = cores.min(12) as c_int;
            // 单帧取帧的帧内编码只用片级多线程：帧级多线程有输出延迟，取一帧要多解十几帧（不支持片级的解码器即单线程）。
            (*context).thread_type = match setup.purpose {
                Purpose::Seek if intra_only => ff::FF_THREAD_SLICE,
                _ => ff::FF_THREAD_FRAME | ff::FF_THREAD_SLICE,
            };
        }
        let opened = unsafe { ff::avcodec_open2(context, codec, ptr::null_mut()) };
        if opened < 0 {
            return Err(fail(&mut context, format!("无法打开解码器 {name}：{}", error_text(opened))));
        }
        let immediate_output = intra_only && setup.purpose == Purpose::Seek;
        Ok(Self { context, name, hardware_requested, intra_only, immediate_output })
    }

    /// 送入一个包（None 表示开始排空）。返回 false 表示解码器暂不接收（先取帧）。
    pub fn send(&mut self, packet: Option<&super::demux::Packet>) -> Result<bool, ServiceError> {
        let result = unsafe { ff::avcodec_send_packet(self.context, packet.map_or(ptr::null(), |packet| packet.0)) };
        if result == ff::AVERROR(EAGAIN) {
            return Ok(false);
        }
        if result == ff::AVERROR_EOF {
            return Ok(true);
        }
        if result < 0 {
            // 单个包损坏不终止会话：交给调用方计数。
            return Err(ServiceError::new("DECODE_FAILED", format!("解码失败：{}", error_text(result))));
        }
        Ok(true)
    }

    pub fn receive(&mut self) -> Result<Received, ServiceError> {
        let frame = Frame(unsafe { ff::av_frame_alloc() });
        if frame.0.is_null() {
            return Err(ServiceError::new("INTERNAL", "无法分配帧"));
        }
        let result = unsafe { ff::avcodec_receive_frame(self.context, frame.0) };
        if result == ff::AVERROR(EAGAIN) {
            return Ok(Received::Again);
        }
        if result == ff::AVERROR_EOF {
            return Ok(Received::Eof);
        }
        if result < 0 {
            return Err(ServiceError::new("DECODE_FAILED", format!("解码失败：{}", error_text(result))));
        }
        Ok(Received::Frame(frame))
    }

    pub fn flush(&mut self) {
        unsafe { ff::avcodec_flush_buffers(self.context) };
    }

}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decoder_choice() {
        let profiles = |name: &str| name == "av1_profile0";
        let none = |_: &str| false;
        assert_eq!(choose_decoder(ff::AVCodecID::AV_CODEC_ID_AV1, true, false, &profiles), Some("av1"));
        assert_eq!(choose_decoder(ff::AVCodecID::AV_CODEC_ID_AV1, true, false, &none), Some("libdav1d"));
        assert_eq!(choose_decoder(ff::AVCodecID::AV_CODEC_ID_AV1, false, false, &profiles), Some("libdav1d"));
        assert_eq!(choose_decoder(ff::AVCodecID::AV_CODEC_ID_VP9, true, true, &profiles), Some("libvpx-vp9"));
        assert_eq!(choose_decoder(ff::AVCodecID::AV_CODEC_ID_VP9, true, false, &profiles), None);
        assert_eq!(choose_decoder(ff::AVCodecID::AV_CODEC_ID_PRORES, true, true, &profiles), None);
        for name in ["av1", "libdav1d", "libvpx-vp9", "libvpx"] {
            assert!(!find_decoder(name).is_null(), "{name} 应在 LGPL 构建中");
        }
    }
}
