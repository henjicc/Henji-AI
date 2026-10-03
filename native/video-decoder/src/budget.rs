//! 资源预算（3.1）：解码会话数、显存与硬件解码器并发的统一上限。
//!
//! - 显存：每个解码会话在建纹理池之前按“共享纹理池 + 转换中间纹理 + 硬解表面”估算并登记，所有会话的登记总和
//!   超过上限时拒绝打开（`BUDGET_EXCEEDED`，渲染层就地提示），会话结束时归还。用估算而不是系统报告的实际占用：
//!   结果确定、可测，且不受同一时刻其他会话正在分配的影响。估算口径见 `session_bytes`。
//! - 硬解并发：同时使用硬件解码器的会话达到上限后，之后的会话改用软解（只多占 CPU，不失败）。
//! - 会话数：所有窗口合计的解码会话上限（每窗口另有主进程的上限）。
//!
//! 上限按所选显卡的专用显存确定（`Limits::for_adapter`）；主进程只在诊断时覆盖（`hello.limits`）。
//! 参数依据记在 3.1 执行记录。

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde::Deserialize;
use serde_json::{json, Value};

use crate::convert::WritePath;
use crate::protocol::ServiceError;
use crate::test_pattern::SharedFormat;

/// 硬解会话的表面池：参考帧（H.264/HEVC 最多 16）+ FFmpeg 额外帧（`extra_hw_frames = 4`）。
pub const HARDWARE_SURFACES: u64 = 20;
const GIB: u64 = 1024 * 1024 * 1024;
/// 解码显存占专用显存的比例与上下限：其余留给剪辑帧缓存（节目 8GiB、源监视器 3GiB 是上限而不是常驻）与合成。
pub const VRAM_SHARE: f64 = 0.4;
pub const MIN_VRAM_BYTES: u64 = 3 * GIB / 2;
pub const MAX_VRAM_BYTES: u64 = 8 * GIB;
pub const DEFAULT_HARDWARE_SESSIONS: usize = 16;
pub const DEFAULT_DECODER_SESSIONS: usize = 32;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Limits {
    pub vram_bytes: u64,
    pub hardware_sessions: usize,
    pub decoder_sessions: usize,
}

impl Limits {
    /// 按显卡专用显存（MiB）确定上限；读不到时取上限值（设备不可用时本来也打不开会话）。
    pub fn for_adapter(dedicated_mib: Option<u64>) -> Self {
        let vram_bytes = dedicated_mib.map_or(MAX_VRAM_BYTES, |mib| ((mib as f64 * VRAM_SHARE) as u64 * 1024 * 1024).clamp(MIN_VRAM_BYTES, MAX_VRAM_BYTES));
        Self { vram_bytes, hardware_sessions: DEFAULT_HARDWARE_SESSIONS, decoder_sessions: DEFAULT_DECODER_SESSIONS }
    }

    pub fn with(self, overrides: LimitOverrides) -> Self {
        Self {
            vram_bytes: overrides.vram_bytes.unwrap_or(self.vram_bytes),
            hardware_sessions: overrides.hardware_sessions.unwrap_or(self.hardware_sessions),
            decoder_sessions: overrides.decoder_sessions.unwrap_or(self.decoder_sessions),
        }
    }
}

impl Default for Limits {
    fn default() -> Self {
        Self::for_adapter(None)
    }
}

/// 握手里的上限覆盖（诊断：缩小预算以验证超限提示）；缺省项保持按显卡确定的值。
#[derive(Debug, Clone, Copy, PartialEq, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LimitOverrides {
    #[serde(default)]
    pub vram_bytes: Option<u64>,
    #[serde(default)]
    pub hardware_sessions: Option<usize>,
    #[serde(default)]
    pub decoder_sessions: Option<usize>,
}

/// 一帧共享纹理的字节数。
pub fn frame_bytes(format: SharedFormat, (width, height): (u32, u32)) -> u64 {
    let pixels = width as u64 * height as u64;
    match format {
        SharedFormat::Nv12 => pixels * 3 / 2,
        SharedFormat::Nv16 => pixels * 2,
        SharedFormat::P010le => pixels * 3,
        SharedFormat::Rgba | SharedFormat::Bgra => pixels * 4,
        SharedFormat::Rgbaf16 => pixels * 8,
    }
}

