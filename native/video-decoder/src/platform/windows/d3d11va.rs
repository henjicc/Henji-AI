//! FFmpeg D3D11VA 硬件设备接入。
//!
//! ffmpeg-sys-next 8.1 的绑定不含 `libavutil/hwcontext_d3d11va.h`，这里按 FFmpeg 8.1 头文件手写同布局的
//! `#[repr(C)]` 结构（单元测试固定字段偏移；升级 FFmpeg 时必须对照新头文件复核）。
//!
//! 进程内只建一个 `AVHWDeviceContext`，包装服务自己的 D3D11 设备（与共享纹理池同一设备），
//! 锁回调用设备的 `ID3D11Multithread::Enter/Leave`（可重入，FFmpeg 要求），与 `GpuDevice::lock()` 是同一把锁。

use std::ffi::c_void;

use ffmpeg_sys_next as ff;
use windows::core::Interface;
use windows::Win32::Graphics::Direct3D11::ID3D11Multithread;

use super::device::GpuDevice;

/// `AVD3D11VADeviceContext`（FFmpeg 8.1）。
#[repr(C)]
pub struct AVD3D11VADeviceContext {
    pub device: *mut c_void,
    pub device_context: *mut c_void,
    pub video_device: *mut c_void,
    pub video_context: *mut c_void,
    pub lock: Option<unsafe extern "C" fn(*mut c_void)>,
    pub unlock: Option<unsafe extern "C" fn(*mut c_void)>,
    pub lock_ctx: *mut c_void,
    pub bind_flags: u32,
    pub misc_flags: u32,
}

/// `AVD3D11FrameDescriptor`（FFmpeg 8.1）。只读帧时按 data[0]/data[1] 取用，保留声明以固定布局。
#[allow(dead_code)]
#[repr(C)]
pub struct AVD3D11FrameDescriptor {
    pub texture: *mut c_void,
    pub index: isize,
}

/// `AVD3D11VAFramesContext`（FFmpeg 8.1）。帧池由 FFmpeg 创建，保留声明以固定布局。
#[allow(dead_code)]
#[repr(C)]
pub struct AVD3D11VAFramesContext {
    pub texture: *mut c_void,
    pub bind_flags: u32,
    pub misc_flags: u32,
    pub texture_infos: *mut AVD3D11FrameDescriptor,
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

/// 进程内共享的 FFmpeg 硬件设备引用。
pub struct HwDevice {
    reference: *mut ff::AVBufferRef,
}

// AVBufferRef 只做引用计数（av_buffer_ref 线程安全），设备本身经锁回调串行使用。
unsafe impl Send for HwDevice {}
unsafe impl Sync for HwDevice {}

impl HwDevice {
    /// 新的引用（交给解码器上下文持有，解码器释放时归还）。
    pub fn new_reference(&self) -> *mut ff::AVBufferRef {
        unsafe { ff::av_buffer_ref(self.reference) }
    }
}

/// 在服务设备上创建 FFmpeg 硬件设备上下文。`gpu` 必须在进程生命周期内存活（锁上下文指向其多线程接口）。
pub fn create(gpu: &GpuDevice) -> Result<HwDevice, String> {
    unsafe {
        let reference = ff::av_hwdevice_ctx_alloc(ff::AVHWDeviceType::AV_HWDEVICE_TYPE_D3D11VA);
        if reference.is_null() {
            return Err("无法分配 D3D11VA 硬件设备".into());
        }
        let device_context = (*reference).data as *mut ff::AVHWDeviceContext;
        let hw = (*device_context).hwctx as *mut AVD3D11VADeviceContext;
        // FFmpeg 释放设备上下文时会 Release device：交出一份额外引用。
        (*hw).device = gpu.device.clone().into_raw();
        (*hw).lock = Some(lock_device);
        (*hw).unlock = Some(unlock_device);
        (*hw).lock_ctx = gpu.multithread.as_raw();
        let result = ff::av_hwdevice_ctx_init(reference);
        if result < 0 {
            let mut reference = reference;
            ff::av_buffer_unref(&mut reference);
            return Err(format!("初始化 D3D11VA 硬件设备失败（{result}）"));
        }
        Ok(HwDevice { reference })
    }
}

/// 硬件帧所在的纹理与数组切片号（`AV_PIX_FMT_D3D11`：data[0] 为纹理，data[1] 为切片号）。
pub unsafe fn frame_texture(frame: *const ff::AVFrame) -> (*mut c_void, u32) {
    unsafe { ((*frame).data[0] as *mut c_void, (*frame).data[1] as usize as u32) }
}


#[cfg(test)]
mod tests {
    use super::*;
    use std::mem::{offset_of, size_of};

    /// 布局与 FFmpeg 8.1 `hwcontext_d3d11va.h`（x64）一致。
    #[test]
    fn layouts_match_ffmpeg_8_1() {
        assert_eq!(offset_of!(AVD3D11VADeviceContext, device), 0);
        assert_eq!(offset_of!(AVD3D11VADeviceContext, video_context), 24);
        assert_eq!(offset_of!(AVD3D11VADeviceContext, lock), 32);
        assert_eq!(offset_of!(AVD3D11VADeviceContext, unlock), 40);
        assert_eq!(offset_of!(AVD3D11VADeviceContext, lock_ctx), 48);
        assert_eq!(offset_of!(AVD3D11VADeviceContext, bind_flags), 56);
        assert_eq!(offset_of!(AVD3D11VADeviceContext, misc_flags), 60);
        assert_eq!(size_of::<AVD3D11VADeviceContext>(), 64);
        assert_eq!(size_of::<AVD3D11FrameDescriptor>(), 16);
        assert_eq!(offset_of!(AVD3D11VAFramesContext, bind_flags), 8);
        assert_eq!(offset_of!(AVD3D11VAFramesContext, texture_infos), 16);
        assert_eq!(size_of::<AVD3D11VAFramesContext>(), 24);
    }
}
