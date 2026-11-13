//! 平台层的接口。共用核心（`core`）只通过这里的 trait 用系统能力；各平台只实现这几件事：
//! 时钟、枚举来源、打开“采集 + 写文件”这一对、来源丢失后重新接上、预览画面、看前台窗口、报本进程的资源占用。
//!
//! 数据怎么流：平台的采集把每张来源帧（留在显卡里的句柄）连同它的系统时刻放进核心给的收件箱；
//! 核心的网格决定每个输出格用哪一张，再经编码线程调平台的 `FrameWriter` 按给定的帧序号写进文件。
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
    /// 把这一帧按 pts（时间基 1/fps）写进文件（有代理时同时写进代理文件）。同一帧可以用不同的 pts 多次写（重复帧）。
    /// 在编码线程上调用，可以阻塞（编码或磁盘慢时）；核心的编码队列满了会丢格并计数。
    /// 返回这一帧编码后的字节数（拿不到就返回 0）：画面没变时它很小，活动时间线用它判断这一秒有没有在动。
    fn write(&mut self, frame: &F, pts: i64, force_key: bool) -> Result<u64, String>;
    /// 把已写的帧立刻落成一个完整分片（暂停、来源丢失时调用）。
    fn flush_fragment(&mut self) -> Result<(), String>;
    /// 排空编码器、写好结尾并关文件。之后不再调用 write。显卡设备已经没了时也要把文件结尾写好。
    fn finish(&mut self) -> Result<(), String>;
    /// 编码持续跟不上时由核心调用：停掉代理（收好它已写的部分），把编码能力都留给主画面。没有代理可停时返回 false。
    fn shed_proxy(&mut self) -> bool;
}

/// 可丢的事件出口（预览帧就绪）。
pub type Notify = Box<dyn Fn(Value) + Send + Sync>;

pub trait CaptureControl {
    /// 来源丢了（收件箱收到 `SOURCE_LOST|...`）之后由核心每秒调用：来源回来了就重新开始采集并返回 true。
    /// 返回错误表示不用再等（设备也没了）。
    fn reacquire(&mut self) -> Result<bool, String>;
    /// 显卡设备已被移除或重置：这次录制无法继续，核心收尾并报 `DEVICE_REMOVED`。
    fn device_lost(&self) -> bool;
    /// 开发用：模拟显示器断开（停掉采集并往收件箱报 `SOURCE_LOST`）。
    fn simulate_source_lost(&self);
    /// 开发用：模拟显示器换了分辨率（让采集按“来源尺寸变了”的那条路重建一次）。
    fn simulate_resize(&self);
    /// 开始把低延迟的预览画面交给另一个进程；应答的内容见 README“预览”。
    fn start_preview(&self, request: &Value, notify: Notify) -> Result<Value, String>;
    fn stop_preview(&self);
}

pub struct Opened<P: Platform> {
    /// 放下它就停止采集。
    pub capture: P::Capture,
    pub writer: P::Writer,
    pub width: u32,
    pub height: u32,
    pub encoder: String,
    /// 代理文件的实际尺寸；没有开代理或开不了时为 None。
    pub proxy: Option<(u32, u32)>,
    /// 实际采集的来源（写进清单，供主进程核对）。
    pub source: Value,
    /// 来源帧的系统时刻比画面内容早定下的那一刻晚多少微秒：合成器先取好光标位置与各窗口内容，过这么久这一帧才上屏。
    /// 鼠标键盘事件对到画面、暂停与继续切在哪一格，都要按它换算；拿不准时为 0。
    pub present_lead_us: i64,
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
    /// 留在显卡里的一帧；放下即归还。网格线程与编码线程同时拿着同一帧（重复帧），所以要能跨线程共享。
    type Frame: Send + Sync + 'static;
    type Capture: CaptureControl + Send + 'static;
    type Writer: FrameWriter<Self::Frame> + Send + 'static;
    /// 握手里报的平台名。
    const NAME: &'static str;
    /// 时刻表文件头里的时钟种类（`core::timing::CLOCK_*`）。
    const CLOCK: u32;
    /// 清单里的时钟名。
    const CLOCK_NAME: &'static str;

    /// 单调时钟，微秒；必须与来源帧的系统时刻、主进程校准用的 `nativeMonoUs` 是同一个时钟。
    fn now_us() -> i64;
    fn sources() -> Result<Value, String>;
    /// 关掉预览复制到 `client_pid` 那个进程里的句柄（对方停止导入后才要我们关）。返回 `{closed, failed}`。
    fn close_client_handles(client_pid: u32, handles: &[u64]) -> Result<Value, String>;
    /// 建好采集与编码并开始采集（帧进收件箱）。`proxy_path` 是代理文件的位置，配置里没开代理时不用。
    /// 本机不支持时返回 `ENCODER_UNSUPPORTED|...` 或 `CAPTURE_UNSUPPORTED|...`，主进程据此改用后备录法。
    fn open(config: &CaptureConfig, video_path: &Path, proxy_path: &Path, inbox: Arc<Inbox<Arc<Self::Frame>>>, health: Arc<Health>) -> Result<Opened<Self>, String>;
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