/// 一个解码会话的显存估算：共享纹理池、该写入路径在显存里的中间资源、硬解表面池。
/// STAGING 上传环在系统内存，不计入。
pub fn session_bytes(output: SharedFormat, pool: (u32, u32), slots: u32, path: WritePath, hardware_surface: Option<SharedFormat>) -> u64 {
    let pixels = pool.0 as u64 * pool.1 as u64;
    let intermediate = match path {
        WritePath::CopyNv12 | WritePath::UploadNv12 => 0,
        // P010 中间纹理 + 着色器写入的 rgbaf16 私有纹理。
        WritePath::ShaderSemiPlanar => pixels * 3 + pixels * 8,
        // 显存上传缓冲（最多 4:4:4 + 透明 16 位）+ rgbaf16 私有纹理。
        WritePath::ShaderPlanar | WritePath::CpuFallback => pixels * 8 + pixels * 8,
    };
    let surfaces = hardware_surface.map_or(0, |format| HARDWARE_SURFACES * frame_bytes(format, pool));
    slots as u64 * frame_bytes(output, pool) + intermediate + surfaces
}

#[derive(Default)]
struct Usage {
    limits: Limits,
    /// 会话 → 登记的显存字节数。
    reserved: HashMap<String, u64>,
    hardware: usize,
    peak_reserved: u64,
}

/// 全服务共享的预算账本。
#[derive(Clone, Default)]
pub struct Budget {
    usage: Arc<Mutex<Usage>>,
}

/// 硬解名额：会话实际用上硬件解码器时保留，结束时归还。
pub struct HardwareTicket {
    usage: Arc<Mutex<Usage>>,
}

impl Drop for HardwareTicket {
    fn drop(&mut self) {
        let mut usage = self.usage.lock().unwrap();
        usage.hardware = usage.hardware.saturating_sub(1);
    }
}

/// 显存登记：会话结束（或打开失败）时归还。
pub struct VramTicket {
    usage: Arc<Mutex<Usage>>,
    stream_id: String,
}

impl Drop for VramTicket {
    fn drop(&mut self) {
        self.usage.lock().unwrap().reserved.remove(&self.stream_id);
    }
}

impl Budget {
    pub fn new(limits: Limits) -> Self {
        let budget = Self::default();
        budget.set_limits(limits);
        budget
    }

    pub fn set_limits(&self, limits: Limits) {
        self.usage.lock().unwrap().limits = limits;
    }

    pub fn override_limits(&self, overrides: LimitOverrides) {
        let mut usage = self.usage.lock().unwrap();
        usage.limits = usage.limits.with(overrides);
    }

    /// 还能再开一个解码会话吗（`open` 是包括正在打开的全部会话数）。
    pub fn admit_session(&self, open: usize) -> Result<(), ServiceError> {
        let limit = self.usage.lock().unwrap().limits.decoder_sessions;
        if open >= limit {
            return Err(ServiceError::new("BUDGET_EXCEEDED", format!("同时打开的解码会话已达上限（{limit}）")));
        }
        Ok(())
    }

    /// 申请一个硬解名额；已达上限返回 None（该会话改用软解）。
    pub fn hardware(&self) -> Option<HardwareTicket> {
        let mut usage = self.usage.lock().unwrap();
        if usage.hardware >= usage.limits.hardware_sessions {
            return None;
        }
        usage.hardware += 1;
        Some(HardwareTicket { usage: self.usage.clone() })
    }

    /// 为会话登记显存；总和超过上限时拒绝。
    pub fn reserve_vram(&self, stream_id: &str, bytes: u64) -> Result<VramTicket, ServiceError> {
        let mut usage = self.usage.lock().unwrap();
        let reserved: u64 = usage.reserved.values().sum();
        let limit = usage.limits.vram_bytes;
        if reserved + bytes > limit {
            return Err(ServiceError::new(
                "BUDGET_EXCEEDED",
                format!("解码显存预算不足：已用 {} MiB，本会话需 {} MiB，上限 {} MiB", reserved >> 20, bytes >> 20, limit >> 20),
            ));
        }
        usage.reserved.insert(stream_id.to_string(), bytes);
        usage.peak_reserved = usage.peak_reserved.max(reserved + bytes);
        Ok(VramTicket { usage: self.usage.clone(), stream_id: stream_id.to_string() })
    }

