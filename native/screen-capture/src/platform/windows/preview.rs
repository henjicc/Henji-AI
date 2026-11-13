//! 预览：把缩小的画面画进几张带共享句柄的纹理，句柄复制到界面所在的进程，对方直接在显卡里用，不经编码也不经管道搬像素。
//!
//! 做法与视频解码服务给界面送帧相同（`native/video-decoder` 的共享纹理池）：每张纹理建一个 NT 句柄，
//! `DuplicateHandle` 到对方进程后关掉本地的；对方进程里的句柄由我们在停预览时远程关闭
//! （Electron 的 `importSharedTexture` 每次导入会自己再复制一份，不接管我们复制过去的）。
//! 不用键控互斥体：几张纹理轮着写，写完才通知；一张纹理要隔两次才会再被写，对方有足够时间读完。
//!
//! 预览在采集回调里顺带画（一次缩小的拷贝，远小于主画面的转换），按预览帧率抽帧；它出任何错只停预览。

use super::{convert::Converter, device::Gpu};
use crate::platform::Notify;
use serde_json::{json, Value};
use std::{ffi::c_void, ptr};
use windows::core::{Interface, PCWSTR};
use windows::Win32::Foundation::{CloseHandle, DuplicateHandle, DUPLICATE_CLOSE_SOURCE, DUPLICATE_SAME_ACCESS, HANDLE};
use windows::Win32::Graphics::Direct3D11::*;
use windows::Win32::Graphics::Dxgi::Common::{DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_SAMPLE_DESC};
use windows::Win32::Graphics::Dxgi::{IDXGIResource1, DXGI_SHARED_RESOURCE_READ};
use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcess, PROCESS_DUP_HANDLE};

const SLOTS: usize = 3;

struct Slot {
    _texture: ID3D11Texture2D,
    view: ID3D11RenderTargetView,
    /// 对方进程里的句柄值。
    remote: u64,
}

pub struct Preview {
    slots: Vec<Slot>,
    client: HANDLE,
    width: u32,
    height: u32,
    interval_us: i64,
    last_us: i64,
    next: usize,
    sequence: u64,
    notify: Notify,
}

// 只在采集回调里用（回调一次只跑一个）；进程句柄只用于复制句柄。
unsafe impl Send for Preview {}

impl Preview {
    /// request：`clientPid`（要用预览的进程）、`maxWidth`（默认 1280）、`fps`（默认 15）。source 是来源画面的尺寸。
    pub fn create(gpu: &Gpu, request: &Value, source: (u32, u32), notify: Notify) -> Result<(Self, Value), String> {
        let failed = |error: windows::core::Error| format!("CAPTURE_FAILED|无法建立预览：{error}");
        let pid = request["clientPid"].as_u64().ok_or("INVALID_ARGUMENT|缺少 clientPid")? as u32;
        let max_width = request["maxWidth"].as_u64().unwrap_or(1280).clamp(64, 3840) as u32;
        let fps = request["fps"].as_u64().unwrap_or(15).clamp(1, 60) as i64;
        let width = source.0.min(max_width) & !1;
        let height = ((source.1 as u64 * width as u64 / source.0 as u64) as u32).max(2) & !1;
        unsafe {
            let client = OpenProcess(PROCESS_DUP_HANDLE, false, pid).map_err(|error| format!("INVALID_ARGUMENT|打不开要用预览的进程 {pid}：{error}"))?;
            let mut preview = Self { slots: Vec::new(), client, width, height, interval_us: 1_000_000 / fps, last_us: i64::MIN, next: 0, sequence: 0, notify };
            let description = D3D11_TEXTURE2D_DESC {
                Width: width,
                Height: height,
                MipLevels: 1,
                ArraySize: 1,
                Format: DXGI_FORMAT_B8G8R8A8_UNORM,
                SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
                Usage: D3D11_USAGE_DEFAULT,
                BindFlags: (D3D11_BIND_RENDER_TARGET.0 | D3D11_BIND_SHADER_RESOURCE.0) as u32,
                CPUAccessFlags: 0,
                MiscFlags: (D3D11_RESOURCE_MISC_SHARED_NTHANDLE.0 | D3D11_RESOURCE_MISC_SHARED.0) as u32,
            };
            for _ in 0..SLOTS {
                let mut texture = None;
                gpu.device.CreateTexture2D(&description, None, Some(&mut texture)).map_err(failed)?;
                let texture = texture.unwrap();
                let mut view = None;
                gpu.device.CreateRenderTargetView(&texture, None, Some(&mut view)).map_err(failed)?;
                let local = texture.cast::<IDXGIResource1>().and_then(|resource| resource.CreateSharedHandle(None, DXGI_SHARED_RESOURCE_READ.0, PCWSTR::null())).map_err(failed)?;
                let mut remote = HANDLE::default();
                let duplicated = DuplicateHandle(GetCurrentProcess(), local, client, &mut remote, 0, false, DUPLICATE_SAME_ACCESS);
                let _ = CloseHandle(local);
                duplicated.map_err(failed)?;
                preview.slots.push(Slot { _texture: texture, view: view.unwrap(), remote: remote.0 as usize as u64 });
            }
            let reply = json!({
                "format": "bgra", "codedSize": {"width": width, "height": height}, "keyedMutex": false,
                // 句柄值按十进制字符串给（与视频解码服务一致），是 clientPid 那个进程里的句柄。
                "slots": preview.slots.iter().map(|slot| slot.remote.to_string()).collect::<Vec<_>>(),
                "fps": fps,
            });
            Ok((preview, reply))
        }
    }

