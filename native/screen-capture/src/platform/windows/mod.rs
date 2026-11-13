//! Windows 平台层：Windows.Graphics.Capture 采集 → 显卡上转 NV12 → 硬件编码 → 分片 MP4。
//! 第一版范围：Windows 10 2004 及以上、NVIDIA 显卡、整块显示器。

mod convert;
mod device;
mod encode;
mod mux;
mod wgc;

use crate::core::{
    activity::Foreground,
    health::{Health, Inbox},
    protocol::{CaptureConfig, SourceSpec},
    timing,
};
use crate::platform::{Opened, Platform, ProcessStats};
use serde_json::{json, Value};
use std::{
    path::Path,
    sync::{Arc, Mutex, Once},
};
use windows::core::PWSTR;
use windows::Win32::Foundation::{CloseHandle, FILETIME};
use windows::Win32::Media::{timeBeginPeriod, timeEndPeriod};
use windows::Win32::System::Performance::{QueryPerformanceCounter, QueryPerformanceFrequency};
use windows::Win32::System::ProcessStatus::{GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS, PROCESS_MEMORY_COUNTERS_EX};
use windows::Win32::System::Threading::{
    GetCurrentProcess, GetProcessTimes, OpenProcess, QueryFullProcessImageNameW, SetPriorityClass, ABOVE_NORMAL_PRIORITY_CLASS, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};
use windows::Win32::UI::HiDpi::{SetProcessDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2};
use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId};

/// 与 `SystemRelativeTime`、录音进程的 `hc_clock`、主进程的 `hrtime` 同一个计数器（QPC），单位微秒。
pub fn now_us() -> i64 {
    let (mut counter, mut frequency) = (0i64, 0i64);
    unsafe {
        let _ = QueryPerformanceCounter(&mut counter);
        let _ = QueryPerformanceFrequency(&mut frequency);
    }
    (counter as i128 * 1_000_000 / frequency.max(1) as i128) as i64
}

/// 进程级初始化：坐标按物理像素（否则高缩放显示器的矩形是缩放后的），WinRT 用多线程套间（采集回调在线程池上）。
fn initialize() {
    static ONCE: Once = Once::new();
    ONCE.call_once(|| unsafe {
        let _ = SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
        let _ = RoInitialize(RO_INIT_MULTITHREADED);
        // 本进程几乎不占处理器，但每一帧都有时限：别的程序把处理器占满时（编译、导出）也要按时轮到。
        let _ = SetPriorityClass(GetCurrentProcess(), ABOVE_NORMAL_PRIORITY_CLASS);
    });
}

/// 录制期间把系统计时精度提到 1 毫秒：会话线程按格时刻定时醒来，默认的 15.6 毫秒精度比一帧还粗。
struct TimerResolution;
impl TimerResolution {
    fn raise() -> Self {
        unsafe { timeBeginPeriod(1) };
        Self
    }
}
impl Drop for TimerResolution {
    fn drop(&mut self) {
        unsafe { timeEndPeriod(1) };
    }
}

pub struct Capture {
    capture: wgc::Capture,
    _timer: TimerResolution,
}

pub struct WindowsPlatform;

impl Platform for WindowsPlatform {
    type Frame = encode::HwFrame;
    type Capture = Capture;
    type Writer = encode::Encoder;
    const NAME: &'static str = "windows";
    const CLOCK: u32 = timing::CLOCK_QPC;
    const CLOCK_NAME: &'static str = "qpc";

    fn now_us() -> i64 {
        now_us()
    }

    fn sources() -> Result<Value, String> {
        initialize();
        Ok(json!({"displays": device::displays().iter().map(device::Display::describe).collect::<Vec<_>>()}))
    }

    fn open(config: &CaptureConfig, video_path: &Path, inbox: Arc<Inbox<Self::Frame>>, health: Arc<Health>) -> Result<Opened<Self>, String> {
        initialize();
        let SourceSpec::Display { id, point } = &config.source;
        let display = device::find_display(id.as_deref(), *point)?;
        let gpu = Arc::new(device::Gpu::create_for_nvenc()?);
        // NV12 的色度是半分辨率：宽高取偶数。
        let (width, height) = (display.width() & !1, display.height() & !1);
        let hw = Arc::new(encode::HwContext::new(gpu.clone(), width, height)?);
        let writer = encode::Encoder::open(hw.clone(), config, width, height, video_path, health.clone())?;
        let converter = convert::Converter::new(&gpu)?;
        let encoder = writer.label.to_string();
        let mut source = display.describe();
        source["adapter"] = json!(gpu.adapter_name);
        let capture = wgc::start(gpu, &display, hw, converter, width, height, config.fps, inbox, health)?;
        Ok(Opened { capture: Capture { capture, _timer: TimerResolution::raise() }, writer, width, height, encoder, source })
    }

    fn foreground() -> Option<Foreground> {
        // 进程名只在前台进程变了才重新查。
        static LAST_PROCESS: Mutex<(u32, String)> = Mutex::new((0, String::new()));
        unsafe {
            let window = GetForegroundWindow();
            if window.is_invalid() {
                return None;
            }
            let mut title = [0u16; 512];
            let length = GetWindowTextW(window, &mut title).max(0) as usize;
            let mut pid = 0u32;
            GetWindowThreadProcessId(window, Some(&mut pid));
            let mut last = LAST_PROCESS.lock().unwrap();
            if last.0 != pid {
                let mut name = String::new();
                if let Ok(process) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
                    let mut path = [0u16; 1024];
                    let mut size = path.len() as u32;
                    if QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32, PWSTR(path.as_mut_ptr()), &mut size).is_ok() {
                        let full = String::from_utf16_lossy(&path[..size as usize]);
                        name = full.rsplit(['\\', '/']).next().unwrap_or_default().to_string();
                    }
                    let _ = CloseHandle(process);
                }
                *last = (pid, name);
            }
            Some(Foreground { title: String::from_utf16_lossy(&title[..length]), process: last.1.clone(), pid })
        }
    }

    fn process_stats(capture: &Capture) -> ProcessStats {
        let ticks = |time: FILETIME| ((time.dwHighDateTime as u64) << 32 | time.dwLowDateTime as u64) / 10;
        unsafe {
            let process = GetCurrentProcess();
            let (mut created, mut exited, mut kernel, mut user) = (FILETIME::default(), FILETIME::default(), FILETIME::default(), FILETIME::default());
            let _ = GetProcessTimes(process, &mut created, &mut exited, &mut kernel, &mut user);
            let mut memory = PROCESS_MEMORY_COUNTERS_EX::default();
            let _ = GetProcessMemoryInfo(process, &mut memory as *mut PROCESS_MEMORY_COUNTERS_EX as *mut PROCESS_MEMORY_COUNTERS, size_of::<PROCESS_MEMORY_COUNTERS_EX>() as u32);
            ProcessStats { cpu_time_us: ticks(kernel) + ticks(user), private_bytes: memory.PrivateUsage as u64, gpu_bytes: capture.capture.gpu.memory_bytes() }
        }
    }
}