    pub fn stats(&self) -> Value {
        let usage = self.usage.lock().unwrap();
        json!({
            "vramLimitBytes": usage.limits.vram_bytes,
            "vramReservedBytes": usage.reserved.values().sum::<u64>(),
            "vramPeakReservedBytes": usage.peak_reserved,
            "hardwareSessions": usage.hardware,
            "hardwareSessionLimit": usage.limits.hardware_sessions,
            "decoderSessionLimit": usage.limits.decoder_sessions,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const UHD: (u32, u32) = (3840, 2160);

    #[test]
    fn estimates_follow_measured_session_sizes() {
        let mib = |bytes: u64| bytes >> 20;
        // H.264 4K 硬解播放会话：8 张 nv12 + 20 张解码表面（1.3 实测单路 0.4–0.6GiB）。
        assert_eq!(mib(session_bytes(SharedFormat::Nv12, UHD, 8, WritePath::CopyNv12, Some(SharedFormat::Nv12))), 332);
        // ProRes 4K 软解播放会话：6 张 rgbaf16 + 上传缓冲 + 私有纹理（1.3 实测 0.45–0.8GiB）。
        assert_eq!(mib(session_bytes(SharedFormat::Rgbaf16, UHD, 6, WritePath::ShaderPlanar, None)), 506);
        // HEVC Main10 4K 硬解播放会话：rgbaf16 池 + P010 中间纹理 + 私有纹理 + P010 解码表面。
        assert_eq!(mib(session_bytes(SharedFormat::Rgbaf16, UHD, 6, WritePath::ShaderSemiPlanar, Some(SharedFormat::P010le))), 941);
    }

    #[test]
    fn vram_reservations_are_bounded_and_returned() {
        let budget = Budget::default();
        budget.set_limits(Limits { vram_bytes: 1000, hardware_sessions: 1, decoder_sessions: 2 });
        let first = budget.reserve_vram("a", 600).unwrap();
        let error = budget.reserve_vram("b", 500).err().unwrap();
        assert_eq!(error.code, "BUDGET_EXCEEDED");
        drop(first);
        let second = budget.reserve_vram("b", 500).unwrap();
        assert_eq!(budget.stats()["vramReservedBytes"], 500);
        assert_eq!(budget.stats()["vramPeakReservedBytes"], 600);
        drop(second);
        assert_eq!(budget.stats()["vramReservedBytes"], 0);
    }

    #[test]
    fn hardware_slots_fall_back_to_software_and_sessions_are_limited() {
        let budget = Budget::default();
        budget.set_limits(Limits { vram_bytes: u64::MAX, hardware_sessions: 1, decoder_sessions: 2 });
        let ticket = budget.hardware().expect("第一个会话可以硬解");
        assert!(budget.hardware().is_none(), "达到上限后改用软解");
        drop(ticket);
        assert!(budget.hardware().is_some());
        assert!(budget.admit_session(1).is_ok());
        assert_eq!(budget.admit_session(2).unwrap_err().code, "BUDGET_EXCEEDED");
    }

    #[test]
    fn limits_follow_the_adapter_and_accept_partial_overrides() {
        // 24GiB（RTX 4090）→ 封顶 8GiB；8GiB → 3.2GiB；3GiB → 保底 1.5GiB。
        assert_eq!(Limits::for_adapter(Some(24_138)).vram_bytes, MAX_VRAM_BYTES);
        assert_eq!(Limits::for_adapter(Some(8_192)).vram_bytes >> 20, 3276);
        assert_eq!(Limits::for_adapter(Some(3_072)).vram_bytes, MIN_VRAM_BYTES);
        let overrides: LimitOverrides = serde_json::from_str(r#"{"vramBytes":629145600}"#).unwrap();
        let limits = Limits::for_adapter(Some(24_138)).with(overrides);
        assert_eq!(limits, Limits { vram_bytes: 600 << 20, hardware_sessions: DEFAULT_HARDWARE_SESSIONS, decoder_sessions: DEFAULT_DECODER_SESSIONS });
    }
}
