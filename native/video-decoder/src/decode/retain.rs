//! 拖动留存帧的纯逻辑（无 FFmpeg / 显卡依赖，可单元测试）：哪些帧留下、一个时间落在哪一幅、满了丢哪一幅。
//!
//! 长 GOP 倒拖时每一步都在解码器位置之前，只能回到关键帧重解；解出的几十帧原先只交出目标一幅。拖动读取带 `retain` 时，
//! 会话把解出的每一帧复制一份留在本服务显存（纹理由平台层按 `handle` 管理），之后落在其中的取帧直接复制交出，不动解码器。
//! 与 mpv 倒放的“倒放缓冲”同一做法：按关键帧区间正向解，解出的帧留在解码端，按需倒序取用。
//!
//! 一幅留存帧代表的时间跨到同一段里紧接着解出的下一幅（与 `covers`、单帧取帧“开始于该时刻或之前的最后一幅”同一定义）；
//! 下一幅还没解出（或没能留下）时只认它自己的时间。

use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Retained {
    pub pts: i64,
    /// 同一段里紧接着解出的下一幅的呈现时间；未知时为 None。
    pub next: Option<i64>,
    /// 解码器给出的时长（刻度，可能为 0）。
    pub duration: i64,
    /// 所在段的关键帧时间：倒拖据此预解上一个 GOP。
    pub key: i64,
    pub handle: u32,
}

/// 一幅新解出的帧能否留下。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Admit {
    /// 已有同一时间的留存帧：不再复制，只接上前一幅。
    Known,
    /// 还有空位：新建一张纹理。
    Free,
    /// 满了：覆盖这一幅（返回它的纹理）。
    Replace(u32),
    /// 满了且新帧比所有留存帧都远：不留。
    Full,
}

#[derive(Debug, Default)]
pub struct RetainedFrames {
    entries: BTreeMap<i64, Retained>,
    capacity: usize,
    /// 当前段里上一幅留存帧；下一幅留下时补上它的 `next`。
    previous: Option<i64>,
    /// 当前段里没能留下的帧（满了）：之后留下的只有正是它（暂停后接着留）时才与前一幅相连，否则中间有空洞。
    rejected: Option<i64>,
    /// 最近一次前台取帧的位置与移动方向（正向 1、倒向 -1、未知 0）：满了先丢已经走过的一侧。
    focus: Option<i64>,
    direction: i8,
    /// 已建好、当前没有帧的纹理（换文件或写入失败后空出），先于新建复用。
    free: Vec<u32>,
    /// 没走过的一侧离读取位置这么远（刻度）以内的帧不丢：倒拖时那是当前段与预解的上一段，丢了就要重解；预解遇满就停下等
    /// 走过的帧空出来。更远的（之前在别处拖动留下的）照常让位。
    far: i64,
}

impl RetainedFrames {
    pub fn capacity(&self) -> usize {
        self.capacity
    }

    pub fn set_capacity(&mut self, capacity: usize, far: i64) {
        self.capacity = capacity;
        self.far = far;
    }

    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// 当前段里上一幅留存帧。
    pub fn previous(&self) -> Option<i64> {
        self.previous
    }

    /// 当前段里因留存已满没能留下的那一幅。
    pub fn rejected(&self) -> Option<i64> {
        self.rejected
    }

    /// 前台取帧的位置（预解不算）：决定满了时丢哪一侧。
    pub fn focus(&mut self, ticks: i64) {
        if let Some(previous) = self.focus {
            if ticks != previous {
                self.direction = if ticks > previous { 1 } else { -1 };
            }
        }
        self.focus = Some(ticks);
    }

    /// `ticks` 处的画面（开始于它或之前的最后一幅，且确知下一幅晚于它）。
    pub fn find(&self, ticks: i64) -> Option<Retained> {
        let (_, entry) = self.entries.range(..=ticks).next_back()?;
        (entry.pts == ticks || entry.next.is_some_and(|next| ticks < next)).then_some(*entry)
    }

