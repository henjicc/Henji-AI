//! 恒定帧率网格：把来源帧（只在画面变化时到达、带系统时刻）排进等间隔的格子。
//!
//! 文件里的第 n 帧（pts = n）对应一个“输出格”；暂停的格子不占输出序号，所以文件时间轴连续。
//! 每格的画面取“采集时刻不晚于该格时刻加半格”的来源帧：
//! - 没有新帧就重复上一帧（静止画面的常态）；
//! - 来源与网格同频时，相位贴着判定线会让相邻两格一格没有、一格两张。这里留一张的缓冲：
//!   一格内有两张时先出旧的、留下新的给下一格，整个相位漂移过程只多出一次重复或少一张，不来回抖；
//! - 来源更快（高刷屏）时每格只留最近两张里较旧的一张，其余算“来源多出”，间隔均匀。
//!
//! 每格在“判定线 + 余量”之后才出，余量用来等合成器把帧送到；晚到的帧顺延到下一格，时刻表照实记它的采集时刻。
//! 编码跟不上、积压超过上限时，格子记为“丢弃”：占输出序号（时间轴不缩短），不送编码。

use std::collections::VecDeque;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Emit {
    /// 文件里的帧序号，也是 pts（时间基 1/fps）。
    pub output: u64,
    /// 网格格号：格时刻 = 起点 + 格号 × 帧间隔；与 output 的差是暂停掉的格数。
    pub cell: u64,
    /// 这一格所用来源帧的采集时刻（平台单调时钟，微秒）。
    pub source_us: i64,
    /// 这张来源帧第一次进文件。
    pub fresh: bool,
    pub force_key: bool,
    /// 积压过多被跳过：占序号、不编码。
    pub dropped: bool,
}

#[derive(Debug, PartialEq, Eq)]
pub enum Poll {
    /// 现在没有到点的格子；下一格最早在这个时刻到点。
    Idle(i64),
    Emit(Emit),
    /// 从这一格起进入暂停；output 是暂停处的文件帧序号（暂停前最后一帧是 output - 1）。
    Paused { at_us: i64, cell: u64, output: u64 },
    /// 这一格起继续；紧接着的 Emit 强制关键帧。
    Resumed { at_us: i64, cell: u64, output: u64 },
    Finished,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct Counters {
    pub fresh: u64,
    pub repeated: u64,
    pub dropped: u64,
    /// 来源帧多于格子、没进文件的张数（高刷屏或追赶积压时）。
    pub surplus: u64,
    pub paused_cells: u64,
}

pub struct Pacer<F> {
    origin_us: i64,
    fps_num: u64,
    fps_den: u64,
    half_us: i64,
    slack_us: i64,
    max_lag_cells: i64,
    next_cell: u64,
    next_output: u64,
    pending: VecDeque<(i64, F)>,
    current: Option<(i64, F)>,
    current_shown: bool,
    /// 暂停区间 [起, 止)，按时钟时刻；还没继续的区间止于 i64::MAX。
    pauses: Vec<(i64, i64)>,
    in_pause: bool,
    after_resume: bool,
    dropping: bool,
    stop_at: Option<i64>,
    pub counters: Counters,
}

impl<F> Pacer<F> {
    pub fn new(origin_us: i64, fps_num: u32, fps_den: u32) -> Self {
        let (fps_num, fps_den) = (fps_num.max(1) as u64, fps_den.max(1) as u64);
        let period_us = (1_000_000 * fps_den / fps_num) as i64;
        Self {
            origin_us,
            fps_num,
            fps_den,
            half_us: period_us / 2,
            slack_us: period_us / 2,
            max_lag_cells: ((fps_num / fps_den) as i64 / 2).max(4),
            next_cell: 0,
            next_output: 0,
            pending: VecDeque::new(),
            current: None,
            current_shown: false,
            pauses: Vec::new(),
            in_pause: false,
            after_resume: false,
            dropping: false,
            stop_at: None,
            counters: Counters::default(),
        }
    }

    pub fn origin_us(&self) -> i64 {
        self.origin_us
    }

    /// 格时刻用整数从起点算，不逐格累加，长录不积累舍入误差。
    pub fn cell_time(&self, cell: u64) -> i64 {
        self.origin_us + (cell as u128 * 1_000_000 * self.fps_den as u128 / self.fps_num as u128) as i64
    }

    pub fn next_output(&self) -> u64 {
        self.next_output
    }

