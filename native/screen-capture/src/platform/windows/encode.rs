//! 硬件编码：显卡里的 NV12 纹理经 FFmpeg 的 D3D11 硬件帧直接进编码器，不经系统内存。
//!
//! 编码器选择是一张表（`ENCODERS`），第一版只有 NVIDIA；加 AMD、Intel 时在表里加一行并补上各自的选项。
//! 帧池由 FFmpeg 的 D3D11 硬件帧上下文管理（按需分配独立纹理、循环使用）：采集回调取一张、画进去、交给会话线程，
//! 编码完放下就回池，稳定后不再分配。

use super::{device::Gpu, mux::Mux};
use crate::core::{
    health::Health,
    protocol::{CaptureConfig, Codec, RateControl},
};
use crate::platform::FrameWriter;
use ffmpeg_sys_next as ff;
use std::{
    ffi::{c_void, CStr},
    path::Path,
    ptr,
    sync::Arc,
};
use windows::core::Interface;
use windows::Win32::Graphics::Direct3D11::{ID3D11Multithread, ID3D11Texture2D, D3D11_BIND_RENDER_TARGET};

pub fn av_error(code: i32) -> String {
    let mut buffer = [0i8; 256];
    unsafe {
        ff::av_strerror(code, buffer.as_mut_ptr(), buffer.len());
        CStr::from_ptr(buffer.as_ptr()).to_string_lossy().into_owned()
    }
}

unsafe extern "C" fn lock_device(context: *mut c_void) {
    if let Some(multithread) = unsafe { ID3D11Multithread::from_raw_borrowed(&context) } {
        unsafe { multithread.Enter() };
    }
}

unsafe extern "C" fn unlock_device(context: *mut c_void) {
    if let Some(multithread) = unsafe { ID3D11Multithread::from_raw_borrowed(&context) } {
        unsafe { multithread.Leave() };
    }
}

/// FFmpeg 侧的硬件设备与 NV12 帧池，包着我们自己的 D3D11 设备。
pub struct HwContext {
    device: *mut ff::AVBufferRef,
    frames: *mut ff::AVBufferRef,
    /// 锁回调里用到设备的多线程接口，设备必须活得比 FFmpeg 的引用久。
    _gpu: Arc<Gpu>,
}

// AVBufferRef 的引用计数与缓冲池都是线程安全的；设备经锁回调串行使用。
unsafe impl Send for HwContext {}
unsafe impl Sync for HwContext {}

impl HwContext {
    pub fn new(gpu: Arc<Gpu>, width: u32, height: u32) -> Result<Self, String> {
        unsafe {
            let mut device = ff::av_hwdevice_ctx_alloc(ff::AVHWDeviceType::AV_HWDEVICE_TYPE_D3D11VA);
            if device.is_null() {
                return Err("CAPTURE_FAILED|无法分配硬件设备".into());
            }
            let device_context = (*device).data as *mut ff::AVHWDeviceContext;
            let hw = (*device_context).hwctx as *mut ff::AVD3D11VADeviceContext;
            // FFmpeg 释放设备上下文时会 Release：交出一份额外引用。
            (*hw).device = gpu.device.clone().into_raw() as *mut ff::ID3D11Device;
            (*hw).lock = Some(lock_device);
            (*hw).unlock = Some(unlock_device);
            (*hw).lock_ctx = gpu.multithread.as_raw();
            let result = ff::av_hwdevice_ctx_init(device);
            if result < 0 {
                ff::av_buffer_unref(&mut device);
                return Err(format!("CAPTURE_FAILED|初始化硬件设备失败：{}", av_error(result)));
            }
            let mut frames = ff::av_hwframe_ctx_alloc(device);
            if frames.is_null() {
                ff::av_buffer_unref(&mut device);
                return Err("CAPTURE_FAILED|无法分配硬件帧池".into());
            }
            let frames_context = (*frames).data as *mut ff::AVHWFramesContext;
            (*frames_context).format = ff::AVPixelFormat::AV_PIX_FMT_D3D11;
            (*frames_context).sw_format = ff::AVPixelFormat::AV_PIX_FMT_NV12;
            (*frames_context).width = width as i32;
            (*frames_context).height = height as i32;
            // 不预分配纹理数组：每帧一张独立纹理，才能给两个平面各建渲染目标视图。
            (*frames_context).initial_pool_size = 0;
            let frames_hw = (*frames_context).hwctx as *mut ff::AVD3D11VAFramesContext;
            (*frames_hw).BindFlags = D3D11_BIND_RENDER_TARGET.0 as u32;
            let result = ff::av_hwframe_ctx_init(frames);
            if result < 0 {
                ff::av_buffer_unref(&mut frames);
                ff::av_buffer_unref(&mut device);
                return Err(format!("CAPTURE_FAILED|初始化硬件帧池失败：{}", av_error(result)));
            }
            Ok(Self { device, frames, _gpu: gpu })
        }
    }

