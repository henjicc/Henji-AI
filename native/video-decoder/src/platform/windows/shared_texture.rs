//! 显卡共享纹理：按格式创建带 NT 句柄的 D3D11 纹理，并把句柄复制到客户端（Electron 主进程）。
//!
//! 句柄所有权：本服务为每张纹理创建一个本地 NT 句柄，`DuplicateHandle` 到客户端进程后立即关闭本地句柄；
//! 客户端进程里的句柄由本服务负责回收——流结束时用 `DUPLICATE_CLOSE_SOURCE` 远程关闭。
//! Electron `importSharedTexture` 每次导入会自行再复制一份并在释放时关闭，不接管我们复制过去的句柄。

use windows::core::{Interface, PCWSTR};
use windows::Win32::Foundation::{CloseHandle, DuplicateHandle, DUPLICATE_CLOSE_SOURCE, DUPLICATE_SAME_ACCESS, HANDLE};
use windows::Win32::Graphics::Direct3D11::*;
use windows::Win32::Graphics::Dxgi::Common::*;
use windows::Win32::Graphics::Dxgi::*;
use windows::Win32::Foundation::FILETIME;
use windows::Win32::System::Threading::{GetCurrentProcess, GetProcessHandleCount, GetProcessTimes, OpenProcess, PROCESS_DUP_HANDLE};

use crate::test_pattern::{Plane, SharedFormat};

pub fn dxgi_format(format: SharedFormat) -> DXGI_FORMAT {
    match format {
        SharedFormat::Nv12 => DXGI_FORMAT_NV12,
        // Chromium 的 NV16 共享图像对应 DXGI 的 P208（8 位 4:2:2，Y 平面 + 交错 UV 平面）。
        SharedFormat::Nv16 => DXGI_FORMAT_P208,
        SharedFormat::P010le => DXGI_FORMAT_P010,
        SharedFormat::Rgba => DXGI_FORMAT_R8G8B8A8_UNORM,
        SharedFormat::Bgra => DXGI_FORMAT_B8G8R8A8_UNORM,
        SharedFormat::Rgbaf16 => DXGI_FORMAT_R16G16B16A16_FLOAT,
    }
}

/// 客户端进程（复制句柄的目标）。
pub struct ClientProcess {
    handle: HANDLE,
    pub pid: u32,
}

// 进程句柄只用于 DuplicateHandle，跨线程使用是安全的。
unsafe impl Send for ClientProcess {}
unsafe impl Sync for ClientProcess {}

impl ClientProcess {
    pub fn open(pid: u32) -> Result<Self, String> {
        let handle = unsafe { OpenProcess(PROCESS_DUP_HANDLE, false, pid) }.map_err(|error| format!("打开客户端进程 {pid} 失败：{error}"))?;
        Ok(Self { handle, pid })
    }

    /// 把本地句柄复制到客户端进程，返回客户端进程中的句柄值。本地句柄由调用方关闭。
    pub fn duplicate_into(&self, local: HANDLE) -> Result<u64, String> {
        let mut remote = HANDLE::default();
        unsafe { DuplicateHandle(GetCurrentProcess(), local, self.handle, &mut remote, 0, false, DUPLICATE_SAME_ACCESS) }
            .map_err(|error| format!("复制纹理句柄到客户端进程失败：{error}"))?;
        Ok(remote.0 as usize as u64)
    }

    /// 关闭客户端进程中的句柄（DUPLICATE_CLOSE_SOURCE 不产生新句柄）。
    pub fn close_remote(&self, remote: u64) -> Result<(), String> {
        unsafe { DuplicateHandle(self.handle, HANDLE(remote as usize as *mut _), HANDLE::default(), std::ptr::null_mut(), 0, false, DUPLICATE_CLOSE_SOURCE) }
            .map_err(|error| format!("关闭客户端进程句柄 {remote} 失败：{error}"))
    }
}

impl Drop for ClientProcess {
    fn drop(&mut self) {
        let _ = unsafe { CloseHandle(self.handle) };
    }
}

pub struct SharedSlot {
    pub texture: ID3D11Texture2D,
    pub keyed_mutex: Option<IDXGIKeyedMutex>,
    /// 客户端进程中的句柄值。
    pub remote_handle: u64,
}

fn texture_desc(format: SharedFormat, width: u32, height: u32, usage: D3D11_USAGE, bind: u32, cpu: u32, misc: u32) -> D3D11_TEXTURE2D_DESC {
    D3D11_TEXTURE2D_DESC {
        Width: width,
        Height: height,
        MipLevels: 1,
        ArraySize: 1,
        Format: dxgi_format(format),
        SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
        Usage: usage,
        BindFlags: bind,
        CPUAccessFlags: cpu,
        MiscFlags: misc,
    }
}

fn shader_bind(format: SharedFormat) -> u32 {
    if format.is_yuv() {
        D3D11_BIND_SHADER_RESOURCE.0 as u32
    } else {
        (D3D11_BIND_SHADER_RESOURCE.0 | D3D11_BIND_RENDER_TARGET.0) as u32
    }
}