    pub fn next_cell(&self) -> u64 {
        self.next_cell
    }

    /// 来源帧按到达顺序进来；采集时刻不回退（合成器保证）。
    pub fn push(&mut self, source_us: i64, frame: F) {
        self.pending.push_back((source_us, frame));
    }

    /// 最近一次 Emit 所用的帧。
    pub fn frame(&self) -> Option<&F> {
        self.current.as_ref().map(|(_, frame)| frame)
    }

    /// 从 at_us 起的格子不进文件。已经在暂停中返回 false。
    pub fn pause(&mut self, at_us: i64) -> bool {
        if self.pauses.last().is_some_and(|(_, end)| *end == i64::MAX) {
            return false;
        }
        self.pauses.push((at_us, i64::MAX));
        true
    }

    /// at_us 起的格子恢复进文件。不在暂停中返回 false。
    pub fn resume(&mut self, at_us: i64) -> bool {
        match self.pauses.last_mut() {
            Some((start, end)) if *end == i64::MAX => {
                *end = at_us.max(*start);
                true
            }
            _ => false,
        }
    }

    /// 格时刻早于 at_us 的格子出完就结束；不再等余量。
    pub fn stop(&mut self, at_us: i64) {
        self.stop_at.get_or_insert(at_us);
    }

    fn candidates(&self, deadline: i64) -> usize {
        self.pending.iter().take_while(|(time, _)| *time <= deadline).count()
    }

    /// 常态：最多留一张缓冲，先出旧的。
    fn take_next(&mut self, deadline: i64) {
        let mut count = self.candidates(deadline);
        while count > 2 {
            self.pending.pop_front();
            self.counters.surplus += 1;
            count -= 1;
        }
        if count > 0 {
            self.current = self.pending.pop_front();
            self.current_shown = false;
        }
    }

    /// 暂停中、刚继续、丢弃积压时：直接跳到判定线前最新的一张。
    fn take_latest(&mut self, deadline: i64, count_surplus: bool) {
        let count = self.candidates(deadline);
        for index in 0..count {
            let replaced_unshown = self.current.is_some() && !self.current_shown;
            self.current = self.pending.pop_front();
            if count_surplus && (index > 0 || replaced_unshown) {
                self.counters.surplus += 1;
            }
            self.current_shown = false;
        }
    }