    /// 从池里取一张 NV12 纹理帧。
    pub fn frame(&self) -> Result<HwFrame, String> {
        unsafe {
            let mut frame = ff::av_frame_alloc();
            if frame.is_null() {
                return Err("CAPTURE_FAILED|内存不足".into());
            }
            let result = ff::av_hwframe_get_buffer(self.frames, frame, 0);
            if result < 0 {
                ff::av_frame_free(&mut frame);
                return Err(format!("CAPTURE_FAILED|取硬件帧失败：{}", av_error(result)));
            }
            Ok(HwFrame(frame))
        }
    }
}

impl Drop for HwContext {
    fn drop(&mut self) {
        unsafe {
            ff::av_buffer_unref(&mut self.frames);
            ff::av_buffer_unref(&mut self.device);
        }
    }
}

/// 一张在显卡里的 NV12 帧（`AV_PIX_FMT_D3D11`）；放下即回池。
pub struct HwFrame(*mut ff::AVFrame);

unsafe impl Send for HwFrame {}

impl HwFrame {
    /// 帧所在的纹理（独立纹理，切片号恒为 0）。借用，不增加引用。
    pub fn with_texture<R>(&self, use_texture: impl FnOnce(&ID3D11Texture2D) -> R) -> R {
        let raw = unsafe { (*self.0).data[0] as *mut c_void };
        use_texture(unsafe { ID3D11Texture2D::from_raw_borrowed(&raw) }.expect("硬件帧必有纹理"))
    }
}

impl Drop for HwFrame {
    fn drop(&mut self) {
        unsafe { ff::av_frame_free(&mut self.0) };
    }
}

struct EncoderEntry {
    codec: Codec,
    name: &'static CStr,
    label: &'static str,
    configure: unsafe fn(*mut ff::AVCodecContext, &CaptureConfig, u64),
}

/// 按顺序尝试；第一版只有 NVIDIA。
const ENCODERS: &[EncoderEntry] = &[
    EncoderEntry { codec: Codec::H264, name: c"h264_nvenc", label: "h264_nvenc", configure: configure_nvenc },
    EncoderEntry { codec: Codec::Hevc, name: c"hevc_nvenc", label: "hevc_nvenc", configure: configure_nvenc },
];

unsafe fn set_option(context: *mut ff::AVCodecContext, name: &CStr, value: &CStr) {
    let result = unsafe { ff::av_opt_set((*context).priv_data, name.as_ptr(), value.as_ptr(), 0) };
    if result < 0 {
        eprintln!("[screen-capture] 编码器不认识选项 {}={}：{}", name.to_string_lossy(), value.to_string_lossy(), av_error(result));
    }
}

