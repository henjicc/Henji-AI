//! D3D11 设备：枚举 DXGI 适配器，在高性能硬件适配器上创建带视频支持的设备。
//! 1.1 只用于握手报告；1.2/1.3 在同一设备上创建共享纹理与 D3D11VA 解码。

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
        /// 1.2 起用于创建共享纹理与 D3D11VA 解码；1.1 只持有以保持设备存活。
        #[allow(dead_code)]
        pub device: ID3D11Device,
        pub summary: Value,
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
        let summary = json!({
            "available": true,
            "adapter": adapter_value(&selected_desc),
            "featureLevel": feature_level_name(feature_level),
            "videoDecoderProfiles": decoder_profiles(&device),
            "adapters": adapters.iter().map(|(_, desc)| adapter_value(desc)).collect::<Vec<_>>(),
        });
        Ok(GpuDevice { device, summary })
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