    /// 采集回调每帧调用：到了预览的出帧时刻就画一张并通知。
    pub fn offer(&mut self, gpu: &Gpu, converter: &Converter, source: &ID3D11Texture2D, source_us: i64) -> windows::core::Result<()> {
        // 留十分之一的余量：来源帧的间隔有抖动，卡着整数倍会时有时无。
        if source_us.saturating_sub(self.last_us) < self.interval_us * 9 / 10 {
            return Ok(());
        }
        let slot = self.next;
        converter.copy(gpu, source, &self.slots[slot].view, self.width, self.height)?;
        self.last_us = source_us;
        self.next = (slot + 1) % self.slots.len();
        self.sequence += 1;
        (self.notify)(json!({"slot": slot, "sequence": self.sequence, "sourceUs": source_us}));
        Ok(())
    }
}

impl Drop for Preview {
    fn drop(&mut self) {
        unsafe {
            for slot in &self.slots {
                // 关掉复制到对方进程里的句柄（对方若已退出，这一步失败无妨）。
                let _ = DuplicateHandle(self.client, HANDLE(slot.remote as usize as *mut c_void), HANDLE::default(), ptr::null_mut(), 0, false, DUPLICATE_CLOSE_SOURCE);
            }
            let _ = CloseHandle(self.client);
        }
    }
}

/// 开发用：在另一个进程里按句柄打开预览纹理并读回，证明对方进程确实能用、画面确实在更新。
/// 从标准输入读一行 `startPreview` 的应答（JSON），每 150 毫秒把每张纹理读回一次，共 12 轮，输出各轮的采样和。
pub fn read_from_stdin() -> Result<Value, String> {
    let failed = |error: windows::core::Error| format!("读不了预览纹理：{error}");
    let mut line = String::new();
    std::io::stdin().read_line(&mut line).map_err(|error| error.to_string())?;
    let description: Value = serde_json::from_str(&line).map_err(|error| error.to_string())?;
    let gpu = Gpu::create_for_nvenc()?;
    let device: ID3D11Device1 = gpu.device.cast().map_err(failed)?;
    let (width, height) = (description["codedSize"]["width"].as_u64().unwrap_or(0) as u32, description["codedSize"]["height"].as_u64().unwrap_or(0) as u32);
    let mut textures = Vec::new();
    for slot in description["slots"].as_array().ok_or("应答里没有 slots")? {
        let handle = HANDLE(slot.as_str().and_then(|text| text.parse::<usize>().ok()).ok_or("句柄值不对")? as *mut c_void);
        textures.push(unsafe { device.OpenSharedResource1::<ID3D11Texture2D>(handle) }.map_err(failed)?);
    }
    let staging_description = D3D11_TEXTURE2D_DESC {
        Width: width,
        Height: height,
        MipLevels: 1,
        ArraySize: 1,
        Format: DXGI_FORMAT_B8G8R8A8_UNORM,
        SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
        Usage: D3D11_USAGE_STAGING,
        BindFlags: 0,
        CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
        MiscFlags: 0,
    };
    let mut staging = None;
    unsafe { gpu.device.CreateTexture2D(&staging_description, None, Some(&mut staging)).map_err(failed)? };
    let staging = staging.unwrap();
    let mut rounds = Vec::new();
    for _ in 0..12 {
        let mut sums = Vec::new();
        for texture in &textures {
            let context = gpu.lock();
            unsafe {
                context.CopyResource(&staging, texture);
                let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
                context.Map(&staging, 0, D3D11_MAP_READ, 0, Some(&mut mapped)).map_err(failed)?;
                let data = std::slice::from_raw_parts(mapped.pData as *const u8, mapped.RowPitch as usize * height as usize);
                // 每隔 97 个字节取一个：足够分辨画面变没变，不必全读。
                sums.push(data.iter().step_by(97).map(|byte| *byte as u64).sum::<u64>());
                context.Unmap(&staging, 0);
            }
        }
        rounds.push(sums);
        std::thread::sleep(std::time::Duration::from_millis(150));
    }
    let nonblank = rounds.iter().flatten().any(|sum| *sum > 0);
    let changed = rounds.windows(2).any(|pair| pair[0] != pair[1]);
    Ok(json!({"opened": textures.len(), "width": width, "height": height, "nonblank": nonblank, "changed": changed, "rounds": rounds}))
}
