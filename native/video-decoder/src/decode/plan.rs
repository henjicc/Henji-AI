//! 连续取帧的纯逻辑（无 FFmpeg 依赖，可单元测试）：
//!
//! - **段**：从一个关键帧开始向前连续送包的一段解码。跳到别处（剪辑点、向后定位）开新段，播放计划中**不 flush**；
//!   旧段在解码器里尚未输出的帧（重排延迟）之后仍会输出，按“段的待出 PTS 集合”认领后丢弃。
//!   与浏览器后端的解码泵（`videoEditPlaybackDecoder.ts`）同一语义。
//! - **前导帧**：段内呈现时间早于段首关键帧的帧（开放 GOP 的 RASL/前导 B 帧）参考了段外画面，丢弃。
//! - **续解还是定位**：见 `seek_decision`。
//! - **预先接续的段**（3.6）：播放计划已知下一个剪辑点时，上一段所需的包送完就开始送下一段（`begin_queued`），
//!   解码器流水不空转、不丢弃预解的帧。此时正在交付的段（`active`）仍是上一段；下一段的帧出现即说明上一段已出完
//!   （`Claim::Queued`），计划走到剪辑点时 `activate_queued` 切换。

use std::collections::{HashMap, VecDeque};

#[derive(Debug)]
struct Run {
    id: u64,
    key_pts: i64,
    /// 已送入、尚未输出的 PTS（可能重复，计数）。
    pending: HashMap<i64, u32>,
}

/// 解码输出帧的归属。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Claim {
    /// 当前段的正常帧。
    Current,
    /// 当前段里早于段首关键帧的前导帧：丢弃。
    Leading,
    /// 旧段延迟输出的帧：丢弃。
    Stale,
    /// 不属于任何段（解码器自行丢弃了对应包后又出现的异常时间戳等）：丢弃。
    Unknown,
    /// 预先接续的下一段的帧：正在交付的段已出完，留给剪辑点之后。
    Queued,
}

#[derive(Debug, Default)]
pub struct RunTracker {
    runs: VecDeque<Run>,
    next_id: u64,
    /// 正在交付的段；通常是最新的段，预先接续时是倒数第二段。
    active: u64,
}

impl RunTracker {
    /// 开始新段（段首为 `key_pts` 的关键包）。返回段号。
    pub fn begin(&mut self, key_pts: i64) -> u64 {
        let id = self.push(key_pts);
        self.active = id;
        id
    }

    /// 预先接续下一段（段首为 `key_pts`）：之后送入的包属于它，但正在交付的仍是当前段。
    pub fn begin_queued(&mut self, key_pts: i64) -> u64 {
        self.push(key_pts)
    }

    /// 剪辑点到了：预先接续的段成为正在交付的段，上一段还没出的帧此后都作废。
    pub fn activate_queued(&mut self) {
        if let Some(run) = self.runs.back() {
            self.active = run.id;
        }
    }

    fn push(&mut self, key_pts: i64) -> u64 {
        self.next_id += 1;
        self.runs.push_back(Run { id: self.next_id, key_pts, pending: HashMap::new() });
        // 旧段最多保留几段：解码器延迟有限，更老的段不会再有输出。
        while self.runs.len() > 4 {
            self.runs.pop_front();
        }
        self.next_id
    }

    /// flush 之后解码器里已无旧帧：只保留当前段。
    pub fn flushed(&mut self) {
        while self.runs.len() > 1 {
            self.runs.pop_front();
        }
        if let Some(run) = self.runs.back_mut() {
            run.pending.clear();
        }
    }

    /// 正在交付的段（没有段时为 None）。
    pub fn current(&self) -> Option<u64> {
        self.runs.iter().any(|run| run.id == self.active).then_some(self.active)
    }

    #[cfg(test)]
    pub fn current_key_pts(&self) -> Option<i64> {
        self.runs.back().map(|run| run.key_pts)
    }

    /// 记录送入当前段的包。
    pub fn fed(&mut self, pts: i64) {
        if let Some(run) = self.runs.back_mut() {
            *run.pending.entry(pts).or_insert(0) += 1;
        }
    }