/// 与现有录法的 NVENC 档位一致（p4、低延迟、不用前瞻与场景切换），另外保证：
/// 送进去一帧立刻出一包（delay=0），强制的关键帧是 IDR（继续后的第一帧可以独立解码）。
unsafe fn configure_nvenc(context: *mut ff::AVCodecContext, config: &CaptureConfig, bitrate: u64) {
    unsafe {
        set_option(context, c"preset", c"p4");
        set_option(context, c"tune", c"ll");
        set_option(context, c"rc-lookahead", c"0");
        set_option(context, c"no-scenecut", c"1");
        set_option(context, c"forced-idr", c"1");
        set_option(context, c"delay", c"0");
        set_option(context, c"profile", if config.codec == Codec::H264 { c"high" } else { c"main" });
        match config.rate_control {
            RateControl::Quality => {
                set_option(context, c"rc", c"vbr");
                set_option(context, c"cq", c"26");
                (*context).bit_rate = 0;
                (*context).rc_max_rate = (bitrate * 3 / 2) as i64;
            }
            RateControl::Vbr => {
                set_option(context, c"rc", c"vbr");
                (*context).bit_rate = bitrate as i64;
                (*context).rc_max_rate = (bitrate * 3 / 2) as i64;
            }
            RateControl::Cbr => {
                set_option(context, c"rc", c"cbr");
                (*context).bit_rate = bitrate as i64;
                (*context).rc_max_rate = bitrate as i64;
                (*context).rc_min_rate = bitrate as i64;
            }
        }
        (*context).rc_buffer_size = (bitrate * 2).min(i32::MAX as u64) as i32;
    }
}

pub struct Encoder {
    context: *mut ff::AVCodecContext,
    scratch: *mut ff::AVFrame,
    packet: *mut ff::AVPacket,
    mux: Mux,
    finished: bool,
    pub label: &'static str,
    _hw: Arc<HwContext>,
}

unsafe impl Send for Encoder {}

impl Encoder {
    pub fn open(hw: Arc<HwContext>, config: &CaptureConfig, width: u32, height: u32, video_path: &Path, health: Arc<Health>) -> Result<Self, String> {
        let bitrate = config.target_bitrate(width, height);
        let mut last_error = String::from("没有可用的硬件编码器");
        for entry in ENCODERS.iter().filter(|entry| entry.codec == config.codec) {
            unsafe {
                let codec = ff::avcodec_find_encoder_by_name(entry.name.as_ptr());
                if codec.is_null() {
                    last_error = format!("随包的 FFmpeg 不含 {}", entry.label);
                    continue;
                }
                let mut context = ff::avcodec_alloc_context3(codec);
                (*context).width = width as i32;
                (*context).height = height as i32;
                (*context).time_base = ff::AVRational { num: 1, den: config.fps as i32 };
                (*context).framerate = ff::AVRational { num: config.fps as i32, den: 1 };
                (*context).pix_fmt = ff::AVPixelFormat::AV_PIX_FMT_D3D11;
                (*context).sw_pix_fmt = ff::AVPixelFormat::AV_PIX_FMT_NV12;
                (*context).hw_frames_ctx = ff::av_buffer_ref(hw.frames);
                (*context).gop_size = config.keyframe_interval() as i32;
                // 不用 B 帧：每帧按到达顺序出包，分片边界与实时性都简单。
                (*context).max_b_frames = 0;
                (*context).color_range = ff::AVColorRange::AVCOL_RANGE_MPEG;
                (*context).colorspace = ff::AVColorSpace::AVCOL_SPC_BT709;
                (*context).color_primaries = ff::AVColorPrimaries::AVCOL_PRI_BT709;
                (*context).color_trc = ff::AVColorTransferCharacteristic::AVCOL_TRC_BT709;
                // MP4 把参数集放在文件头里。
                (*context).flags |= ff::AV_CODEC_FLAG_GLOBAL_HEADER as i32;
                if config.codec == Codec::Hevc {
                    // 播放器（尤其苹果系）只认 hvc1 标签的 HEVC。
                    (*context).codec_tag = u32::from_le_bytes(*b"hvc1");
                }
                (entry.configure)(context, config, bitrate);
                let result = ff::avcodec_open2(context, codec, ptr::null_mut());
                if result < 0 {
                    last_error = format!("{} 打不开：{}", entry.label, av_error(result));
                    ff::avcodec_free_context(&mut context);
                    continue;
                }
                let mux = match Mux::spawn(video_path, context, health) {
                    Ok(mux) => mux,
                    Err(error) => {
                        ff::avcodec_free_context(&mut context);
                        return Err(error);
                    }
                };
                return Ok(Self { context, scratch: ff::av_frame_alloc(), packet: ff::av_packet_alloc(), mux, finished: false, label: entry.label, _hw: hw });
            }
        }
        Err(format!("ENCODER_UNSUPPORTED|此设备暂不支持新的录屏方式（{last_error}），请用现有录法"))
    }

