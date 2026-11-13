//! 健康计数与采集帧的有界收件箱。
//!
//! 采集回调只做两件事：记数、把帧放进收件箱。收件箱满了丢最旧的一张并计数，回调从不等编码或磁盘。

use serde_json::{json, Value};
use std::{
    collections::VecDeque,
    sync::{
        atomic::{AtomicI64, AtomicU64, Ordering},
        Condvar, Mutex,
    },
    time::Duration,
};

const BUCKET_US: i64 = 250;
const BUCKETS: usize = 400;

/// 0–100 毫秒、每档 0.25 毫秒的分布；只用来看间隔与延迟的中位数、99 分位和最大值。
pub struct Histogram {
    buckets: [u32; BUCKETS],
    count: u64,
    max_us: i64,
}

impl Default for Histogram {
    fn default() -> Self {
        Self { buckets: [0; BUCKETS], count: 0, max_us: 0 }
    }
}

impl Histogram {
    pub fn record(&mut self, value_us: i64) {
        let index = (value_us.max(0) / BUCKET_US).min(BUCKETS as i64 - 1) as usize;
        self.buckets[index] = self.buckets[index].saturating_add(1);
        self.count += 1;
        self.max_us = self.max_us.max(value_us);
    }

    pub fn percentile(&self, fraction: f64) -> i64 {
        if self.count == 0 {
            return 0;
        }
        let target = ((self.count as f64 * fraction).ceil() as u64).clamp(1, self.count);
        let mut seen = 0u64;
        for (index, bucket) in self.buckets.iter().enumerate() {
            seen += *bucket as u64;
            if seen >= target {
                return ((index as i64 + 1) * BUCKET_US).min(self.max_us.max(BUCKET_US));
            }
        }
        self.max_us
    }

    pub fn summary(&self) -> Value {
        json!({"count": self.count, "p50": self.percentile(0.5), "p99": self.percentile(0.99), "max": self.max_us})
    }
}

/// 可正可负的量（帧到达时刻减它带的系统时刻）：只留最小、平均、最大。
#[derive(Default)]
pub struct Range {
    count: u64,
    sum: i64,
    min: i64,
    max: i64,
}

impl Range {
    pub fn record(&mut self, value: i64) {
        self.min = if self.count == 0 { value } else { self.min.min(value) };
        self.max = if self.count == 0 { value } else { self.max.max(value) };
        self.count += 1;
        self.sum += value;
    }

    pub fn summary(&self) -> Value {
        json!({"count": self.count, "min": self.min, "avg": if self.count == 0 { 0 } else { self.sum / self.count as i64 }, "max": self.max})
    }
}

/// 各线程共同写的计数；“最大值”类在每次汇报后清零，看的是最近一秒。
#[derive(Default)]
pub struct Health {
    pub source_frames: AtomicU64,
    pub capture_dropped: AtomicU64,
    pub capture_queue_max: AtomicU64,
    pub last_source_us: AtomicI64,
    /// 采集回调处理一帧（转换并放进收件箱）花的时间。它长了系统的帧池会被占满，系统就开始丢帧，而且不会告诉我们。
    pub capture_max_us: AtomicU64,
    /// 没取到或没转成、被丢掉的来源帧数（偶发的不影响录制，持续的会升级成重新接上采集）。
    pub capture_failed: AtomicU64,
    /// 开发用：接下来这么多张来源帧当作取帧失败。
    pub inject_frame_failures: AtomicU64,
    /// 来源画面当前的尺寸（宽在高 32 位）；变了说明显示器换了分辨率。
    pub source_size: AtomicU64,
    /// 已出格、等编码的帧数。
    pub encode_queue: AtomicU64,
    pub encode_queue_max: AtomicU64,
    pub encode_sum_us: AtomicU64,
    pub encode_count: AtomicU64,
    /// 编码线程新编出、还没被活动时间线取走的字节数。
    pub encoded_bytes: AtomicU64,
    /// 已编码、等写盘的包数。
    pub write_queue: AtomicU64,
    pub write_queue_max: AtomicU64,
    pub encode_max_us: AtomicU64,
    pub write_max_us: AtomicU64,
    pub bytes_written: AtomicU64,
    /// 已经随分片交给系统的帧数：进程此刻被杀，这些帧读得回来。
    pub durable_frames: AtomicU64,
    /// 相邻来源帧采集时刻之差。
    pub source_interval: Mutex<Histogram>,
    /// 帧到达进程的时刻减它带的系统时刻。
    pub arrival_latency: Mutex<Range>,
}

impl Health {
    pub fn raise(target: &AtomicU64, value: u64) {
        target.fetch_max(value, Ordering::Relaxed);
    }

    pub fn take(target: &AtomicU64) -> u64 {
        target.swap(0, Ordering::Relaxed)
    }
}