    /// 从关键帧解起的一段都已留下：`from` 之后 `near` 以内有留存帧，从它沿相连的帧一直到 `to`。`from` 是容器索引给的
    /// 关键帧时间（解码时间，带 B 帧时比呈现时间早几帧，所以只要求第一幅在它附近）。
    pub fn covers_from_key(&self, from: i64, near: i64, to: i64) -> bool {
        let Some((_, first)) = self.entries.range(from..).next() else { return false };
        if first.pts > from.saturating_add(near) {
            return false;
        }
        let mut entry = *first;
        loop {
            if entry.pts <= to && (entry.pts == to || entry.next.is_some_and(|next| to < next)) {
                return true;
            }
            match entry.next.and_then(|next| self.entries.get(&next)) {
                Some(next) if next.pts <= to => entry = *next,
                _ => return false,
            }
        }
    }

    /// 开新段（定位、换段）：新段的第一幅不与旧段相连。
    pub fn break_chain(&mut self) {
        self.previous = None;
        self.rejected = None;
    }

    /// 决定新解出的 `pts` 能否留下；`Full` 时记下它，之后的帧不再与前一幅相连（除非正是它重新留下）。
    pub fn admit(&mut self, pts: i64) -> Admit {
        if self.entries.contains_key(&pts) {
            return Admit::Known;
        }
        if self.entries.len() + self.free.len() < self.capacity {
            return Admit::Free;
        }
        if let Some(handle) = self.free.pop() {
            return Admit::Replace(handle);
        }
        let focus = self.focus.unwrap_or(pts);
        let distance = |value: i64| value.abs_diff(focus);
        // 已经走过的一侧（正拖时的身后、倒拖时的前方）最先丢，从最远的开始。
        let passed = match self.direction {
            1 => self.entries.first_key_value().filter(|(&value, _)| value < focus),
            -1 => self.entries.last_key_value().filter(|(&value, _)| value > focus),
            _ => None,
        };
        let victim = passed.or_else(|| {
            let first = self.entries.first_key_value();
            let last = self.entries.last_key_value();
            match (first, last) {
                (Some(first), Some(last)) => Some(if distance(*first.0) >= distance(*last.0) { first } else { last }),
                _ => None,
            }
        });
        match victim {
            Some((&value, entry)) if passed.is_some() || distance(value) > distance(pts).max(self.far.max(0) as u64) => Admit::Replace(entry.handle),
            _ => {
                // 前面已有没留下的帧：再丢一幅就隔着两幅以上，补回哪一幅都不能与 `previous` 相连。
                if self.rejected.is_some_and(|rejected| rejected != pts) {
                    self.previous = None;
                }
                self.rejected = Some(pts);
                Admit::Full
            }
        }
    }

    /// 留下 `entry`（`admit` 返回 `Free` / `Replace` 之后、纹理已写入时调用；`Replace` 的旧帧随之移除）。
    pub fn insert(&mut self, entry: Retained) {
        if let Some((&old, _)) = self.entries.iter().find(|(_, existing)| existing.handle == entry.handle) {
            self.entries.remove(&old);
            if self.previous == Some(old) {
                self.previous = None;
            }
        }
        self.entries.insert(entry.pts, entry);
        self.link(entry.pts);
    }

    /// 改记已留存的 `pts` 所在 GOP 的关键帧（同一幅帧先在一段长续解里留下时记的是那段的起点）。
    pub fn set_key(&mut self, pts: i64, key: i64) {
        if let Some(entry) = self.entries.get_mut(&pts) {
            entry.key = key;
        }
    }

    /// 丢掉全部留存帧（换了文件）；纹理留着复用。
    pub fn clear(&mut self) {
        self.free.extend(self.entries.values().map(|entry| entry.handle));
        self.entries.clear();
        self.break_chain();
    }

    /// 放掉全部留存帧与纹理（显存预算收回）：纹理号随之作废，容量归零，之后按重新登记的容量新建。
    pub fn release_all(&mut self) {
        self.entries.clear();
        self.free.clear();
        self.capacity = 0;
        self.break_chain();
    }

    /// 纹理 `handle` 的内容不再可信（写入或交出失败）：丢掉它上面的帧。
    pub fn forget(&mut self, handle: u32) {
        if let Some((&pts, _)) = self.entries.iter().find(|(_, entry)| entry.handle == handle) {
            self.entries.remove(&pts);
            if self.previous == Some(pts) {
                self.previous = None;
            }
        }
        self.free.push(handle);
    }