    pub fn poll(&mut self, now_us: i64) -> Poll {
        loop {
            let cell = self.next_cell;
            let grid = self.cell_time(cell);
            if self.stop_at.is_some_and(|stop| grid >= stop) {
                return Poll::Finished;
            }
            let deadline = grid + self.half_us;
            let due_at = deadline + self.slack_us;
            let stopping = self.stop_at.is_some();
            if !stopping && now_us < due_at {
                return Poll::Idle(due_at);
            }
            if self.pauses.iter().any(|(start, end)| grid >= *start && grid < *end) {
                self.take_latest(deadline, false);
                self.next_cell += 1;
                self.counters.paused_cells += 1;
                if !self.in_pause {
                    self.in_pause = true;
                    return Poll::Paused { at_us: grid, cell, output: self.next_output };
                }
                continue;
            }
            if self.in_pause {
                self.in_pause = false;
                self.after_resume = true;
                self.pauses.retain(|(_, end)| *end > grid);
                return Poll::Resumed { at_us: grid, cell, output: self.next_output };
            }
            if stopping {
                self.dropping = false;
            } else {
                let period = (self.half_us * 2).max(1);
                let lag = (now_us - due_at) / period;
                if lag > self.max_lag_cells {
                    self.dropping = true;
                } else if lag <= 1 {
                    self.dropping = false;
                }
            }
            if self.after_resume || self.dropping {
                self.take_latest(deadline, !self.after_resume);
            } else {
                self.take_next(deadline);
            }
            if self.current.is_none() {
                // 第一格到点时手里的帧都晚于判定线：宁可用稍晚的一张，也不让时间轴开头空着。
                self.current = self.pending.pop_front();
            }
            let Some((source_us, _)) = self.current else {
                // 一张画面都还没有：等第一帧。
                return if stopping { Poll::Finished } else { Poll::Idle(now_us + 1_000) };
            };
            let dropped = self.dropping;
            let fresh = !dropped && !self.current_shown;
            let force_key = !dropped && (self.after_resume || self.next_output == 0);
            if dropped {
                self.counters.dropped += 1;
            } else {
                self.current_shown = true;
                self.after_resume = false;
                if fresh {
                    self.counters.fresh += 1;
                } else {
                    self.counters.repeated += 1;
                }
            }
            let emit = Emit { output: self.next_output, cell, source_us, fresh, force_key, dropped };
            self.next_cell += 1;
            self.next_output += 1;
            return Poll::Emit(emit);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const T: i64 = 16_666;

    /// 按毫秒推进：帧在采集时刻加 latency 时到达，返回全部 Emit。
    fn run(pacer: &mut Pacer<u32>, frames: &[i64], latency: i64, until: i64) -> Vec<Emit> {
        let mut emits = Vec::new();
        let mut next = 0;
        let mut now = pacer.origin_us();
        while now <= until {
            while next < frames.len() && frames[next] + latency <= now {
                pacer.push(frames[next], next as u32);
                next += 1;
            }
            loop {
                match pacer.poll(now) {
                    Poll::Emit(emit) => emits.push(emit),
                    Poll::Idle(_) | Poll::Finished => break,
                    Poll::Paused { .. } | Poll::Resumed { .. } => {}
                }
            }
            now += 1_000;
        }
        emits
    }

    #[test]
    fn matched_source_puts_every_frame_in_its_own_cell() {
        let frames: Vec<i64> = (0..600).map(|i| i * 1_000_000 / 60).collect();
        let mut pacer = Pacer::new(0, 60, 1);
        let emits = run(&mut pacer, &frames, 3_000, 9_900_000);
        assert!(emits.len() > 590);
        assert!(emits.iter().all(|e| e.fresh && !e.dropped));
        assert!(emits.iter().enumerate().all(|(i, e)| e.output == i as u64 && e.cell == i as u64 && e.source_us == frames[i]));
        assert_eq!(pacer.counters.repeated + pacer.counters.surplus + pacer.counters.dropped, 0);
        assert!(emits[0].force_key && !emits[1].force_key);
    }

    #[test]
    fn static_picture_repeats_the_last_frame_with_its_real_time() {
        let mut pacer = Pacer::new(0, 60, 1);
        let emits = run(&mut pacer, &[0], 2_000, 1_000_000);
        assert!(emits.len() >= 58);
        assert!(emits[0].fresh);
        assert!(emits[1..].iter().all(|e| !e.fresh && e.source_us == 0));
        assert_eq!(pacer.counters.fresh, 1);
    }

    /// 相位正好贴着判定线、每帧左右抖 ±1.5ms：除了进入缓冲的一次重复，不丢帧也不反复重复。
    #[test]
    fn jitter_across_the_deadline_loses_no_frame() {
        let frames: Vec<i64> = (0..1200i64).map(|i| i * 1_000_000 / 60 + T / 2 + if (i * 7919) % 3 == 0 { 1_500 } else { -1_500 }).collect();
        let mut pacer = Pacer::new(0, 60, 1);
        let emits = run(&mut pacer, &frames, 3_000, 19_900_000);
        assert_eq!(pacer.counters.surplus, 0);
        assert!(pacer.counters.repeated <= 2, "重复 {}", pacer.counters.repeated);
        let sources: Vec<i64> = emits.iter().filter(|e| e.fresh).map(|e| e.source_us).collect();
        assert!(sources.windows(2).all(|pair| pair[0] < pair[1]));
        assert!(emits.len() > 1100 && sources.len() + 2 >= emits.len());
    }

    /// 显示器比网格慢一点（59.5Hz）：只会多出重复格，不丢来源帧。
    #[test]
    fn slower_source_only_adds_repeats() {
        let frames: Vec<i64> = (0..595i64).map(|i| i * 1_000_000 * 10 / 595).collect();
        let mut pacer = Pacer::new(0, 60, 1);
        let emits = run(&mut pacer, &frames, 3_000, 9_900_000);
        assert_eq!(pacer.counters.surplus, 0);
        assert!((4..=7).contains(&pacer.counters.repeated), "重复 {}", pacer.counters.repeated);
        assert!(emits.iter().all(|e| !e.dropped));
    }

    #[test]
    fn faster_source_keeps_even_spacing() {
        let frames: Vec<i64> = (0..1440i64).map(|i| i * 1_000_000 / 144).collect();
        let mut pacer = Pacer::new(0, 60, 1);
        let emits = run(&mut pacer, &frames, 3_000, 9_900_000);
        assert!(emits.iter().skip(2).all(|e| e.fresh));
        assert!(pacer.counters.surplus > 700);
        // 所用帧相对格时刻的“年龄”稳定：都在一格以内。
        for emit in emits.iter().skip(2) {
            let age = pacer.cell_time(emit.cell) + T / 2 - emit.source_us;
            assert!((0..=T).contains(&age), "格 {} 年龄 {age}", emit.cell);
        }
    }

    #[test]
    fn pause_keeps_output_contiguous_and_resumes_on_a_keyframe_with_the_latest_frame() {
        let frames: Vec<i64> = (0..300i64).map(|i| i * 1_000_000 / 60).collect();
        let mut pacer = Pacer::new(0, 60, 1);
        assert!(pacer.pause(1_000_000));
        assert!(!pacer.pause(1_100_000));
        assert!(pacer.resume(3_000_000));
        assert!(!pacer.resume(3_100_000));
        let mut marks = Vec::new();
        let mut emits = Vec::new();
        let mut next = 0;
        let mut now = 0;
        while now <= 4_900_000 {
            while next < frames.len() && frames[next] + 3_000 <= now {
                pacer.push(frames[next], next as u32);
                next += 1;
            }
            loop {
                match pacer.poll(now) {
                    Poll::Emit(emit) => emits.push(emit),
                    Poll::Idle(_) | Poll::Finished => break,
                    mark => marks.push(mark),
                }
            }
            now += 1_000;
        }
        assert_eq!(marks.len(), 2);
        let Poll::Paused { cell: paused_cell, output: paused_output, .. } = marks[0] else { panic!("应先暂停") };
        let Poll::Resumed { cell: resumed_cell, output: resumed_output, at_us } = marks[1] else { panic!("应继续") };
        assert_eq!(paused_output, resumed_output);
        assert_eq!(resumed_cell - paused_cell, 120);
        assert!(emits.iter().enumerate().all(|(i, e)| e.output == i as u64));
        let first = emits[resumed_output as usize];
        assert!(first.force_key && first.fresh && first.cell == resumed_cell);
        // 继续后的第一帧就是继续那一刻屏幕上的画面，不是暂停前的旧帧。
        assert!((at_us - first.source_us).abs() <= T, "继续时刻 {at_us}，来源 {}", first.source_us);
        assert!(!emits[resumed_output as usize + 1].force_key);
        assert_eq!(pacer.counters.paused_cells, 120);
        assert_eq!(pacer.counters.surplus, 0);
    }

    #[test]
    fn backlog_beyond_the_limit_is_marked_dropped_and_keeps_the_timeline() {
        let mut pacer = Pacer::new(0, 60, 1);
        pacer.push(0, 0);
        assert!(matches!(pacer.poll(T), Poll::Emit(Emit { dropped: false, .. })));
        // 编码卡了两秒：回来时积压 120 格。
        pacer.push(1_990_000, 1);
        let now = 2_000_000;
        let mut dropped = 0;
        let mut encoded = Vec::new();
        while let Poll::Emit(emit) = pacer.poll(now) {
            if emit.dropped {
                dropped += 1;
            } else {
                encoded.push(emit);
            }
        }
        assert!(dropped > 100, "丢弃 {dropped}");
        assert_eq!(pacer.counters.dropped, dropped);
        assert!(encoded.len() <= 2);
        // 丢弃的格子仍占序号：追上后下一帧的 pts 等于它的格号。
        let last = encoded.last().expect("追上后恢复编码");
        assert_eq!(last.output, last.cell);
        assert!(last.fresh && last.source_us == 1_990_000);
    }

    #[test]
    fn stop_flushes_cells_before_the_stop_time_then_finishes() {
        let mut pacer = Pacer::new(0, 60, 1);
        pacer.push(0, 0);
        pacer.stop(100_000);
        let mut count = 0;
        loop {
            match pacer.poll(100_000) {
                Poll::Emit(_) => count += 1,
                Poll::Finished => break,
                other => panic!("意外 {other:?}"),
            }
        }
        assert_eq!(count, 6);
        assert_eq!(pacer.poll(200_000), Poll::Finished);
    }

    #[test]
    fn cell_time_does_not_drift_over_long_recordings() {
        let pacer = Pacer::<u32>::new(5, 60, 1);
        assert_eq!(pacer.cell_time(60 * 3600 * 10), 5 + 36_000_000_000);
        let ntsc = Pacer::<u32>::new(0, 60_000, 1_001);
        assert_eq!(ntsc.cell_time(60_000), 1_001_000_000);
    }
}
