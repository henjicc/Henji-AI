//! 显卡设备与显示器枚举。
//!
//! 采集、色彩转换、编码都在同一个 D3D11 设备上，画面从不离开显卡。设备建在编码用的那块显卡上；
//! 显示器接在别的显卡上时由系统的采集接口跨卡复制。

use serde_json::{json, Value};
use windows::core::{Interface, BOOL, PCWSTR};
use windows::Win32::Foundation::{HMODULE, LPARAM, POINT, RECT};
use windows::Win32::Graphics::Direct3D::{D3D_DRIVER_TYPE_UNKNOWN, D3D_FEATURE_LEVEL_11_0, D3D_FEATURE_LEVEL_11_1};
use windows::Win32::Graphics::Direct3D11::*;
use windows::Win32::Graphics::Dxgi::*;
use windows::Win32::Graphics::Gdi::*;

const VENDOR_NVIDIA: u32 = 0x10DE;
/// MONITORINFO.dwFlags 里的“主显示器”位。
const MONITORINFOF_PRIMARY: u32 = 1;

pub struct Gpu {
    pub device: ID3D11Device,
    context: ID3D11DeviceContext,
    pub multithread: ID3D11Multithread,
    adapter: IDXGIAdapter1,
    pub adapter_name: String,
}

// D3D11 设备与 DXGI 适配器是自由线程的；立即上下文只经 lock() 使用。
unsafe impl Send for Gpu {}
unsafe impl Sync for Gpu {}

/// 持有立即上下文的锁（设备开了多线程保护后，这就是运行时内部那把可重入锁，编码器用的也是它）。
pub struct ContextGuard<'a>(&'a Gpu);

impl std::ops::Deref for ContextGuard<'_> {
    type Target = ID3D11DeviceContext;
    fn deref(&self) -> &ID3D11DeviceContext {
        &self.0.context
    }
}

impl Drop for ContextGuard<'_> {
    fn drop(&mut self) {
        unsafe { self.0.multithread.Leave() };
    }
}

impl Gpu {
    /// 第一版只支持 NVIDIA：找不到就明确说本机暂不支持，由主进程改用现有录法。
    pub fn create_for_nvenc() -> Result<Self, String> {
        let unsupported = |detail: &str| format!("ENCODER_UNSUPPORTED|此设备暂不支持新的录屏方式（{detail}），请用现有录法");
        unsafe {
            let factory: IDXGIFactory1 = CreateDXGIFactory1().map_err(|error| format!("CAPTURE_FAILED|无法枚举显卡：{error}"))?;
            let mut best: Option<(IDXGIAdapter1, DXGI_ADAPTER_DESC1)> = None;
            let mut index = 0;
            while let Ok(adapter) = factory.EnumAdapters1(index) {
                index += 1;
                let Ok(description) = adapter.GetDesc1() else { continue };
                let software = description.Flags & DXGI_ADAPTER_FLAG_SOFTWARE.0 as u32 != 0;
                if software || description.VendorId != VENDOR_NVIDIA {
                    continue;
                }
                if best.as_ref().is_none_or(|(_, current)| description.DedicatedVideoMemory > current.DedicatedVideoMemory) {
                    best = Some((adapter, description));
                }
            }
            let (adapter, description) = best.ok_or_else(|| unsupported("没有找到 NVIDIA 显卡"))?;
            let mut device = None;
            let mut context = None;
            D3D11CreateDevice(
                &adapter,
                D3D_DRIVER_TYPE_UNKNOWN,
                HMODULE::default(),
                D3D11_CREATE_DEVICE_BGRA_SUPPORT,
                Some(&[D3D_FEATURE_LEVEL_11_1, D3D_FEATURE_LEVEL_11_0]),
                D3D11_SDK_VERSION,
                Some(&mut device),
                None,
                Some(&mut context),
            )
            .map_err(|error| unsupported(&format!("无法在显卡上创建设备：{error}")))?;
            let (device, context) = (device.unwrap(), context.unwrap());
            let multithread: ID3D11Multithread = device.cast().map_err(|error| format!("CAPTURE_FAILED|{error}"))?;
            let _ = multithread.SetMultithreadProtected(true);
            // 显卡忙时（游戏、渲染、别的编码）让本设备的命令优先排上：每帧的转换只有几毫秒的窗口。
            if let Ok(dxgi) = device.cast::<IDXGIDevice>() {
                let _ = dxgi.SetGPUThreadPriority(7);
            }
            let name_length = description.Description.iter().position(|unit| *unit == 0).unwrap_or(description.Description.len());
            Ok(Self { device, context, multithread, adapter, adapter_name: String::from_utf16_lossy(&description.Description[..name_length]) })
        }
    }