    /// 同一段里接着解出了 `pts`（已留存的帧，或刚留下的帧）：前一幅的时间跨到它。
    pub fn link(&mut self, pts: i64) {
        let continues = self.rejected.is_none_or(|rejected| rejected == pts);
        if continues {
            if let Some(previous) = self.previous.and_then(|previous| self.entries.get_mut(&previous)) {
                if previous.pts < pts {
                    previous.next = Some(pts);
                }
            }
        }
        self.rejected = None;
        self.previous = Some(pts);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn retain(frames: &mut RetainedFrames, pts: i64, next_handle: &mut u32) -> Admit {
        let admit = frames.admit(pts);
        let handle = match admit {
            Admit::Known => {
                frames.link(pts);
                return admit;
            }
            Admit::Full => return admit,
            Admit::Free => {
                *next_handle += 1;
                *next_handle - 1
            }
            Admit::Replace(handle) => handle,
        };
        frames.insert(Retained { pts, next: None, duration: 1, key: 0, handle });
        admit
    }

    #[test]
    fn a_span_from_its_key_frame_is_covered_only_without_holes() {
        let mut frames = RetainedFrames::default();
        frames.set_capacity(8, 0);
        let mut handles = 0;
        for pts in [100, 110, 120, 130] {
            let admit = frames.admit(pts);
            assert_eq!(admit, Admit::Free);
            handles += 1;
            frames.insert(Retained { pts, next: None, duration: 1, key: 100, handle: handles });
        }
        // 索引给的关键帧时间（解码时间）早于呈现时间几刻度。
        assert!(frames.covers_from_key(98, 5, 125));
        assert!(!frames.covers_from_key(98, 5, 135), "末尾之后未知");
        assert!(!frames.covers_from_key(80, 5, 125), "关键帧附近没有留存帧：前面可能缺帧");
        frames.forget(2);
        assert!(!frames.covers_from_key(98, 5, 125), "中间有空洞");
    }

    #[test]
    fn cleared_and_forgotten_textures_are_reused() {
        let mut frames = RetainedFrames::default();
        frames.set_capacity(2, 0);
        let mut handles = 0;
        retain(&mut frames, 0, &mut handles);
        retain(&mut frames, 10, &mut handles);
        frames.forget(0);
        assert_eq!(frames.find(0), None);
        assert_eq!(retain(&mut frames, 20, &mut handles), Admit::Replace(0));
        frames.clear();
        assert_eq!(frames.len(), 0);
        assert!(matches!(frames.admit(30), Admit::Replace(_)), "空出的纹理先于新建复用");
    }

    #[test]
    fn consecutive_frames_cover_until_the_next_one() {
        let mut frames = RetainedFrames::default();
        frames.set_capacity(8, 0);
        let mut handles = 0;
        for pts in [0, 10, 20, 30] {
            retain(&mut frames, pts, &mut handles);
        }
        assert_eq!(frames.find(15).map(|entry| entry.pts), Some(10));
        assert_eq!(frames.find(30).map(|entry| entry.pts), Some(30), "末尾一幅只认它自己的时间");
        assert_eq!(frames.find(31), None, "下一幅未知：不猜");
        assert_eq!(frames.find(-1), None);
        // 新段不与旧段相连。
        frames.break_chain();
        retain(&mut frames, 100, &mut handles);
        assert_eq!(frames.find(50), None);
    }

    #[test]
    fn a_rejected_frame_leaves_a_gap_unless_it_is_retained_later() {
        let mut frames = RetainedFrames::default();
        frames.set_capacity(2, 0);
        frames.focus(0);
        let mut handles = 0;
        retain(&mut frames, 0, &mut handles);
        retain(&mut frames, 10, &mut handles);
        assert_eq!(retain(&mut frames, 20, &mut handles), Admit::Full, "新帧比留存帧都远");
        assert_eq!(frames.find(15), None, "10 的下一幅没能留下：不能把 10 延伸过去");
        // 有了空位后接着留下的正是被拒的那一幅（预解暂停后继续）：前后相连。
        frames.set_capacity(3, 0);
        assert_eq!(retain(&mut frames, 20, &mut handles), Admit::Free);
        assert_eq!(frames.find(15).map(|entry| entry.pts), Some(10));
        // 被拒之后留下的是别的帧（中间缺了被拒的那一幅）：不相连。
        assert_eq!(retain(&mut frames, 30, &mut handles), Admit::Full);
        frames.set_capacity(4, 0);
        retain(&mut frames, 40, &mut handles);
        assert_eq!(frames.find(25), None);
        assert_eq!(frames.find(20).map(|entry| entry.pts), Some(20));
        // 连续两幅没留下，补回后一幅也不能隔着前一幅相连。
        let mut twice = RetainedFrames::default();
        twice.set_capacity(1, 0);
        twice.focus(0);
        let mut handles = 0;
        retain(&mut twice, 0, &mut handles);
        assert_eq!(retain(&mut twice, 10, &mut handles), Admit::Full);
        assert_eq!(retain(&mut twice, 20, &mut handles), Admit::Full);
        twice.set_capacity(2, 0);
        retain(&mut twice, 20, &mut handles);
        assert_eq!(twice.find(15), None, "缺了 10");
        // 同一幅重复判满（预解停下后再补它仍满）不算缺帧：之后补上照样相连。
        let mut again = RetainedFrames::default();
        again.set_capacity(1, 0);
        again.focus(0);
        let mut handles = 0;
        retain(&mut again, 0, &mut handles);
        assert_eq!(retain(&mut again, 10, &mut handles), Admit::Full);
        assert_eq!(retain(&mut again, 10, &mut handles), Admit::Full);
        again.set_capacity(2, 0);
        retain(&mut again, 10, &mut handles);
        assert_eq!(again.find(5).map(|entry| entry.pts), Some(0));
    }

    #[test]
    fn eviction_drops_the_passed_side_first() {
        let mut frames = RetainedFrames::default();
        frames.set_capacity(4, 0);
        let mut handles = 0;
        for pts in [0, 10, 20, 30] {
            retain(&mut frames, pts, &mut handles);
        }
        // 倒拖到 20：前方（30）已走过，先丢它，即使身后的 0 更远。
        frames.focus(30);
        frames.focus(20);
        frames.break_chain();
        assert!(matches!(retain(&mut frames, -10, &mut handles), Admit::Replace(_)));
        assert_eq!(frames.find(30), None);
        assert!(frames.find(0).is_some());
        // 正拖：身后最远的先丢。
        let mut forward = RetainedFrames::default();
        forward.set_capacity(3, 0);
        let mut handles = 0;
        for pts in [0, 10, 20] {
            retain(&mut forward, pts, &mut handles);
        }
        forward.focus(10);
        forward.focus(20);
        retain(&mut forward, 30, &mut handles);
        assert_eq!(forward.find(0), None);
        assert_eq!(forward.find(25).map(|entry| entry.pts), Some(20));
    }

    #[test]
    fn frames_on_the_way_ahead_are_kept_unless_far_away() {
        // 倒拖到 30：前方没有走过的帧，身后 0–20 是当前段（预解时新帧更远也不挤掉它们）。
        let mut frames = RetainedFrames::default();
        frames.set_capacity(3, 100);
        let mut handles = 0;
        for pts in [0, 10, 20] {
            retain(&mut frames, pts, &mut handles);
        }
        frames.focus(40);
        frames.focus(30);
        frames.break_chain();
        assert_eq!(retain(&mut frames, 5, &mut handles), Admit::Full);
        // 很远处留下的旧帧照常让位。
        let mut stale = RetainedFrames::default();
        stale.set_capacity(2, 100);
        let mut handles = 0;
        for pts in [1000, 1010] {
            retain(&mut stale, pts, &mut handles);
        }
        stale.focus(0);
        stale.focus(5);
        stale.break_chain();
        assert!(matches!(retain(&mut stale, 6, &mut handles), Admit::Replace(_)), "正拖时 1000、1010 在前方但很远");
        assert_eq!(stale.find(1010), None, "先丢最远的");
    }

    #[test]
    fn known_frames_are_linked_without_a_copy() {
        let mut frames = RetainedFrames::default();
        frames.set_capacity(4, 0);
        let mut handles = 0;
        retain(&mut frames, 10, &mut handles);
        frames.break_chain();
        retain(&mut frames, 0, &mut handles);
        assert_eq!(retain(&mut frames, 10, &mut handles), Admit::Known);
        assert_eq!(handles, 2, "已留存的帧不再复制");
        assert_eq!(frames.find(5).map(|entry| entry.pts), Some(0));
    }
}
