//! D3D11 设备：枚举 DXGI 适配器，在高性能硬件适配器上创建带视频支持的设备。
//! 握手报告设备信息；共享纹理池（1.2）与 D3D11VA 解码（1.3）在同一设备上创建。
//! 设备开启多线程保护，立即上下文另由互斥锁串行化（每个流的生产线程共用）。

use serde_json::{json, Value};

#[cfg(windows)]
mod imp {
    use super::*;
    use windows::core::{Interface, GUID};
    use windows::Win32::Foundation::HMODULE;
    use windows::Win32::Graphics::Direct3D::{D3D_DRIVER_TYPE_UNKNOWN, D3D_FEATURE_LEVEL, D3D_FEATURE_LEVEL_11_0, D3D_FEATURE_LEVEL_11_1};
    use windows::Win32::Graphics::Direct3D11::*;
    use windows::Win32::Graphics::Dxgi::*;

    pub struct GpuDevice {
        pub device: ID3D11Device,
        /// 立即上下文不是线程安全的：所有使用者先取锁。
        pub context: std::sync::Mutex<ID3D11DeviceContext>,
        adapter: IDXGIAdapter1,
        pub summary: Value,
    }

    impl GpuDevice {
        /// 处理延迟销毁的资源（已释放的纹理在下一次 Flush 时才归还显存）。
        pub fn flush(&self) {
            let context = self.context.lock().unwrap();
            unsafe { context.Flush() };
        }

        /// 本进程在本地显存段的占用与预算（字节）。用于资源回收验收与统计。
        pub fn local_memory(&self) -> Option<(u64, u64)> {
            let adapter = self.adapter.cast::<IDXGIAdapter3>().ok()?;
            let mut info = DXGI_QUERY_VIDEO_MEMORY_INFO::default();
            unsafe { adapter.QueryVideoMemoryInfo(0, DXGI_MEMORY_SEGMENT_GROUP_LOCAL, &mut info) }.ok()?;
            Some((info.CurrentUsage, info.Budget))
        }
    }

    fn adapter_value(desc: &DXGI_ADAPTER_DESC1) -> Value {
        let length = desc.Description.iter().position(|unit| *unit == 0).unwrap_or(desc.Description.len());
        json!({
            "description": String::from_utf16_lossy(&desc.Description[..length]),
            "vendorId": format!("0x{:04x}", desc.VendorId),
            "deviceId": format!("0x{:04x}", desc.DeviceId),
            "dedicatedVideoMemoryMiB": desc.DedicatedVideoMemory / (1024 * 1024),
            "sharedSystemMemoryMiB": desc.SharedSystemMemory / (1024 * 1024),
            "luid": format!("{:08x}:{:08x}", desc.AdapterLuid.HighPart as u32, desc.AdapterLuid.LowPart),
            "software": desc.Flags & DXGI_ADAPTER_FLAG_SOFTWARE.0 as u32 != 0,
        })
    }

    const NAMED_DECODER_PROFILES: &[(&str, GUID)] = &[
        ("h264", D3D11_DECODER_PROFILE_H264_VLD_NOFGT),
        ("hevc_main", D3D11_DECODER_PROFILE_HEVC_VLD_MAIN),
        ("hevc_main10", D3D11_DECODER_PROFILE_HEVC_VLD_MAIN10),
        ("vp9_profile0", D3D11_DECODER_PROFILE_VP9_VLD_PROFILE0),
        ("vp9_10bit_profile2", D3D11_DECODER_PROFILE_VP9_VLD_10BIT_PROFILE2),
        ("av1_profile0", D3D11_DECODER_PROFILE_AV1_VLD_PROFILE0),
        ("mpeg2", D3D11_DECODER_PROFILE_MPEG2_VLD),
    ];

    fn decoder_profiles(device: &ID3D11Device) -> Value {
        let Ok(video) = device.cast::<ID3D11VideoDevice>() else {
            return json!({ "available": false, "count": 0, "named": [] });
        };
        let count = unsafe { video.GetVideoDecoderProfileCount() };
        let mut guids = Vec::new();
        for index in 0..count {
            if let Ok(guid) = unsafe { video.GetVideoDecoderProfile(index) } {
                guids.push(guid);
            }
        }
        let named: Vec<&str> = NAMED_DECODER_PROFILES.iter().filter(|(_, guid)| guids.contains(guid)).map(|(name, _)| *name).collect();
        json!({ "available": true, "count": count, "named": named })
    }

