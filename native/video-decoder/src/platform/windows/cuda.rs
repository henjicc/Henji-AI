//! FFmpeg NVDEC → 同适配器 D3D11 缓冲互操作。像素只在 GPU 复制，色彩转换复用现有 HLSL。
//! CUDA Driver ABI 来自 cuda.h / cudaD3D11.h；只动态加载系统驱动，不要求安装 CUDA Toolkit。

use std::ffi::{c_void, CStr};
use std::ptr;
use std::sync::OnceLock;

use ffmpeg_sys_next as ff;
use windows::core::Interface;
use windows::Win32::Graphics::Direct3D11::*;
use windows::Win32::Graphics::Dxgi::Common::*;

use super::device::GpuDevice;
use crate::platform::HardwareDevice;

type Handle = *mut c_void;
type Status = i32;

#[link(name = "kernel32")]
extern "system" {
    fn LoadLibraryExW(name: *const u16, file: Handle, flags: u32) -> Handle;
    fn GetProcAddress(module: Handle, name: *const u8) -> Handle;
}

#[repr(C)]
struct DeviceContext {
    context: Handle,
    stream: Handle,
    internal: Handle,
}

#[repr(C)]
#[derive(Default)]
struct Copy2d {
    src_x: usize, src_y: usize, src_type: u32, src_host: *const c_void,
    src_device: u64, src_array: Handle, src_pitch: usize,
    dst_x: usize, dst_y: usize, dst_type: u32, dst_host: Handle,
    dst_device: u64, dst_array: Handle, dst_pitch: usize,
    width: usize, height: usize,
}

struct Api {
    init: unsafe extern "system" fn(u32) -> Status,
    devices: unsafe extern "system" fn(*mut u32, *mut i32, u32, Handle, u32) -> Status,
    push: unsafe extern "system" fn(Handle) -> Status,
    pop: unsafe extern "system" fn(*mut Handle) -> Status,
    register: unsafe extern "system" fn(*mut Handle, Handle, u32) -> Status,
    unregister: unsafe extern "system" fn(Handle) -> Status,
    map: unsafe extern "system" fn(u32, *mut Handle, Handle) -> Status,
    unmap: unsafe extern "system" fn(u32, *mut Handle, Handle) -> Status,
    pointer: unsafe extern "system" fn(*mut u64, *mut usize, Handle) -> Status,
    copy: unsafe extern "system" fn(*const Copy2d, Handle) -> Status,
    sync: unsafe extern "system" fn(Handle) -> Status,
}

fn check(status: Status, operation: &str) -> Result<(), String> {
    if status == 0 { Ok(()) } else { Err(format!("CUDA {operation} 失败：{status}")) }
}

fn api() -> Result<&'static Api, String> {
    static API: OnceLock<Result<Api, String>> = OnceLock::new();
    API.get_or_init(|| unsafe {
        // 驱动模块与函数表同寿命，常驻进程；失败也只加载一次。
        let name: Vec<u16> = "nvcuda.dll\0".encode_utf16().collect();
        let module = LoadLibraryExW(name.as_ptr(), ptr::null_mut(), 0x800);
        if module.is_null() { return Err("系统未提供 NVIDIA CUDA 驱动".into()); }
        fn symbol(module: Handle, name: &CStr) -> Result<Handle, String> {
            let value = unsafe { GetProcAddress(module, name.as_ptr().cast()) };
            if value.is_null() { Err(format!("CUDA 驱动缺少 {name:?}")) } else { Ok(value) }
        }
        macro_rules! load { ($name:literal, $ty:ty) => { std::mem::transmute::<Handle, $ty>(symbol(module, $name)?) }; }
        Ok(Api {
            init: load!(c"cuInit", unsafe extern "system" fn(u32) -> Status),
            devices: load!(c"cuD3D11GetDevices", unsafe extern "system" fn(*mut u32, *mut i32, u32, Handle, u32) -> Status),
            push: load!(c"cuCtxPushCurrent_v2", unsafe extern "system" fn(Handle) -> Status),
            pop: load!(c"cuCtxPopCurrent_v2", unsafe extern "system" fn(*mut Handle) -> Status),
            register: load!(c"cuGraphicsD3D11RegisterResource", unsafe extern "system" fn(*mut Handle, Handle, u32) -> Status),
            unregister: load!(c"cuGraphicsUnregisterResource", unsafe extern "system" fn(Handle) -> Status),
            map: load!(c"cuGraphicsMapResources", unsafe extern "system" fn(u32, *mut Handle, Handle) -> Status),
            unmap: load!(c"cuGraphicsUnmapResources", unsafe extern "system" fn(u32, *mut Handle, Handle) -> Status),
            pointer: load!(c"cuGraphicsResourceGetMappedPointer_v2", unsafe extern "system" fn(*mut u64, *mut usize, Handle) -> Status),
            copy: load!(c"cuMemcpy2DAsync_v2", unsafe extern "system" fn(*const Copy2d, Handle) -> Status),
            sync: load!(c"cuStreamSynchronize", unsafe extern "system" fn(Handle) -> Status),
        })
    }).as_ref().map_err(Clone::clone)
}

