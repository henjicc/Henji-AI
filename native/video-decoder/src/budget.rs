//! 资源预算（3.1）：解码显存账本。
//!
//! - 登记：每个解码会话在建纹理池之前按“共享纹理池 + 转换中间纹理 + 硬解表面”估算并登记，会话结束时归还。用估算而不是
//!   系统报告的实际占用：结果确定、可测，且不受同一时刻其他会话正在分配的影响。估算口径见 `session_bytes`。
//! - 预算只是淘汰目标，不是准入门槛（参照 PR / 达芬奇：资源不够时淘汰缓存、降回放，不让某一帧报错）：打开会话一律登记
//!   成功。拖动留存帧（`extend_vram` 追加的部分）只在“预算 − 前台保留”之内登记，前台保留留给新会话直接用；登记总和
//!   超过预算本身时才收回最久没用的留存帧（会话线程随后放掉纹理）。会话本身超出预算时只记日志，由渲染层淘汰不在当前
//!   画面的闲置会话，能共享的读取（独占读取者、同一素材的第二个播放计划、拖动图层自己的会话、提前打开）不再另开会话
//!   （`videoEditNativeFrameSource.ts`）；淘汰不动就照常超出，驱动把显存换出到内存，变慢而不失败。
//! - 不限会话数与硬解路数：驱动拒绝新的硬件解码器时 FFmpeg 改用软解（`codec.rs` 的 `get_format`），只有拿不到显卡
//!   解码器才软解。硬解会话只计数供诊断。
//!
//! 预算按所选显卡的专用显存确定（`Limits::for_adapter`）；主进程只在诊断时覆盖（`hello.limits`）。

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

use serde::Deserialize;
use serde_json::{json, Value};

use crate::convert::WritePath;
use crate::logging;
use crate::test_pattern::SharedFormat;

/// 硬解会话的表面池：参考帧（H.264/HEVC 最多 16）+ FFmpeg 额外帧（`extra_hw_frames = 4`）。
pub const HARDWARE_SURFACES: u64 = 20;
const GIB: u64 = 1024 * 1024 * 1024;
/// 解码显存预算占专用显存的比例。其余留给合成与剪辑帧缓存；它们与本预算一样只是淘汰目标，偶尔叠加超出时驱动把显存
/// 换出到内存，变慢而不失败。
pub const VRAM_SHARE: f64 = 0.75;
/// 集成显卡报告的专用显存只有几百 MiB（画面实际放在共享内存），按这个下限取。
pub const MIN_VRAM_BYTES: u64 = 3 * GIB / 2;
/// 读不到显卡时的取值：这时也打不开解码会话，只影响诊断显示。
pub const UNKNOWN_ADAPTER_VRAM_BYTES: u64 = 8 * GIB;
/// 一个会话的拖动留存帧至多占预算的几分之一：RTX 4090（18GiB 预算）为 4.5GiB，约 68 帧 4K rgbaf16 或 370 帧 4K nv12。
const RETAIN_SHARE: u64 = 4;
/// 留存帧之外给前台留出的最大会话数：正在拖的文件旁边还要能预打开下一个镜头、起播。
const FOREGROUND_SESSIONS_KEPT: u64 = 3;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Limits {
    pub vram_bytes: u64,
}

impl Limits {
    /// 按显卡专用显存（MiB）确定预算。
    pub fn for_adapter(dedicated_mib: Option<u64>) -> Self {
        let vram_bytes = dedicated_mib.map_or(UNKNOWN_ADAPTER_VRAM_BYTES, |mib| ((mib as f64 * VRAM_SHARE) as u64 * 1024 * 1024).max(MIN_VRAM_BYTES));
        Self { vram_bytes }
    }

    pub fn with(self, overrides: LimitOverrides) -> Self {
        Self { vram_bytes: overrides.vram_bytes.unwrap_or(self.vram_bytes) }
    }
}

impl Default for Limits {
    fn default() -> Self {
        Self::for_adapter(None)
    }
}