struct State<F> {
    frames: VecDeque<(i64, F)>,
    failure: Option<String>,
    signaled: bool,
    closed: bool,
}

pub struct Inbox<F> {
    state: Mutex<State<F>>,
    wake: Condvar,
    capacity: usize,
}

impl<F> Inbox<F> {
    pub fn new(capacity: usize) -> Self {
        Self {
            state: Mutex::new(State { frames: VecDeque::with_capacity(capacity), failure: None, signaled: false, closed: false }),
            wake: Condvar::new(),
            capacity,
        }
    }

    /// 采集回调调用：source_us 是帧的采集时刻，now_us 是此刻。
    pub fn push(&self, health: &Health, source_us: i64, now_us: i64, frame: F) {
        let previous = health.last_source_us.swap(source_us, Ordering::Relaxed);
        if health.source_frames.fetch_add(1, Ordering::Relaxed) > 0 {
            health.source_interval.lock().unwrap().record(source_us - previous);
        }
        health.arrival_latency.lock().unwrap().record(now_us - source_us);
        let evicted = {
            let mut state = self.state.lock().unwrap();
            if state.closed {
                return;
            }
            let evicted = if state.frames.len() >= self.capacity { state.frames.pop_front() } else { None };
            state.frames.push_back((source_us, frame));
            Health::raise(&health.capture_queue_max, state.frames.len() as u64);
            evicted
        };
        // 被挤掉的帧在锁外释放（释放显卡帧可能要等设备锁）。
        if evicted.is_some() {
            health.capture_dropped.fetch_add(1, Ordering::Relaxed);
        }
        drop(evicted);
        self.wake.notify_one();
    }

    /// 采集出错：`SOURCE_LOST|...` 表示来源没了、可以等它回来，其余的会话线程收尾。取走之前只记第一条。
    pub fn fail(&self, message: String) {
        self.state.lock().unwrap().failure.get_or_insert(message);
        self.wake.notify_one();
    }

    /// 会话结束：放掉里面的帧，之后再放进来的也直接放掉（停采集时可能还有回调在路上）。
    pub fn close(&self) {
        let frames = {
            let mut state = self.state.lock().unwrap();
            state.closed = true;
            std::mem::take(&mut state.frames)
        };
        drop(frames);
    }

    /// 有控制指令要处理时叫醒会话线程。
    pub fn signal(&self) {
        self.state.lock().unwrap().signaled = true;
        self.wake.notify_one();
    }

    /// 等到有帧、有信号、出错或超时；取走全部帧。
    pub fn wait(&self, timeout: Duration) -> (Vec<(i64, F)>, Option<String>) {
        let mut state = self.state.lock().unwrap();
        if state.frames.is_empty() && !state.signaled && state.failure.is_none() && !timeout.is_zero() {
            state = self
                .wake
                .wait_timeout_while(state, timeout, |state| state.frames.is_empty() && !state.signaled && state.failure.is_none())
                .unwrap()
                .0;
        }
        state.signaled = false;
        // 出错只交付一次：来源丢失是可以恢复的，恢复后再丢要能再报。
        (state.frames.drain(..).collect(), state.failure.take())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn full_inbox_drops_the_oldest_frame_and_counts_it() {
        let health = Health::default();
        let inbox = Inbox::new(4);
        for index in 0..7i64 {
            inbox.push(&health, index * 1_000, index * 1_000 + 300, index);
        }
        let (frames, failure) = inbox.wait(Duration::ZERO);
        assert_eq!(frames.iter().map(|(_, frame)| *frame).collect::<Vec<_>>(), vec![3, 4, 5, 6]);
        assert!(failure.is_none());
        assert_eq!(health.capture_dropped.load(Ordering::Relaxed), 3);
        assert_eq!(health.source_frames.load(Ordering::Relaxed), 7);
        assert_eq!(health.capture_queue_max.load(Ordering::Relaxed), 4);
        assert_eq!(health.source_interval.lock().unwrap().summary()["count"], 6);
    }

    #[test]
    fn failure_is_delivered_once_set_and_keeps_the_first_message() {
        let inbox = Inbox::<u8>::new(2);
        inbox.fail("SOURCE_LOST|显示器已断开".into());
        inbox.fail("CAPTURE_FAILED|后来的".into());
        assert_eq!(inbox.wait(Duration::from_millis(1)).1.as_deref(), Some("SOURCE_LOST|显示器已断开"));
    }

    #[test]
    fn histogram_percentiles() {
        let mut histogram = Histogram::default();
        for _ in 0..99 {
            histogram.record(16_600);
        }
        histogram.record(40_000);
        assert_eq!(histogram.percentile(0.5), 16_750);
        assert_eq!(histogram.percentile(0.99), 16_750);
        assert_eq!(histogram.summary()["max"], 40_000);
    }
}