    /// 认领一帧输出。从最老的段开始找；一旦较新的段出帧，更老的段视为结束。
    pub fn claim(&mut self, pts: i64) -> Claim {
        let Some(position) = self.runs.iter().position(|run| run.pending.contains_key(&pts)) else {
            return Claim::Unknown;
        };
        let run = &mut self.runs[position];
        let count = run.pending.get_mut(&pts).expect("刚找到");
        *count -= 1;
        if *count == 0 {
            run.pending.remove(&pts);
        }
        let (id, key_pts) = (run.id, run.key_pts);
        for _ in 0..position {
            self.runs.pop_front();
        }
        if id < self.active {
            Claim::Stale
        } else if pts < key_pts {
            Claim::Leading
        } else if id > self.active {
            Claim::Queued
        } else {
            Claim::Current
        }
    }
}

/// 当前解码位置（决定下一个请求续解还是重新定位）。
#[derive(Debug, Clone, Copy, Default)]
pub struct Position {
    /// 当前段已送入的最后一个包的解码时间（刻度）。没有段时为 None。
    pub last_fed_dts: Option<i64>,
    /// 当前候选帧（≤ 上一个请求的最后一帧）的呈现时间。
    pub candidate_pts: Option<i64>,
    /// 当前段已解出（含前瞻帧）的最大呈现时间。
    pub latest_pts: Option<i64>,
    /// 解码器已排空到文件末尾。
    pub drained: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Decision {
    /// 沿当前段继续向前解。
    Continue,
    /// 定位到目标所在关键帧开新段。
    Seek,
}

/// 无索引容器向前超过该时长（秒）就定位，而不是一路解过去。
pub const FORWARD_SEEK_SECONDS: f64 = 3.0;

/// 下一个请求（刻度 `ticks`）应续解还是定位。
///
/// - `key_ticks`：容器索引给出的目标所在关键帧时间（解码时间刻度，无索引时为 None）；
/// - `forward_limit_ticks`：无索引时“向前多远就定位”的刻度量。
pub fn seek_decision(ticks: i64, position: &Position, key_ticks: Option<i64>, forward_limit_ticks: i64) -> Decision {
    let Some(last_fed) = position.last_fed_dts else { return Decision::Seek };
    // 候选帧之后没有更早的帧：目标落在候选帧与上一个请求之间时，候选帧就是答案。
    if let Some(candidate) = position.candidate_pts {
        if ticks >= candidate && position.latest_pts.is_none_or(|latest| ticks < latest) {
            return Decision::Continue;
        }
        if ticks < candidate {
            return Decision::Seek;
        }
    }
    if position.drained {
        // 已到文件末尾：更靠后的请求仍是最后一帧；更早的已在上面判定为定位。
        return Decision::Continue;
    }
    if let Some(latest) = position.latest_pts {
        if ticks < latest && position.candidate_pts.is_none() {
            return Decision::Seek;
        }
    }
    match key_ticks {
        // 目标关键帧在已送入的包之后：跳过中间的 GOP。
        Some(key) => {
            if key > last_fed {
                Decision::Seek
            } else {
                Decision::Continue
            }
        }
        None => {
            let reference = position.latest_pts.unwrap_or(last_fed);
            if ticks.saturating_sub(reference) > forward_limit_ticks {
                Decision::Seek
            } else {
                Decision::Continue
            }
        }
    }
}

/// 交出一帧前，上次交出之后解出（含丢弃）的帧数达到它就先等显卡完成（3.8）。连续播放每交出一帧只多解一帧，
/// 二倍速逐帧跳一帧，都低于它。
pub const SETTLE_BACKLOG_FRAMES: u64 = 3;

/// 交出一帧前对本服务显卡工作的等待（3.8）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HandoffWait {
    /// 不等，照常流水。
    None,
    /// 只等上一帧交出时的显卡工作完成：显卡上最多压着最近一两帧的工作，CPU 与显卡仍然重叠。
    Lagged,
    /// 等本设备已提交的工作全部完成。
    Full,
}