/// 握手里的预算覆盖（诊断：把预算压小，验证先收回留存帧、渲染层先退回共享会话而不报错）；缺省保持按显卡确定的值。
#[derive(Debug, Clone, Copy, PartialEq, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LimitOverrides {
    #[serde(default)]
    pub vram_bytes: Option<u64>,
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
pub fn session_bytes(output: SharedFormat, pool: (u32, u32), slots: u32, path: WritePath, hardware_surface: Option<SharedFormat>, hardware_surfaces: u64) -> u64 {
    let pixels = pool.0 as u64 * pool.1 as u64;
    let intermediate = match path {
        WritePath::CopyNv12 | WritePath::UploadNv12 => 0,
        // P010 中间纹理 + 着色器写入的 rgbaf16 私有纹理。
        WritePath::ShaderSemiPlanar => pixels * 3 + pixels * 8,
        // CUDA 解码平面、同适配器互操作缓冲与 rgbaf16 转换目标。
        WritePath::CudaPlanar => pool.0.next_multiple_of(512) as u64 * pool.1 as u64 * 3 * (hardware_surfaces + 1) + pixels * 8,
        // 显存上传缓冲（最多 4:4:4 + 透明 16 位）+ rgbaf16 私有纹理。
        WritePath::ShaderPlanar | WritePath::CpuFallback => pixels * 8 + pixels * 8,
    };
    let surfaces = hardware_surface.map_or(0, |format| hardware_surfaces * frame_bytes(format, pool));
    slots as u64 * frame_bytes(output, pool) + intermediate + surfaces
}

/// 一个会话的登记：会话本身与拖动留存帧分开记，留存帧可被收回。
struct Entry {
    session: u64,
    retained: u64,
    /// 最近一次用到留存帧的序号（`Usage::clock`）：收回时最久没用的先收。
    used: u64,
}

#[derive(Default)]
struct Usage {
    limits: Limits,
    entries: HashMap<String, Entry>,
    /// 留存帧已被收回、会话线程还没放掉纹理的会话（`Budget::take_revoked`）。
    revoked: HashSet<String>,
    hardware: usize,
    peak_reserved: u64,
    /// 已实际登记过的最大单会话，用于给前台保留余量；不由渲染层估算。
    largest_session: u64,
    clock: u64,
    /// 会话本身的登记已超出预算（只在越过时记一次日志）。
    over: bool,
}

impl Usage {
    fn reserved(&self) -> u64 {
        self.entries.values().map(|entry| entry.session + entry.retained).sum()
    }

    fn retained(&self) -> u64 {
        self.entries.values().map(|entry| entry.retained).sum()
    }

    /// 留存帧不占用的前台余量。
    fn keep(&self) -> u64 {
        self.largest_session.max(self.limits.vram_bytes / 8) * FOREGROUND_SESSIONS_KEPT
    }

    fn tick(&mut self) -> u64 {
        self.clock += 1;
        self.clock
    }

    /// 收回留存帧（最久没用的先收），直到登记总和不超过 `ceiling` 或没有可收的；返回被收回的（会话，字节）。
    fn reclaim(&mut self, ceiling: u64) -> Vec<(String, u64)> {
        let mut total = self.reserved();
        let mut holders: Vec<(u64, String)> = self.entries.iter().filter(|(_, entry)| entry.retained > 0).map(|(id, entry)| (entry.used, id.clone())).collect();
        holders.sort();
        let mut reclaimed = Vec::new();
        for (_, id) in holders {
            if total <= ceiling {
                break;
            }
            let Some(entry) = self.entries.get_mut(&id) else { continue };
            total -= entry.retained;
            reclaimed.push((id.clone(), entry.retained));
            entry.retained = 0;
            self.revoked.insert(id);
        }
        reclaimed
    }
}

/// 全服务共享的预算账本。
#[derive(Clone, Default)]
pub struct Budget {
    usage: Arc<Mutex<Usage>>,
}