struct Current<'a>(&'a Api);
impl<'a> Current<'a> {
    fn enter(api: &'a Api, context: Handle) -> Result<Self, String> {
        check(unsafe { (api.push)(context) }, "push context")?;
        Ok(Self(api))
    }
}
impl Drop for Current<'_> {
    fn drop(&mut self) {
        let mut previous = ptr::null_mut();
        let status = unsafe { (self.0.pop)(&mut previous) };
        log_cleanup(status, "pop context");
    }
}

fn log_cleanup(status: Status, operation: &str) {
    if status != 0 {
        crate::logging::warn("cuda.release_failed", "CUDA 资源释放失败", serde_json::json!({ "operation": operation, "status": status }));
    }
}

pub fn create_device(gpu: &GpuDevice) -> Result<HardwareDevice, String> {
    let api = api()?;
    check(unsafe { (api.init)(0) }, "init")?;
    let mut count = 0;
    let mut device = 0;
    // 使用当前 D3D11 设备关联的 CUDA ordinal，禁止默认取 GPU 0 导致跨卡复制。
    check(unsafe { (api.devices)(&mut count, &mut device, 1, gpu.device.as_raw(), 2) }, "D3D11 device")?;
    if count != 1 { return Err(format!("D3D11 设备对应 {count} 个 CUDA 设备")); }
    let device_name = std::ffi::CString::new(device.to_string()).map_err(|error| error.to_string())?;
    let mut reference = ptr::null_mut();
    let status = unsafe { ff::av_hwdevice_ctx_create(&mut reference, ff::AVHWDeviceType::AV_HWDEVICE_TYPE_CUDA, device_name.as_ptr(), ptr::null_mut(), 0) };
    if status < 0 { return Err(format!("创建 NVDEC 设备失败：{}", crate::probe::error_text(status))); }
    Ok(HardwareDevice { device_type: ff::AVHWDeviceType::AV_HWDEVICE_TYPE_CUDA, reference })
}

/// 注册一次、逐帧 map/unmap；持有 FFmpeg 设备引用，保证释放注册资源时上下文仍在。
pub struct Buffer {
    api: &'static Api,
    device: *mut ff::AVBufferRef,
    context: Handle,
    stream: Handle,
    resource: Handle,
    _buffer: ID3D11Buffer,
    pub view: ID3D11ShaderResourceView,
    bytes: usize,
}