    /// 取走编码器里现成的包交给写盘线程；返回这些包的总字节数。
    unsafe fn drain(&mut self) -> Result<u64, String> {
        let mut bytes = 0u64;
        loop {
            let result = unsafe { ff::avcodec_receive_packet(self.context, self.packet) };
            if result == ff::AVERROR(ff::EAGAIN) || result == ff::AVERROR_EOF {
                return Ok(bytes);
            }
            if result < 0 {
                return Err(format!("ENCODER_FAILED|编码失败，已录部分保留：{}", av_error(result)));
            }
            unsafe {
                let packet = ff::av_packet_alloc();
                ff::av_packet_move_ref(packet, self.packet);
                (*packet).duration = 1;
                bytes += (*packet).size.max(0) as u64;
                self.mux.write(packet)?;
            }
        }
    }
}

impl FrameWriter<HwFrame> for Encoder {
    fn write(&mut self, frame: &HwFrame, pts: i64, force_key: bool) -> Result<u64, String> {
        self.mux.check()?;
        unsafe {
            ff::av_frame_unref(self.scratch);
            let result = ff::av_frame_ref(self.scratch, frame.0);
            if result < 0 {
                return Err(format!("ENCODER_FAILED|{}", av_error(result)));
            }
            (*self.scratch).pts = pts;
            (*self.scratch).pict_type = if force_key { ff::AVPictureType::AV_PICTURE_TYPE_I } else { ff::AVPictureType::AV_PICTURE_TYPE_NONE };
            if force_key {
                (*self.scratch).flags |= ff::AV_FRAME_FLAG_KEY as i32;
            } else {
                (*self.scratch).flags &= !(ff::AV_FRAME_FLAG_KEY as i32);
            }
            let mut bytes = 0;
            loop {
                let result = ff::avcodec_send_frame(self.context, self.scratch);
                if result == ff::AVERROR(ff::EAGAIN) {
                    bytes += self.drain()?;
                    continue;
                }
                if result < 0 {
                    return Err(format!("ENCODER_FAILED|编码失败，已录部分保留：{}", av_error(result)));
                }
                break;
            }
            ff::av_frame_unref(self.scratch);
            Ok(bytes + self.drain()?)
        }
    }

    fn flush_fragment(&mut self) -> Result<(), String> {
        self.mux.flush()
    }

    fn finish(&mut self) -> Result<(), String> {
        if self.finished {
            return Ok(());
        }
        self.finished = true;
        let drained = unsafe {
            ff::avcodec_send_frame(self.context, ptr::null());
            self.drain()
        };
        drained.map(|_| ()).and(self.mux.finish())
    }
}

impl Drop for Encoder {
    fn drop(&mut self) {
        let _ = self.finish();
        unsafe {
            ff::av_frame_free(&mut self.scratch);
            ff::av_packet_free(&mut self.packet);
            ff::avcodec_free_context(&mut self.context);
        }
    }
}
