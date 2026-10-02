//! 平台层边界（重要记录 011）：显卡设备、硬件解码设备、跨进程共享纹理池与显卡格式转换都在这里的接口之后。
//!
//! 跨平台模块（协议、探测、解码会话与取帧计划 `decode/`、像素格式与色彩策略 `convert/`、流管理 `streams`）只依赖
//! 本模块的接口与类型，不直接接触 D3D11/`windows` crate。Windows 实现在 `platform/windows/`（D3D11 设备、
//! D3D11VA、NT 句柄共享纹理、HLSL 计算着色器）；将来的 macOS 实现（VideoToolbox + IOSurface + Metal）
//! 按同一接口另放 `platform/macos/`。

use std::sync::Arc;
use std::thread::JoinHandle;

use ffmpeg_sys_next as ff;
use serde_json::{json, Value};

use crate::convert::{ColorInfo, WritePath};
use crate::streams::{StreamControl, StreamResources, TestStreamOptions};
use crate::test_pattern::SharedFormat;

#[cfg(windows)]
mod windows;

/// 一帧写入的耗时分解。
#[derive(Debug, Default, Clone, Copy)]
pub struct WriteStats {
    /// CPU 侧复制（上传缓冲/中转纹理）耗时。
    pub upload_us: u64,
    /// 显卡命令提交（复制/着色器/同步）耗时。
    pub submit_us: u64,
    /// 其中等待映射上传缓冲的耗时（包含在 `upload_us` 内）。
    pub map_us: u64,
}

/// 一个解码会话的输出：客户端可导入的共享纹理池，以及把解码帧写入其中一个槽位的转换器。
pub trait FrameOutput: Send {
    /// 每个槽位在客户端进程中的句柄值（槽位号即下标）。
    fn remote_handles(&self) -> Vec<u64>;

    /// 把一帧写入槽位 `slot`。写完返回时客户端即可导入。
    ///
    /// # Safety
    /// `frame` 必须是有效的 `AVFrame`；硬件帧须来自本平台 `hardware_device()` 给出的设备。
    unsafe fn write(&mut self, frame: *const ff::AVFrame, slot: u32, path: WritePath, color: &ColorInfo, premultiplied: bool) -> Result<WriteStats, String>;

    /// 是否用过罕见像素格式的 CPU 转换回落。
    fn cpu_fallback_used(&self) -> bool;

    /// 会话结束：释放转换资源，交回纹理池（`stop_stream` 时关闭客户端句柄）。
    fn into_resources(self: Box<Self>) -> Box<dyn StreamResources>;
}

/// FFmpeg 硬件解码设备（新的一份引用，交给解码器上下文持有）。
pub struct HardwareDevice {
    pub device_type: ff::AVHWDeviceType,
    pub reference: *mut ff::AVBufferRef,
}

/// 合成测试画面流（1.2 通道验证）。
pub struct TestStream {
    pub thread: JoinHandle<Box<dyn StreamResources>>,
    pub handles: Vec<u64>,
    pub layout: Value,
}

pub trait VideoPlatform: Send + Sync {
    /// 握手里的设备信息（字段名沿用 `d3d11`，见协议）。
    fn summary(&self) -> Value;
    /// 登记客户端进程（共享纹理句柄的复制目标）。
    fn register_client(&self, pid: u32) -> Result<(), String>;
    fn client_ready(&self) -> bool;
    /// 关闭上一个服务进程遗留在客户端进程里的句柄。
    fn close_client_handle(&self, handle: u64) -> Result<(), String>;
    /// 本进程显存占用与预算（字节）。
    fn local_memory(&self) -> Option<(u64, u64)>;
    /// 硬件解码设备；不可用时返回原因（会话改用软解）。
    fn hardware_device(&self) -> Result<HardwareDevice, String>;
    /// 设备是否有某个硬件解码配置（名字见握手 `videoDecoderProfiles.named`）。
    fn has_decoder_profile(&self, name: &str) -> bool;
    /// 为解码会话建立输出（纹理池 + 转换器）。
    fn create_frame_output(&self, format: SharedFormat, pool: (u32, u32), visible: (u32, u32), count: u32) -> Result<Box<dyn FrameOutput>, String>;
    /// 启动合成测试画面流。
    fn start_test_stream(&self, options: &TestStreamOptions, control: Arc<StreamControl>) -> Result<TestStream, String>;
}

/// 创建本平台实现。不支持的平台或设备不可用时返回原因。
pub fn create() -> Result<Arc<dyn VideoPlatform>, String> {
    #[cfg(windows)]
    {
        windows::WindowsPlatform::create().map(|platform| Arc::new(platform) as Arc<dyn VideoPlatform>)
    }
    #[cfg(not(windows))]
    {
        Err("原生视频解码当前只支持 Windows".into())
    }
}

/// 本进程累计 CPU 时间（毫秒）与句柄数（不支持的平台为 0）。
pub fn process_usage() -> (f64, u32) {
    #[cfg(windows)]
    {
        windows::process_usage()
    }
    #[cfg(not(windows))]
    {
        (0.0, 0)
    }
}

/// 设备创建失败时握手仍返回，标明不可用原因，由主进程决定回退。
pub fn unavailable_summary(reason: &str) -> Value {
    json!({ "available": false, "reason": reason })
}