/// 创建纹理；带绑定标志失败时（部分平面格式不支持着色器资源）退回无绑定。
fn create_texture(device: &ID3D11Device, format: SharedFormat, width: u32, height: u32, usage: D3D11_USAGE, bind: u32, cpu: u32, misc: u32) -> Result<ID3D11Texture2D, String> {
    let mut texture = None;
    let first = unsafe { device.CreateTexture2D(&texture_desc(format, width, height, usage, bind, cpu, misc), None, Some(&mut texture)) };
    if first.is_err() && bind != 0 {
        texture = None;
        unsafe { device.CreateTexture2D(&texture_desc(format, width, height, usage, 0, cpu, misc), None, Some(&mut texture)) }
            .map_err(|error| format!("创建 {} {width}x{height} 纹理失败：{error}（首次尝试：{}）", format.name(), first.unwrap_err()))?;
    } else {
        first.map_err(|error| format!("创建 {} {width}x{height} 纹理失败：{error}", format.name()))?;
    }
    texture.ok_or_else(|| "CreateTexture2D 未返回纹理".to_string())
}

/// 创建一个共享纹理池：每张纹理一个 NT 句柄，已复制到客户端进程。
pub fn create_pool(device: &ID3D11Device, client: &ClientProcess, format: SharedFormat, width: u32, height: u32, count: u32, keyed_mutex: bool) -> Result<Vec<SharedSlot>, String> {
    let misc = (D3D11_RESOURCE_MISC_SHARED_NTHANDLE.0 | if keyed_mutex { D3D11_RESOURCE_MISC_SHARED_KEYEDMUTEX.0 } else { D3D11_RESOURCE_MISC_SHARED.0 }) as u32;
    let mut slots: Vec<SharedSlot> = Vec::with_capacity(count as usize);
    let result = (|| {
        for _ in 0..count {
            let texture = create_texture(device, format, width, height, D3D11_USAGE_DEFAULT, shader_bind(format), 0, misc)?;
            let resource: IDXGIResource1 = texture.cast().map_err(|error| format!("纹理不支持 IDXGIResource1：{error}"))?;
            let local = unsafe { resource.CreateSharedHandle(None, DXGI_SHARED_RESOURCE_READ.0 | DXGI_SHARED_RESOURCE_WRITE.0, PCWSTR::null()) }
                .map_err(|error| format!("创建共享句柄失败：{error}"))?;
            let remote = client.duplicate_into(local);
            let _ = unsafe { CloseHandle(local) };
            let keyed_mutex = if keyed_mutex { Some(texture.cast::<IDXGIKeyedMutex>().map_err(|error| format!("纹理缺少键控互斥体：{error}"))?) } else { None };
            slots.push(SharedSlot { texture, keyed_mutex, remote_handle: remote? });
        }
        Ok::<(), String>(())
    })();
    if let Err(error) = result {
        release_pool(client, &slots);
        return Err(error);
    }
    Ok(slots)
}

/// 远程关闭池中全部句柄；纹理本身随 COM 引用释放（Chromium 仍持有的导入在其释放后才真正销毁）。
pub fn release_pool(client: &ClientProcess, slots: &[SharedSlot]) -> Vec<String> {
    slots.iter().filter_map(|slot| client.close_remote(slot.remote_handle).err()).collect()
}

/// 把 CPU 平面数据上传为显存中的普通纹理（经 STAGING 中转），作为每帧复制的来源。
pub fn upload(device: &ID3D11Device, context: &ID3D11DeviceContext, format: SharedFormat, width: u32, height: u32, planes: &[Plane]) -> Result<ID3D11Texture2D, String> {
    let staging = create_texture(device, format, width, height, D3D11_USAGE_STAGING, 0, D3D11_CPU_ACCESS_WRITE.0 as u32, 0)?;
    let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
    unsafe { context.Map(&staging, 0, D3D11_MAP_WRITE, 0, Some(&mut mapped)) }.map_err(|error| format!("映射 {} 中转纹理失败：{error}", format.name()))?;
    let pitch = mapped.RowPitch as usize;
    let base = mapped.pData as *mut u8;
    // 平面格式：第二个平面紧跟在第一个平面（height 行）之后，行距相同。
    let mut plane_offset = 0usize;
    for plane in planes {
        if plane.row_bytes > pitch {
            unsafe { context.Unmap(&staging, 0) };
            return Err(format!("{} 行距 {pitch} 小于平面行宽 {}", format.name(), plane.row_bytes));
        }
        for row in 0..plane.rows {
            unsafe {
                std::ptr::copy_nonoverlapping(plane.bytes.as_ptr().add(row * plane.row_bytes), base.add(plane_offset + row * pitch), plane.row_bytes);
            }
        }
        plane_offset += pitch * height as usize;
    }
    unsafe { context.Unmap(&staging, 0) };
    let texture = create_texture(device, format, width, height, D3D11_USAGE_DEFAULT, shader_bind(format), 0, 0)?;
    unsafe { context.CopyResource(&texture, &staging) };
    Ok(texture)
}

/// 本进程累计 CPU 时间（毫秒，内核 + 用户）与句柄数，用于资源回收验收。
pub fn process_usage() -> (f64, u32) {
    let (mut creation, mut exit, mut kernel, mut user) = (FILETIME::default(), FILETIME::default(), FILETIME::default(), FILETIME::default());
    let mut handles = 0u32;
    unsafe {
        let _ = GetProcessTimes(GetCurrentProcess(), &mut creation, &mut exit, &mut kernel, &mut user);
        let _ = GetProcessHandleCount(GetCurrentProcess(), &mut handles);
    }
    let ticks = |time: FILETIME| ((time.dwHighDateTime as u64) << 32 | time.dwLowDateTime as u64) as f64;
    ((ticks(kernel) + ticks(user)) / 10_000.0, handles)
}