/// 硬解会话计数（诊断）：会话实际用上硬件解码器时持有，结束时归还。
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
        let mut usage = self.usage.lock().unwrap();
        usage.entries.remove(&self.stream_id);
        usage.revoked.remove(&self.stream_id);
        if usage.over && usage.reserved() <= usage.limits.vram_bytes {
            usage.over = false;
        }
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

    /// 硬解会话计数。
    pub fn hardware(&self) -> HardwareTicket {
        self.usage.lock().unwrap().hardware += 1;
        HardwareTicket { usage: self.usage.clone() }
    }

    /// 为会话登记显存。总是成功：登记总和超过预算时先收回最久没用的留存帧（前台保留之内的新会话不收回）；会话本身
    /// 超出预算时记一次日志，由渲染层淘汰闲置会话、能共享的读取不再另开会话。
    pub fn reserve_vram(&self, stream_id: &str, bytes: u64) -> VramTicket {
        let (reclaimed, over) = {
            let mut usage = self.usage.lock().unwrap();
            usage.entries.insert(stream_id.to_string(), Entry { session: bytes, retained: 0, used: 0 });
            usage.largest_session = usage.largest_session.max(bytes);
            let ceiling = usage.limits.vram_bytes;
            let reclaimed = usage.reclaim(ceiling);
            let reserved = usage.reserved();
            usage.peak_reserved = usage.peak_reserved.max(reserved);
            let crossed = reserved > usage.limits.vram_bytes && !usage.over;
            if crossed {
                usage.over = true;
            }
            (reclaimed, crossed.then(|| json!({ "streamId": stream_id, "sessionBytes": bytes, "reservedBytes": reserved, "limitBytes": usage.limits.vram_bytes })))
        };
        if !reclaimed.is_empty() {
            let bytes: u64 = reclaimed.iter().map(|(_, bytes)| bytes).sum();
            logging::info("decode.budget.retain_reclaimed", "打开解码会话时收回拖动留存帧", json!({ "streamId": stream_id, "from": reclaimed.iter().map(|(id, _)| id).collect::<Vec<_>>(), "bytes": bytes }));
        }
        if let Some(context) = over {
            logging::warn("decode.budget.over_target", "解码会话登记超出显存预算，照常打开并由渲染层淘汰闲置会话", context);
        }
        VramTicket { usage: self.usage.clone(), stream_id: stream_id.to_string() }
    }

    /// 给已登记的会话追加拖动留存帧的显存，返回追加的字节数：至多预算的 `1/RETAIN_SHARE`，且不占前台保留
    /// （`FOREGROUND_SESSIONS_KEPT` 个最大会话）。追加部分随会话归还，或在之后打开会话时被收回（`take_revoked`）。
    pub fn extend_vram(&self, stream_id: &str) -> u64 {
        let mut usage = self.usage.lock().unwrap();
        let reserved = usage.reserved();
        let room = usage.limits.vram_bytes.saturating_sub(reserved).saturating_sub(usage.keep());
        let granted = (usage.limits.vram_bytes / RETAIN_SHARE).min(room);
        let clock = usage.tick();
        let Some(entry) = usage.entries.get_mut(stream_id) else { return 0 };
        entry.retained += granted;
        entry.used = clock;
        usage.peak_reserved = usage.peak_reserved.max(reserved + granted);
        granted
    }

    /// 显存真的分配失败时收回全部留存帧（`decode/mod.rs` 打开会话的重试），返回收回的字节数。
    pub fn revoke_all_retained(&self) -> u64 {
        let mut usage = self.usage.lock().unwrap();
        let retained = usage.retained();
        usage.reclaim(0);
        retained
    }

    /// 会话用到了它的留存帧：收回时排到后面。
    pub fn touch_retained(&self, stream_id: &str) {
        let mut usage = self.usage.lock().unwrap();
        let clock = usage.tick();
        if let Some(entry) = usage.entries.get_mut(stream_id) {
            entry.used = clock;
        }
    }

    /// 会话的留存帧是否已被收回（取出即清除）：会话线程据此放掉留存纹理，之后按当时的余量重新登记。
    pub fn take_revoked(&self, stream_id: &str) -> bool {
        self.usage.lock().unwrap().revoked.remove(stream_id)
    }

    pub fn stats(&self) -> Value {
        let usage = self.usage.lock().unwrap();
        json!({
            "vramLimitBytes": usage.limits.vram_bytes,
            "vramReservedBytes": usage.reserved(),
            "vramRetainedBytes": usage.retained(),
            "vramPeakReservedBytes": usage.peak_reserved,
            "largestSessionBytes": usage.largest_session,
            // 尚无实测会话时先为前台留一半额度，允许空白起点预打开首个文件；后续用实测最大值。
            "foregroundReserveBytes": if usage.largest_session == 0 { usage.limits.vram_bytes.div_ceil(2) } else { usage.largest_session },
            "hardwareSessions": usage.hardware,
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
        assert_eq!(mib(session_bytes(SharedFormat::Nv12, UHD, 8, WritePath::CopyNv12, Some(SharedFormat::Nv12), HARDWARE_SURFACES)), 332);
        // ProRes 4K 软解播放会话：6 张 rgbaf16 + 上传缓冲 + 私有纹理（1.3 实测 0.45–0.8GiB）。
        assert_eq!(mib(session_bytes(SharedFormat::Rgbaf16, UHD, 6, WritePath::ShaderPlanar, None, HARDWARE_SURFACES)), 506);
        // HEVC Main10 4K 硬解播放会话：rgbaf16 池 + P010 中间纹理 + 私有纹理 + P010 解码表面。
        assert_eq!(mib(session_bytes(SharedFormat::Rgbaf16, UHD, 6, WritePath::ShaderSemiPlanar, Some(SharedFormat::P010le), HARDWARE_SURFACES)), 941);
    }

    #[test]
    fn sessions_past_the_budget_are_admitted_and_returned() {
        let budget = Budget::new(Limits { vram_bytes: 1000 });
        assert_eq!(budget.stats()["foregroundReserveBytes"], 500);
        let first = budget.reserve_vram("a", 600);
        // 预算只是淘汰目标：超出照常登记，不拒绝当前帧需要的会话。
        let second = budget.reserve_vram("b", 500);
        assert_eq!(budget.stats()["vramReservedBytes"], 1100);
        drop(first);
        assert_eq!(budget.stats()["vramReservedBytes"], 500);
        assert_eq!(budget.stats()["vramPeakReservedBytes"], 1100);
        drop(second);
        assert_eq!(budget.stats()["vramReservedBytes"], 0);
        assert_eq!(budget.stats()["largestSessionBytes"], 600);
        assert_eq!(budget.stats()["foregroundReserveBytes"], 600);
    }

    #[test]
    fn retained_frames_leave_room_for_the_foreground_and_give_way_only_past_the_budget() {
        let budget = Budget::new(Limits { vram_bytes: 16_000 });
        let a = budget.reserve_vram("a", 1000);
        let b = budget.reserve_vram("b", 1000);
        // 每个会话至多预算的 1/4；前台保留 3 × max(最大会话, 预算/8) = 6000。
        assert_eq!(budget.extend_vram("a"), 4000);
        assert_eq!(budget.extend_vram("b"), 4000, "16000 − 2000 − 4000 − 6000 = 4000");
        assert_eq!(budget.extend_vram("a"), 0, "余量已到前台保留线");
        assert_eq!(budget.stats()["vramRetainedBytes"], 8000);
        assert_eq!(budget.stats()["foregroundReserveBytes"], 1000, "追加部分不算会话大小");
        budget.touch_retained("a");
        // 前台保留之内的新会话（含提前打开）直接用余量，不收回留存帧。
        let c = budget.reserve_vram("c", 1000);
        let d = budget.reserve_vram("d", 1000);
        assert!(!budget.take_revoked("a") && !budget.take_revoked("b"));
        assert_eq!(budget.stats()["vramReservedBytes"], 12_000);
        // 越过预算本身才收回，最久没用的（b）先收，a 刚用过留着。
        let e = budget.reserve_vram("e", 5000);
        assert!(budget.take_revoked("b"));
        assert!(!budget.take_revoked("b"), "取出即清除");
        assert!(!budget.take_revoked("a"));
        assert_eq!(budget.stats()["vramRetainedBytes"], 4000);
        assert_eq!(budget.stats()["vramReservedBytes"], 13_000);
        // 被收回的会话之后按当时的余量重新登记：前台保留之外已没有余量。
        assert_eq!(budget.extend_vram("b"), 0);
        assert_eq!(budget.extend_vram("missing"), 0);
        drop(a);
        assert_eq!(budget.stats()["vramReservedBytes"], 8000, "追加部分随会话归还");
        drop((b, c, d, e));
    }

    #[test]
    fn limits_follow_the_adapter_and_accept_overrides() {
        // 24GiB（RTX 4090）→ 75% 不封顶；8GiB → 6GiB；集成显卡 512MiB → 下限 1.5GiB。
        assert_eq!(Limits::for_adapter(Some(24_138)).vram_bytes >> 20, 18_103);
        assert_eq!(Limits::for_adapter(Some(8_192)).vram_bytes >> 20, 6_144);
        assert_eq!(Limits::for_adapter(Some(512)).vram_bytes, MIN_VRAM_BYTES);
        // 旧握手里的会话数覆盖字段已无含义，忽略。
        let overrides: LimitOverrides = serde_json::from_str(r#"{"vramBytes":629145600,"decoderSessions":8}"#).unwrap();
        assert_eq!(Limits::for_adapter(Some(24_138)).with(overrides), Limits { vram_bytes: 600 << 20 });
    }
}