    /// 各共享格式在本设备上的纹理支持（只用于诊断日志；能否被 Chromium 导入以实测为准）。
    fn shared_format_support(device: &ID3D11Device) -> Value {
        use crate::test_pattern::SharedFormat;
        let formats = [SharedFormat::Nv12, SharedFormat::Nv16, SharedFormat::P010le, SharedFormat::Rgba, SharedFormat::Bgra, SharedFormat::Rgbaf16];
        let mut support = serde_json::Map::new();
        for format in formats {
            let flags = unsafe { device.CheckFormatSupport(crate::shared_texture::dxgi_format(format)) }.unwrap_or(0) as i32;
            support.insert(
                format.name().into(),
                json!({
                    "texture2d": flags & D3D11_FORMAT_SUPPORT_TEXTURE2D.0 != 0,
                    "shaderLoad": flags & D3D11_FORMAT_SUPPORT_SHADER_LOAD.0 != 0,
                    "shaderSample": flags & D3D11_FORMAT_SUPPORT_SHADER_SAMPLE.0 != 0,
                    "renderTarget": flags & D3D11_FORMAT_SUPPORT_RENDER_TARGET.0 != 0,
                }),
            );
        }
        Value::Object(support)
    }

    fn feature_level_name(level: D3D_FEATURE_LEVEL) -> String {
        format!("{}.{}", (level.0 >> 12) & 0xf, (level.0 >> 8) & 0xf)
    }

    pub fn create_device() -> Result<GpuDevice, String> {
        let factory: IDXGIFactory1 = unsafe { CreateDXGIFactory1() }.map_err(|error| format!("CreateDXGIFactory1 失败：{error}"))?;
        let mut adapters = Vec::new();
        for index in 0.. {
            let Ok(adapter) = (unsafe { factory.EnumAdapters1(index) }) else { break };
            if let Ok(desc) = unsafe { adapter.GetDesc1() } {
                adapters.push((adapter, desc));
            }
        }
        // 优先系统给出的高性能顺序（独显），排除软件适配器。
        let preferred: Option<IDXGIAdapter1> = factory.cast::<IDXGIFactory6>().ok().and_then(|factory6| {
            (0..).map_while(|index| unsafe { factory6.EnumAdapterByGpuPreference::<IDXGIAdapter1>(index, DXGI_GPU_PREFERENCE_HIGH_PERFORMANCE) }.ok())
                .find(|adapter| unsafe { adapter.GetDesc1() }.is_ok_and(|desc| desc.Flags & DXGI_ADAPTER_FLAG_SOFTWARE.0 as u32 == 0))
        });
        let selected = preferred
            .or_else(|| adapters.iter().find(|(_, desc)| desc.Flags & DXGI_ADAPTER_FLAG_SOFTWARE.0 as u32 == 0).map(|(adapter, _)| adapter.clone()))
            .ok_or_else(|| "没有可用的硬件显卡适配器".to_string())?;
        let selected_desc = unsafe { selected.GetDesc1() }.map_err(|error| format!("读取适配器信息失败：{error}"))?;

        let levels = [D3D_FEATURE_LEVEL_11_1, D3D_FEATURE_LEVEL_11_0];
        let mut device: Option<ID3D11Device> = None;
        let mut feature_level = D3D_FEATURE_LEVEL::default();
        unsafe {
            D3D11CreateDevice(
                &selected,
                D3D_DRIVER_TYPE_UNKNOWN,
                HMODULE::default(),
                D3D11_CREATE_DEVICE_VIDEO_SUPPORT | D3D11_CREATE_DEVICE_BGRA_SUPPORT,
                Some(&levels),
                D3D11_SDK_VERSION,
                Some(&mut device),
                Some(&mut feature_level),
                None,
            )
        }
        .map_err(|error| format!("D3D11CreateDevice 失败：{error}"))?;
        let device = device.ok_or_else(|| "D3D11CreateDevice 未返回设备".to_string())?;
        if let Ok(multithread) = device.cast::<ID3D11Multithread>() {
            let _ = unsafe { multithread.SetMultithreadProtected(true) };
        }
        let context = unsafe { device.GetImmediateContext() }.map_err(|error| format!("获取立即上下文失败：{error}"))?;
        let summary = json!({
            "available": true,
            "adapter": adapter_value(&selected_desc),
            "featureLevel": feature_level_name(feature_level),
            "videoDecoderProfiles": decoder_profiles(&device),
            "sharedFormats": shared_format_support(&device),
            "adapters": adapters.iter().map(|(_, desc)| adapter_value(desc)).collect::<Vec<_>>(),
        });
        Ok(GpuDevice { device, context: std::sync::Mutex::new(context), adapter: selected, summary })
    }
}

#[cfg(windows)]
pub use imp::{create_device, GpuDevice};

#[cfg(not(windows))]
pub struct GpuDevice {
    pub summary: Value,
}

#[cfg(not(windows))]
pub fn create_device() -> Result<GpuDevice, String> {
    Err("原生视频解码只支持 Windows".to_string())
}

/// 设备创建失败时握手仍返回，标明不可用原因，由主进程决定回退。
pub fn unavailable_summary(reason: &str) -> Value {
    json!({ "available": false, "reason": reason })
}