/// 交出这一帧前对本服务显卡工作的等待（3.8）。
///
/// 共享纹理在 CPU 侧提交写入后就交给客户端，客户端对它的读取在显卡上排在本服务尚未完成的工作之后。会话的第一帧
/// （硬件解码器刚建立）与定位后解过多帧才交出的帧，背后压着几十到上百毫秒的解码工作：客户端（Chromium 的 WebGPU
/// 队列）一读，整条队列连同界面上其他画面一起等待（composite-pressure 拖动中预取窗口的第一帧停顿 110–185ms）。
/// 这类帧在本进程里等完再交出（`Full`），客户端只承担它本来就要等的那一帧。
///
/// `paced`：有终点的区间取帧（拖动的一秒解码窗口，含预取）。窗口不服务播放时钟，却会一口气解完整个窗口，连发的
/// 解码与客户端的合成在显卡上争用（只等第一帧时合成仍多停约 33ms）。这类帧交出前等上一帧的工作完成（`Lagged`），
/// 显卡上始终只压一两帧，CPU 与显卡仍然重叠（逐帧等全部完成会让窗口变慢，拖动首帧多 140–290ms）。
/// 连续播放（时间点计划）、顺序读取（无终点区间）与单帧取帧照常流水。
/// - `delivered`：本会话已交出的帧数；
/// - `backlog`：上次交出之后本会话解出（含丢弃）的帧数。
pub fn handoff_wait(delivered: u64, backlog: u64, paced: bool) -> HandoffWait {
    if delivered == 0 || backlog >= SETTLE_BACKLOG_FRAMES {
        HandoffWait::Full
    } else if paced {
        HandoffWait::Lagged
    } else {
        HandoffWait::None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn waits_for_first_backlogged_and_paced_frames() {
        assert_eq!(handoff_wait(0, 0, false), HandoffWait::Full, "会话第一帧：解码器刚建立");
        assert_eq!(handoff_wait(0, 1, true), HandoffWait::Full);
        assert_eq!(handoff_wait(5, 1, false), HandoffWait::None, "连续播放：每交出一帧多解一帧");
        assert_eq!(handoff_wait(5, 2, false), HandoffWait::None, "二倍速：每交出一帧跳过一帧");
        assert_eq!(handoff_wait(5, SETTLE_BACKLOG_FRAMES, false), HandoffWait::Full, "定位后从关键帧解到目标");
        assert_eq!(handoff_wait(5, 60, true), HandoffWait::Full, "长 GOP 中段定位，窗口内也等全部");
        assert_eq!(handoff_wait(5, 1, true), HandoffWait::Lagged, "拖动的解码窗口：只压一两帧");
    }

    #[test]
    fn claims_current_leading_and_stale_frames() {
        let mut tracker = RunTracker::default();
        tracker.begin(1000);
        for pts in [1000, 1512, 1256, 1768] {
            tracker.fed(pts);
        }
        tracker.fed(744); // 开放 GOP 前导 B 帧（解码顺序在关键帧后）
        assert_eq!(tracker.claim(744), Claim::Leading);
        assert_eq!(tracker.claim(1000), Claim::Current);
        // 剪辑点：开新段（不 flush），旧段剩余帧随后输出。
        tracker.begin(5000);
        tracker.fed(5000);
        assert_eq!(tracker.claim(1256), Claim::Stale);
        assert_eq!(tracker.claim(1512), Claim::Stale);
        assert_eq!(tracker.claim(5000), Claim::Current);
        // 新段出帧后旧段已结束：旧段迟到的帧不再被认领。
        assert_eq!(tracker.claim(1768), Claim::Unknown);
        assert_eq!(tracker.claim(9999), Claim::Unknown);
    }

    #[test]
    fn repeated_section_after_cut_keeps_runs_apart() {
        // 同一片段重复两次（回到同一位置）：旧段延迟帧与新段的相同 PTS 分开认领。
        let mut tracker = RunTracker::default();
        tracker.begin(0);
        for pts in [0, 512, 256] {
            tracker.fed(pts);
        }
        assert_eq!(tracker.claim(0), Claim::Current);
        tracker.begin(0);
        tracker.fed(0);
        assert_eq!(tracker.claim(256), Claim::Stale);
        assert_eq!(tracker.claim(512), Claim::Stale);
        assert_eq!(tracker.claim(0), Claim::Current);
    }

    #[test]
    fn duplicate_pts_counted_and_flush_clears_old_runs() {
        let mut tracker = RunTracker::default();
        tracker.begin(0);
        tracker.fed(10);
        tracker.fed(10);
        assert_eq!(tracker.claim(10), Claim::Current);
        assert_eq!(tracker.claim(10), Claim::Current);
        assert_eq!(tracker.claim(10), Claim::Unknown);
        tracker.fed(20);
        tracker.begin(100);
        tracker.flushed();
        assert_eq!(tracker.claim(20), Claim::Unknown, "flush 后旧段帧不会再出现");
        assert_eq!(tracker.current_key_pts(), Some(100));
    }

    #[test]
    fn queued_run_is_delivered_after_the_active_run() {
        // 剪辑点预先接续（3.6）：上一段所需的包送完就送下一段，帧按送入顺序出。
        let mut tracker = RunTracker::default();
        let first = tracker.begin(100);
        for pts in [100, 101, 102] {
            tracker.fed(pts);
        }
        let queued = tracker.begin_queued(0);
        tracker.fed(0);
        tracker.fed(1);
        assert_eq!(tracker.current(), Some(first), "交付的仍是当前段");
        assert_eq!(tracker.claim(100), Claim::Current);
        assert_eq!(tracker.claim(101), Claim::Current);
        assert_eq!(tracker.claim(102), Claim::Current);
        assert_eq!(tracker.claim(0), Claim::Queued, "下一段的帧：当前段已出完");
        tracker.activate_queued();
        assert_eq!(tracker.current(), Some(queued));
        assert_eq!(tracker.claim(1), Claim::Current);
    }

    #[test]
    fn activating_early_drops_the_rest_of_the_previous_run() {
        // 剪辑点到达时上一段（含剪辑点之后多送的帧）还没出完：这些帧作废，下一段照常交付。
        let mut tracker = RunTracker::default();
        tracker.begin(100);
        for pts in [100, 101, 102] {
            tracker.fed(pts);
        }
        tracker.begin_queued(10);
        tracker.fed(10);
        tracker.activate_queued();
        assert_eq!(tracker.claim(101), Claim::Stale);
        assert_eq!(tracker.claim(102), Claim::Stale);
        assert_eq!(tracker.claim(10), Claim::Current);
        // 新段之后再开段（定位）：放弃的预接续段与正常段一样作废。
        tracker.fed(11);
        tracker.begin_queued(50);
        tracker.fed(50);
        tracker.begin(200);
        tracker.fed(200);
        assert_eq!(tracker.claim(11), Claim::Stale);
        assert_eq!(tracker.claim(50), Claim::Stale);
        assert_eq!(tracker.claim(200), Claim::Current);
    }

    #[test]
    fn continue_or_seek() {
        let limit = 3 * 15360;
        let fresh = Position::default();
        assert_eq!(seek_decision(0, &fresh, None, limit), Decision::Seek, "没有段先定位");
        let playing = Position { last_fed_dts: Some(5120), candidate_pts: Some(4096), latest_pts: Some(4352), drained: false };
        assert_eq!(seek_decision(4352, &playing, Some(0), limit), Decision::Continue, "下一帧");
        assert_eq!(seek_decision(4200, &playing, Some(0), limit), Decision::Continue, "落在候选与前瞻之间仍是候选");
        assert_eq!(seek_decision(4000, &playing, Some(0), limit), Decision::Seek, "向后");
        assert_eq!(seek_decision(20000, &playing, Some(15360), limit), Decision::Seek, "目标关键帧在已送入之后");
        assert_eq!(seek_decision(20000, &playing, Some(0), limit), Decision::Continue, "同一 GOP 内向前");
        assert_eq!(seek_decision(20000, &playing, None, limit), Decision::Continue, "无索引且不远");
        assert_eq!(seek_decision(4352 + limit + 1, &playing, None, limit), Decision::Seek, "无索引且很远");
        let ended = Position { drained: true, ..playing };
        assert_eq!(seek_decision(99999, &ended, Some(15360), limit), Decision::Continue, "末尾之后仍是最后一帧");
        assert_eq!(seek_decision(100, &ended, Some(0), limit), Decision::Seek);
    }
}
