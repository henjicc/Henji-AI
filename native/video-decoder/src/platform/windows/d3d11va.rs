//! FFmpeg D3D11VA 硬件设备接入。
//!
//! `AVD3D11VADeviceContext` 等结构直接用 ffmpeg-sys-next 9.0 由 bindgen 按所链接 FFmpeg 的
//! `libavutil/hwcontext_d3d11va.h` 生成的声明（绑定内带编译期布局断言；8.1 绑定不含该头文件时
//! 曾在此手写同布局结构，1.4 起删除）。测试再用真实设备核对所链接 DLL 按同一布局读写字段。
//!
//! 进程内只建一个 `AVHWDeviceContext`，包装服务自己的 D3D11 设备（与共享纹理池同一设备），
//! 锁回调用设备的 `ID3D11Multithread::Enter/Leave`（可重入，FFmpeg 要求），与 `GpuDevice::lock()` 是同一把锁。

use std::ffi::c_void;

use ffmpeg_sys_next as ff;
use windows::core::Interface;
use windows::Win32::Graphics::Direct3D11::ID3D11Multithread;

use super::device::GpuDevice;

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
        let hw = (*device_context).hwctx as *mut ff::AVD3D11VADeviceContext;
        // FFmpeg 释放设备上下文时会 Release device：交出一份额外引用。
        (*hw).device = gpu.device.clone().into_raw() as *mut ff::ID3D11Device;
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
    use windows::Win32::Graphics::Direct3D11::{ID3D11VideoContext, ID3D11VideoDevice};

    /// 绑定按 FFmpeg 9.0 头文件生成的布局（x64）：与 8.1 手写声明相同，升级时由绑定自带断言把关。
    #[test]
    fn binding_layouts_match_ffmpeg_9_0_header() {
        assert_eq!(offset_of!(ff::AVD3D11VADeviceContext, video_context), 24);
        assert_eq!(offset_of!(ff::AVD3D11VADeviceContext, lock), 32);
        assert_eq!(offset_of!(ff::AVD3D11VADeviceContext, lock_ctx), 48);
        assert_eq!(offset_of!(ff::AVD3D11VADeviceContext, MiscFlags), 60);
        assert_eq!(size_of::<ff::AVD3D11VADeviceContext>(), 64);
        assert_eq!(size_of::<ff::AVD3D11FrameDescriptor>(), 16);
        assert_eq!(offset_of!(ff::AVD3D11VAFramesContext, texture_infos), 16);
    }

    /// 真实校验：在服务设备上让所链接的 FFmpeg DLL 初始化 D3D11VA 设备，读回它按头文件填入的字段，
    /// 与本进程从同一设备取得的接口逐一比对（布局或 ABI 不符时指针对不上）。无硬件适配器时跳过。
    #[test]
    fn linked_ffmpeg_fills_device_context_at_binding_offsets() {
        let gpu = match super::super::device::create_device() {
            Ok(gpu) => gpu,
            Err(error) => {
                eprintln!("跳过：没有可用的 D3D11 设备（{error}）");
                return;
            }
        };
        let hw_device = create(&gpu).expect("初始化 D3D11VA 硬件设备");
        unsafe {
            let device_context = (*hw_device.reference).data as *const ff::AVHWDeviceContext;
            assert_eq!((*device_context).type_, ff::AVHWDeviceType::AV_HWDEVICE_TYPE_D3D11VA);
            let hw = &*((*device_context).hwctx as *const ff::AVD3D11VADeviceContext);
            assert_eq!(hw.device as *mut c_void, gpu.device.as_raw());
            let immediate = gpu.device.GetImmediateContext().expect("立即上下文");
            assert_eq!(hw.device_context as *mut c_void, immediate.as_raw());
            let video_device = gpu.device.cast::<ID3D11VideoDevice>().expect("视频设备接口");
            assert_eq!(hw.video_device as *mut c_void, video_device.as_raw());
            let video_context = immediate.cast::<ID3D11VideoContext>().expect("视频上下文接口");
            assert_eq!(hw.video_context as *mut c_void, video_context.as_raw());
            assert_eq!(hw.lock_ctx, gpu.multithread.as_raw());
            assert!(hw.lock.is_some() && hw.unlock.is_some());
        }
    }
}