impl Buffer {
    /// # Safety
    /// `frame` 必须是有效的 CUDA yuv444p 帧。
    pub unsafe fn new(gpu: &GpuDevice, frame: *const ff::AVFrame, bytes: usize) -> Result<Self, String> {
        let api = api()?;
        let frames = unsafe { &*((*(*frame).hw_frames_ctx).data as *const ff::AVHWFramesContext) };
        let device_context = unsafe { &*((*frames.device_ctx).hwctx as *const DeviceContext) };
        let _current = Current::enter(api, device_context.context)?;
        let desc = D3D11_BUFFER_DESC { ByteWidth: u32::try_from(bytes).map_err(|_| "CUDA 缓冲超过 D3D11 大小范围")?, Usage: D3D11_USAGE_DEFAULT,
            BindFlags: D3D11_BIND_SHADER_RESOURCE.0 as u32, MiscFlags: D3D11_RESOURCE_MISC_BUFFER_ALLOW_RAW_VIEWS.0 as u32, ..Default::default() };
        let mut buffer = None;
        unsafe { gpu.device.CreateBuffer(&desc, None, Some(&mut buffer)) }.map_err(|e| format!("创建 CUDA 互操作缓冲失败：{e}"))?;
        let buffer = buffer.ok_or("CreateBuffer 未返回 CUDA 缓冲")?;
        let desc = D3D11_SHADER_RESOURCE_VIEW_DESC { Format: DXGI_FORMAT_R32_TYPELESS,
            ViewDimension: windows::Win32::Graphics::Direct3D::D3D11_SRV_DIMENSION_BUFFEREX,
            Anonymous: D3D11_SHADER_RESOURCE_VIEW_DESC_0 { BufferEx: D3D11_BUFFEREX_SRV { FirstElement: 0, NumElements: (bytes / 4) as u32, Flags: D3D11_BUFFEREX_SRV_FLAG_RAW.0 as u32 } } };
        let mut view = None;
        unsafe { gpu.device.CreateShaderResourceView(&buffer, Some(&desc), Some(&mut view)) }.map_err(|e| format!("创建 CUDA 缓冲视图失败：{e}"))?;
        let view = view.ok_or("CreateShaderResourceView 未返回 CUDA 视图")?;
        let mut resource = ptr::null_mut();
        check(unsafe { (api.register)(&mut resource, buffer.as_raw(), 0) }, "register D3D11 buffer")?;
        let device = unsafe { ff::av_buffer_ref(frames.device_ref) };
        if device.is_null() {
            log_cleanup(unsafe { (api.unregister)(resource) }, "unregister");
            return Err("无法保留 CUDA 设备引用".into());
        }
        Ok(Self { api, device, context: device_context.context, stream: device_context.stream, resource, _buffer: buffer, view, bytes })
    }

    /// # Safety
    /// 帧的平面、行距须有效；copies 由同一帧的 planar_layout 产生，不能在 CPU 解引用源指针。
    pub unsafe fn copy(&mut self, frame: *const ff::AVFrame, copies: &[super::convert::PlaneCopy], bytes: usize) -> Result<(), String> {
        let frames = unsafe { &*((*(*frame).hw_frames_ctx).data as *const ff::AVHWFramesContext) };
        let device_context = unsafe { &*((*frames.device_ctx).hwctx as *const DeviceContext) };
        if self.context != device_context.context || bytes != self.bytes { return Err("CUDA 帧设备或平面布局发生变化".into()); }
        let _current = Current::enter(self.api, self.context)?;
        check(unsafe { (self.api.map)(1, &mut self.resource, self.stream) }, "map")?;
        let result = (|| {
            let mut destination = 0;
            let mut capacity = 0;
            check(unsafe { (self.api.pointer)(&mut destination, &mut capacity, self.resource) }, "mapped pointer")?;
            if capacity < bytes { return Err("CUDA 映射缓冲不足".into()); }
            for (plane, copy) in copies.iter().enumerate() {
                let pitch = unsafe { (*frame).linesize[plane] as usize };
                let descriptor = Copy2d { src_type: 2, src_device: copy.source as u64, src_pitch: pitch,
                    dst_type: 2, dst_device: destination + copy.offset as u64, dst_pitch: pitch,
                    width: unsafe { (*frame).width as usize }, height: unsafe { (*frame).height as usize }, ..Default::default() };
                check(unsafe { (self.api.copy)(&descriptor, self.stream) }, "copy plane")?;
            }
            Ok(())
        })();
        // 即使复制失败也归还 D3D11 所有权；同步完成前 FFmpeg 帧不能释放或复用。
        let unmap = check(unsafe { (self.api.unmap)(1, &mut self.resource, self.stream) }, "unmap");
        let sync = check(unsafe { (self.api.sync)(self.stream) }, "synchronize");
        result.and(unmap).and(sync)
    }
}

impl Drop for Buffer {
    fn drop(&mut self) {
        if let Ok(_current) = Current::enter(self.api, self.context) {
            log_cleanup(unsafe { (self.api.unregister)(self.resource) }, "unregister");
        }
        unsafe { ff::av_buffer_unref(&mut self.device) };
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn driver_abi_matches_cuda_x64_headers() {
        use std::mem::{offset_of, size_of};
        assert_eq!(size_of::<Copy2d>(), 128);
        assert_eq!(offset_of!(Copy2d, src_device), 32);
        assert_eq!(offset_of!(Copy2d, dst_device), 88);
        assert_eq!(offset_of!(Copy2d, width), 112);
        assert_eq!(size_of::<DeviceContext>(), 24);
        assert_eq!(offset_of!(DeviceContext, stream), 8);
    }
}
