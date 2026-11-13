//! macOS 平台层的位置：尚未实现，现在只让共用核心在非 Windows 上能编译和跑单元测试。
//!
//! 适配时只需要在这个目录里实现 `Platform`，共用核心不用动：
//! - `now_us`：`mach_absolute_time` 换算成微秒（ScreenCaptureKit 帧的时间戳就是这个时钟）。注意主进程的 `hrtime`
//!   在 macOS 上是 `mach_continuous_time`，休眠后两者会差开，对齐靠握手与 `clock` 指令的定期校准；
//! - `Frame`：ScreenCaptureKit 给的 `CVPixelBuffer`（IOSurface，420v、BT.709），保留引用即可，不拷贝；
//! - `open`：`SCContentFilter(display:excludingWindows:)`（按进程号排除本应用的窗口）+ `SCStream`
//!   （`showsCursor = false`，`minimumFrameInterval = 0.9 / fps`，`queueDepth = 8`，只把 `SCFrameStatus.complete` 当新帧），
//!   每帧连同时间戳放进收件箱；`didStopWithError` 时调 `Inbox::fail("SOURCE_LOST|...")`；
//! - `Writer`：`AVAssetWriter` + `AVAssetWriterInputPixelBufferAdaptor`，HEVC 或 H.264 硬件编码，
//!   `movieFragmentInterval` 与 `initialMovieFragmentInterval` 设为一秒（分片 MP4，被杀后可读）；
//!   `write` 用 pts（时间基 1/fps）append，`isReadyForMoreMediaData` 为假时等待（核心会据此丢格并计数）；
//!   `flush_fragment` 对应暂停时落盘；`finish` 调 `finishWriting`；
//! - `foreground`：`NSWorkspace.frontmostApplication` 与最前窗口标题；
//! - `CaptureControl`：`reacquire` 在显示器接回后重建 `SCStream`；预览可以把 IOSurface 的句柄交给界面进程；
//! - 最低系统版本 14；不引入 FFmpeg。
//!
//! 做法与参照见 tickets/46-正式使用链路/调研-Rust画面采集进程.md 第 5 节。

use crate::core::{
    activity::Foreground,
    health::{Health, Inbox},
    protocol::CaptureConfig,
    timing,
};
use crate::platform::{CaptureControl, FrameWriter, Notify, Opened, Platform, ProcessStats};
use serde_json::{json, Value};
use std::{path::Path, sync::Arc, sync::OnceLock, time::Instant};

pub struct MacosPlatform;

pub struct NoWriter;
impl FrameWriter<()> for NoWriter {
    fn write(&mut self, _: &(), _: i64, _: bool) -> Result<u64, String> {
        Err(UNSUPPORTED.into())
    }
    fn flush_fragment(&mut self) -> Result<(), String> {
        Ok(())
    }
    fn finish(&mut self) -> Result<(), String> {
        Ok(())
    }
    fn shed_proxy(&mut self) -> bool {
        false
    }
}

pub struct NoCapture;
impl CaptureControl for NoCapture {
    fn reacquire(&mut self) -> Result<bool, String> {
        Err(UNSUPPORTED.into())
    }
    fn device_lost(&self) -> bool {
        false
    }
    fn simulate_source_lost(&self) {}
    fn simulate_resize(&self) {}
    fn start_preview(&self, _: &Value, _: Notify) -> Result<Value, String> {
        Err(UNSUPPORTED.into())
    }
    fn stop_preview(&self) {}
}

const UNSUPPORTED: &str = "CAPTURE_UNSUPPORTED|此系统暂不支持新的录屏方式，请用现有录法";

impl Platform for MacosPlatform {
    type Frame = ();
    type Capture = NoCapture;
    type Writer = NoWriter;
    const NAME: &'static str = "unsupported";
    const CLOCK: u32 = timing::CLOCK_MACH_ABSOLUTE;
    const CLOCK_NAME: &'static str = "mach_absolute";

    fn now_us() -> i64 {
        // 占位：实现平台层时换成 mach_absolute_time。
        static START: OnceLock<Instant> = OnceLock::new();
        START.get_or_init(Instant::now).elapsed().as_micros() as i64
    }

    fn sources() -> Result<Value, String> {
        Ok(json!({"displays": []}))
    }

    fn close_client_handles(_: u32, _: &[u64]) -> Result<Value, String> {
        Err(UNSUPPORTED.into())
    }

    fn open(_: &CaptureConfig, _: &Path, _: &Path, _: Arc<Inbox<Arc<()>>>, _: Arc<Health>) -> Result<Opened<Self>, String> {
        Err(UNSUPPORTED.into())
    }

    fn foreground() -> Option<Foreground> {
        None
    }

    fn process_stats(_: &NoCapture) -> ProcessStats {
        ProcessStats::default()
    }
}