    pub fn lock(&self) -> ContextGuard<'_> {
        unsafe { self.multithread.Enter() };
        ContextGuard(self)
    }

    pub fn removed(&self) -> bool {
        unsafe { self.device.GetDeviceRemovedReason() }.is_err()
    }

    /// 本进程在这块显卡上占用的显存（字节）。
    pub fn memory_bytes(&self) -> u64 {
        let Ok(adapter) = self.adapter.cast::<IDXGIAdapter3>() else { return 0 };
        let mut info = DXGI_QUERY_VIDEO_MEMORY_INFO::default();
        match unsafe { adapter.QueryVideoMemoryInfo(0, DXGI_MEMORY_SEGMENT_GROUP_LOCAL, &mut info) } {
            Ok(()) => info.CurrentUsage,
            Err(_) => 0,
        }
    }
}

#[derive(Clone)]
pub struct Display {
    pub handle: HMONITOR,
    /// 系统设备名，如 `\\.\DISPLAY1`；会话之间稳定，HMONITOR 不稳定。
    pub device_name: String,
    /// 在虚拟桌面上的位置，物理像素。
    pub rect: RECT,
    pub primary: bool,
    pub refresh_hz: u32,
}

impl Display {
    pub fn width(&self) -> u32 {
        (self.rect.right - self.rect.left) as u32
    }
    pub fn height(&self) -> u32 {
        (self.rect.bottom - self.rect.top) as u32
    }
    pub fn describe(&self) -> Value {
        json!({
            "kind": "display", "id": self.device_name,
            "x": self.rect.left, "y": self.rect.top, "width": self.width(), "height": self.height(),
            "primary": self.primary, "refreshHz": self.refresh_hz,
        })
    }
}

unsafe extern "system" fn collect_display(monitor: HMONITOR, _: HDC, _: *mut RECT, data: LPARAM) -> BOOL {
    let displays = unsafe { &mut *(data.0 as *mut Vec<Display>) };
    let mut info = MONITORINFOEXW::default();
    info.monitorInfo.cbSize = size_of::<MONITORINFOEXW>() as u32;
    if unsafe { GetMonitorInfoW(monitor, &mut info as *mut MONITORINFOEXW as *mut MONITORINFO) }.as_bool() {
        let mut mode = DEVMODEW { dmSize: size_of::<DEVMODEW>() as u16, ..Default::default() };
        let refresh_hz = if unsafe { EnumDisplaySettingsW(PCWSTR(info.szDevice.as_ptr()), ENUM_CURRENT_SETTINGS, &mut mode) }.as_bool() { mode.dmDisplayFrequency } else { 0 };
        let name_length = info.szDevice.iter().position(|unit| *unit == 0).unwrap_or(info.szDevice.len());
        displays.push(Display {
            handle: monitor,
            device_name: String::from_utf16_lossy(&info.szDevice[..name_length]),
            rect: info.monitorInfo.rcMonitor,
            primary: info.monitorInfo.dwFlags & MONITORINFOF_PRIMARY != 0,
            refresh_hz,
        });
    }
    true.into()
}

pub fn displays() -> Vec<Display> {
    let mut displays: Vec<Display> = Vec::new();
    unsafe {
        let _ = EnumDisplayMonitors(None, None, Some(collect_display), LPARAM(&mut displays as *mut Vec<Display> as isize));
    }
    displays
}

/// 按设备名找；没给设备名按坐标所在的显示器；都没给取主显示器。
pub fn find_display(id: Option<&str>, point: Option<[i32; 2]>) -> Result<Display, String> {
    let all = displays();
    let found = match (id, point) {
        (Some(id), _) => all.into_iter().find(|display| display.device_name.eq_ignore_ascii_case(id)),
        (None, Some([x, y])) => {
            let handle = unsafe { MonitorFromPoint(POINT { x, y }, MONITOR_DEFAULTTONULL) };
            all.into_iter().find(|display| display.handle == handle && !handle.is_invalid())
        }
        (None, None) => all.into_iter().find(|display| display.primary),
    };
    found.ok_or_else(|| "SOURCE_MISSING|找不到要录的显示器，请重新选择".to_string())
}
