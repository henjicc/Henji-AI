//! 平台层的接口。共用核心（`core`）只通过这里的 trait 用系统能力；各平台只实现这几件事：
//! 时钟、枚举来源、打开“采集 + 写文件”这一对、看前台窗口、报本进程的资源占用。
//!
//! 数据怎么流：平台的采集把每张来源帧（留在显卡里的句柄）连同它的采集时刻放进核心给的收件箱；
//! 核心的网格决定每个输出格用哪一张，再调平台的 `FrameWriter` 按给定的帧序号写进文件。
//! 编码与封装放在 `FrameWriter` 后面，是因为两个平台分法不同：Windows 是硬件编码加自己封装，
//! macOS 的 AVAssetWriter 一步做完。

use crate::core::{
    activity::Foreground,
    health::{Health, Inbox},
    protocol::CaptureConfig,
};
use serde_json::Value;
use std::{path::Path, sync::Arc};

pub trait FrameWriter<F> {
    /// 把这一帧按 pts（时间基 1/fps）写进文件。同一帧可以用不同的 pts 多次写（重复帧）。
    /// 可以阻塞（编码或磁盘慢时），由核心据此丢格并计数；不允许无声地丢帧。
    /// 返回这一帧编码后的字节数（拿不到就返回 0）：画面没变时它很小，活动时间线用它判断这一秒有没有在动。
    fn write(&mut self, frame: &F, pts: i64, force_key: bool) -> Result<u64, String>;
    /// 把已写的帧立刻落成一个完整分片（暂停时调用）。
    fn flush_fragment(&mut self) -> Result<(), String>;
    /// 排空编码器、写好结尾并关文件。之后不再调用 write。
    fn finish(&mut self) -> Result<(), String>;
}

pub struct Opened<P: Platform> {
    /// 放下它就停止采集。
    pub capture: P::Capture,
    pub writer: P::Writer,
    pub width: u32,
    pub height: u32,
    pub encoder: String,
    /// 实际采集的来源（写进清单，供主进程核对）。
    pub source: Value,
}

#[derive(Debug, Default, Clone, Copy)]
pub struct ProcessStats {
    /// 本进程累计占用的处理器时间（用户态 + 内核态）。
    pub cpu_time_us: u64,
    pub private_bytes: u64,
    /// 本进程占用的显存。
    pub gpu_bytes: u64,
}

pub trait Platform: Sized + 'static {
    /// 留在显卡里的一帧；放下即归还。
    type Frame: Send + 'static;
    type Capture: Send + 'static;
    type Writer: FrameWriter<Self::Frame> + Send + 'static;
    /// 握手里报的平台名。
    const NAME: &'static str;
    /// 时刻表文件头里的时钟种类（`core::timing::CLOCK_*`）。
    const CLOCK: u32;
    /// 清单里的时钟名。
    const CLOCK_NAME: &'static str;

    /// 单调时钟，微秒；必须与来源帧的采集时刻、主进程校准用的 `nativeMonoUs` 是同一个时钟。
    fn now_us() -> i64;
    fn sources() -> Result<Value, String>;
    /// 建好采集与编码并开始采集（帧进收件箱）；此时还不写文件内容，核心在 start 之后才调 writer。
    /// 本机不支持时返回 `ENCODER_UNSUPPORTED|...` 或 `CAPTURE_UNSUPPORTED|...`，主进程据此改用后备录法。
    fn open(config: &CaptureConfig, video_path: &Path, inbox: Arc<Inbox<Self::Frame>>, health: Arc<Health>) -> Result<Opened<Self>, String>;
    fn foreground() -> Option<Foreground>;
    fn process_stats(capture: &Self::Capture) -> ProcessStats;
}

#[cfg(windows)]
pub mod windows;
#[cfg(windows)]
pub use windows::WindowsPlatform as Native;

#[cfg(not(windows))]
pub mod macos;
#[cfg(not(windows))]
pub use macos::MacosPlatform as Native;
