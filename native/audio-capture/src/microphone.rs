//! 麦克风：一路 PortAudio 采集交给一路或几路输出（音频编辑或讲解的整段文件、录屏的分段轨道），互不打断。
//!
//! 线程分工：音频回调只把采样合并成块放进采集队列；分发线程不碰磁盘，按每路输出的录制区间把块转进那一路自己的队列；
//! 每路输出一个写盘线程，只写自己的文件。一路写盘慢只让那一路自己的队列变长，不拖住别的输出，也不拖住控制命令：
//! 控制线程只改区间登记（分发线程持这把锁的时间极短），从不等写盘。停止时等落盘的部分交给后台线程，写完封口再应答。
use crate::{
    emit, failure, ffi, io_error,
    segments::{self, spawn_streamer, Lossy, Reliable},
    wav::Wav,
    Settings,
};
use crossbeam_queue::ArrayQueue;
use serde_json::{json, Value};
use std::{
    cell::UnsafeCell,
    ffi::{c_int, c_ulong, c_void},
    path::Path,
    sync::{
        atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering},
        mpsc, Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};

const PA_INPUT_UNDERFLOW: u64 = 1;
const PA_INPUT_OVERFLOW: u64 = 2;
/// 单块上限；协议与渲染层按 1024 帧、双声道 float32（8 KB）设计。
const BLOCK_FRAMES: usize = 1024;
/// 回调到分发线程之间的缓冲。分发线程不碰磁盘，这里只需扛住线程调度的抖动（48 kHz 约 5–10 秒）。
const CAPTURE_BLOCKS: usize = 512;
/// 每路输出自己的写盘缓冲：每块 512–1024 帧，4096 块在 48 kHz 约 44–87 秒、192 kHz 约 11–22 秒，
/// 磁盘卡几十秒都不丢采样；每路约 34 MB，长录音不能断，内存按宽的给。
const OUTPUT_BLOCKS: usize = 4096;
/// 写盘线程交给推流线程的可丢消息上限（预览采样、电平与健康计数合计，48 kHz 下约 30–50 秒，最多约 35 MB）。
/// 主进程不读管道时只丢这些，写盘不等它；讲解的麦克风是用预览采样写的，所以给得宽。
const PREVIEW_MESSAGES: usize = 4096;
/// 停止中的输出：采集队列空了这么久还没越过终点（设备不出数据了），就按已有的收尾。
const IDLE_FINISH: Duration = Duration::from_millis(300);
/// 新建整段文件的等待上限：磁盘没有响应时开始命令如实失败，不让主进程的请求超时、把整个录音进程收掉。
const CREATE_WAIT: Duration = Duration::from_secs(10);
/// 停止时等这一路写完、封口的上限（主进程的停止请求等 90 秒）。超过就先应答“还在收尾”，写盘线程照常写完。
const STOP_WAIT: Duration = Duration::from_secs(80);
/// 应答前确认段事件已发出的等待上限。
const BARRIER_WAIT: Duration = Duration::from_secs(5);
/// 只交给分段轨道的封段标记（高于 PortAudio 的回调标记位）：暂停后的第一块之前封住当前段，继续时另起一段。
const SEAL_SEGMENT: u64 = 1 << 32;

/// 回调时刻的放置：测得时刻与按采样数推算的时刻相差不到 `DEADBAND_US` 视为抖动，直接按采样数连续推进；
/// 超出但不到 `REANCHOR_US` 时以 `SLEW` 的速率向测得值靠拢；更晚超过 `REANCHOR_US`（或带溢出、欠载标记，确实丢了采样）才重新对齐。
/// 做法参照 OBS `obs-source.c` 的 TS_SMOOTHING_THRESHOLD（70 ms 内按采样数推进）与 Cap `audio_mixer.rs` 的
/// placement_correction（2 ms 内不处理、超出后缓慢修正）。速率取 100 ppm：盖得住常见设备时钟与系统时钟的漂移；
/// 录屏拼接把每段的偏差集中在段尾约 200 ms 里吸收，5 秒一段最多 0.5 ms，集中后约 0.25% 的变速，听不出来。
/// 时刻永不往回跳：MME 批量回调会给出重复或偏早的时刻，比推算值早得再多也只缓慢修正。
const DEADBAND_US: f64 = 2_000.0;
const REANCHOR_US: f64 = 70_000.0;
const SLEW: f64 = 1e-4;
#[derive(Default)]
struct Placement {
    next_us: Option<f64>,
}
impl Placement {
    /// 返回这一块第一帧放置的时刻。
    fn place(&mut self, measured: f64, frames: usize, frame_us: f64, glitch: bool) -> f64 {
        let duration = frames as f64 * frame_us;
        let first = match self.next_us {
            None => measured,
            Some(next) => {
                let error = measured - next;
                if error > REANCHOR_US || (glitch && error > 0.0) {
                    measured
                } else if error.abs() <= DEADBAND_US {
                    next
                } else {
                    next + (duration * SLEW).min(error.abs()).copysign(error)
                }
            }
        };
        self.next_us = Some(first + duration);
        first
    }
}

/// 正在被写盘线程写着的整段文件（停止已应答、磁盘还在写完的也算）：这期间不能恢复它，免得与写盘线程同时改文件头。
static WRITING: Mutex<Vec<String>> = Mutex::new(Vec::new());
/// 还活着的写盘线程数：进程退出前等它们写完、封口。
static WRITERS: AtomicUsize = AtomicUsize::new(0);
pub fn writing(path: &str) -> bool {
    WRITING.lock().unwrap().iter().any(|item| item == path)
}
pub fn writers() -> usize {
    WRITERS.load(Ordering::Acquire)
}
struct Alive;
impl Alive {
    fn new() -> Self {
        WRITERS.fetch_add(1, Ordering::AcqRel);
        Self
    }
}
impl Drop for Alive {
    fn drop(&mut self) {
        WRITERS.fetch_sub(1, Ordering::AcqRel);
    }
}

#[derive(Clone, Copy)]
pub struct Block {
    samples: [f32; 2048],
    frames: usize,
    /// 第一帧的单调时钟；只带丢帧数的收尾块（frames == 0）是丢掉那段的终点。
    mono_us: f64,
    uncertainty: f64,
    flags: u64,
    /// 本块之前没能交下去的帧数；写盘时补成等长静音。
    lost_before: u64,
    /// 本块第一帧在整次采集里的位置（含丢掉的帧）：各路输出按它判断这一块落不落在自己的录制区间里。
    first: u64,
}
const EMPTY_BLOCK: Block = Block {
    samples: [0.0; 2048],
    frames: 0,
    mono_us: 0.0,
    uncertainty: 0.0,
    flags: 0,
    lost_before: 0,
    first: 0,
};
pub struct Shared {
    queue: ArrayQueue<Block>,
    /// 回调线程的合并块与入队失败累计帧数。只在音频回调里读写，或在流停止（hc_stop 返回）后由控制线程收尾。
    pending: UnsafeCell<Block>,
    lost: UnsafeCell<u64>,
    /// 回调时刻的放置状态：只在音频回调里读写，或在流开始前由控制线程重置。
    placement: UnsafeCell<Placement>,
    /// 已交给队列（含丢掉）的帧数，也就是下一块的 `first`。
    captured: AtomicU64,
    /// 已交给队列的最后一帧之后的单调时钟（f64 位）：流停止时补静音的收尾块用它定位。
    next_mono: AtomicU64,
    /// 一帧的微秒数（f64 位），开流后按驱动给的采样率定。
    frame_us: AtomicU64,
    /// 只剩暂停的整段文件时流停着（开流之前也是）：分发线程排空队列后，正在收尾的输出就没有更多数据了。
    /// 暂停的分段轨道不停流（与 OBS 一样暂停不关设备），继续时从下一块直接接上，不用重开设备、等首个回调。
    stream_stopped: AtomicBool,
    stop: AtomicBool,
    distributor_exited: AtomicBool,
    pub callback_frames: AtomicU64,
    pub last_callback_us: AtomicU64,
    input_overflows: AtomicU64,
    input_underflows: AtomicU64,
    /// 采集队列满时丢的帧（分发线程跟不上，极少见）；各路输出自己队列满丢的记在各自的计数里。
    dropped_frames: AtomicU64,
    channels: usize,
}
// pending、lost 与 placement 的两个访问方（音频回调、流停止后的控制线程）在时间上互斥，其余字段都是原子量。
unsafe impl Sync for Shared {}
impl Shared {
    fn new(channels: usize, capacity: usize) -> Self {
        Self {
            queue: ArrayQueue::new(capacity),
            pending: UnsafeCell::new(EMPTY_BLOCK),
            lost: UnsafeCell::new(0),
            placement: UnsafeCell::new(Placement::default()),
            captured: AtomicU64::new(0),
            next_mono: AtomicU64::new(0f64.to_bits()),
            frame_us: AtomicU64::new((1_000_000.0f64 / 48_000.0).to_bits()),
            stream_stopped: AtomicBool::new(true),
            stop: AtomicBool::new(false),
            distributor_exited: AtomicBool::new(false),
            callback_frames: AtomicU64::new(0),
            last_callback_us: AtomicU64::new(ffi::clock() as u64),
            input_overflows: AtomicU64::new(0),
            input_underflows: AtomicU64::new(0),
            dropped_frames: AtomicU64::new(0),
            channels,
        }
    }
    /// 一路输出开始时的采集累计计数：这一路只报从这里起的增量，暂停后再开的新会话不重复算。
    fn baseline(&self) -> [u64; 3] {
        [
            self.input_overflows.load(Ordering::Relaxed),
            self.input_underflows.load(Ordering::Relaxed),
            self.dropped_frames.load(Ordering::Relaxed),
        ]
    }
}
/// 把一次回调的采样并入合并块；带溢出/欠载标记的回调单独成块，写盘时能定位到发生处。
/// Safety：只能在音频回调线程，或流已停止后的控制线程调用。
unsafe fn accept(
    shared: &Shared,
    input: &[f32],
    count: usize,
    mono_us: f64,
    uncertainty: f64,
    flags: u64,
) {
    let pending = &mut *shared.pending.get();
    let glitch = flags & (PA_INPUT_UNDERFLOW | PA_INPUT_OVERFLOW) != 0;
    if pending.frames > 0 && (glitch || pending.frames + count > BLOCK_FRAMES) {
        flush(shared);
    }
    let ch = shared.channels;
    if pending.frames == 0 {
        pending.mono_us = mono_us;
        pending.uncertainty = uncertainty;
    }
    pending.samples[pending.frames * ch..(pending.frames + count) * ch].copy_from_slice(input);
    pending.frames += count;
    pending.flags |= flags;
    pending.uncertainty = pending.uncertainty.max(uncertainty);
    // 预计下一次同样大小的回调放不下时立即入队，不让整块多等一个回调周期。
    if glitch || pending.frames + count > BLOCK_FRAMES {
        flush(shared);
    }
}
/// Safety：同 accept。
unsafe fn flush(shared: &Shared) {
    let pending = &mut *shared.pending.get();
    if pending.frames == 0 {
        return;
    }
    let lost = &mut *shared.lost.get();
    pending.lost_before = *lost;
    pending.first = shared.captured.load(Ordering::Relaxed);
    if shared.queue.push(*pending).is_ok() {
        *lost = 0;
    } else {
        *lost += pending.frames as u64;
        shared
            .dropped_frames
            .fetch_add(pending.frames as u64, Ordering::Relaxed);
    }
    let frame_us = f64::from_bits(shared.frame_us.load(Ordering::Relaxed));
    shared.next_mono.store(
        (pending.mono_us + pending.frames as f64 * frame_us).to_bits(),
        Ordering::Release,
    );
    shared
        .captured
        .fetch_add(pending.frames as u64, Ordering::Release);
    pending.frames = 0;
    pending.flags = 0;
    pending.lost_before = 0;
}
/// 流停止后（结束或暂停）把最后入队失败的帧也交给分发补静音：等队列腾出一个位置，用不带采样的空块带上丢帧数，
/// 它的时钟是丢掉那段的终点。
/// Safety：只能在流已停止、分发线程仍在运行时由控制线程调用。
unsafe fn settle_lost(shared: &Shared) {
    let lost = &mut *shared.lost.get();
    if *lost == 0 {
        return;
    }
    let marker = Block {
        lost_before: *lost,
        first: shared.captured.load(Ordering::Acquire),
        mono_us: f64::from_bits(shared.next_mono.load(Ordering::Acquire)),
        ..EMPTY_BLOCK
    };
    while shared.queue.push(marker).is_err() {
        if shared.distributor_exited.load(Ordering::Acquire) {
            return;
        }
        thread::sleep(Duration::from_millis(1));
    }
    *lost = 0;
}
extern "C" fn sink(
    user: *mut c_void,
    samples: *const f32,
    frames: c_int,
    mono_us: f64,
    uncertainty: f64,
    flags: c_ulong,
    callback_frames: c_ulong,
) {
    let shared = unsafe { &*(user as *const Shared) };
    shared
        .last_callback_us
        .store(ffi::clock() as u64, Ordering::Relaxed);
    shared
        .callback_frames
        .store(callback_frames as u64, Ordering::Relaxed);
    let count = frames.max(0) as usize;
    if count == 0 || count > BLOCK_FRAMES {
        return;
    }
    let input = unsafe { std::slice::from_raw_parts(samples, count * shared.channels) };
    let flags = flags as u64;
    let frame_us = f64::from_bits(shared.frame_us.load(Ordering::Relaxed));
    let glitch = flags & (PA_INPUT_UNDERFLOW | PA_INPUT_OVERFLOW) != 0;
    let placed = unsafe { (*shared.placement.get()).place(mono_us, count, frame_us, glitch) };
    // 放置值偏离测得值多少，就把多少计入时钟误差。
    let uncertainty = uncertainty + (placed - mono_us).abs();
    unsafe { accept(shared, input, count, placed, uncertainty, flags) }
}

/// 一路输出在整次采集里的录制区间：只写 `first` 落在某个 [from, until) 里的块，丢掉的帧按它们覆盖的位置归属。
/// 暂停、继续、停止都在按下的那一刻定下边界，排着队的块照样按边界写进去。
struct Gate {
    spans: Vec<(u64, Option<u64>)>,
    /// 停止中：越过最后的终点（或流已停、队列排空、设备不再出数据）就收尾。
    closing: bool,
}
impl Gate {
    fn open(from: u64) -> Self {
        Self {
            spans: vec![(from, None)],
            closing: false,
        }
    }
    fn contains(&self, first: u64) -> bool {
        self.spans
            .iter()
            .any(|&(from, until)| first >= from && until.map_or(true, |u| first < u))
    }
    /// [start, end) 里落在录制区间内的帧数。
    fn overlap(&self, start: u64, end: u64) -> u64 {
        self.spans
            .iter()
            .map(|&(from, until)| {
                let a = start.max(from);
                let b = until.map_or(end, |u| end.min(u));
                b.saturating_sub(a)
            })
            .sum()
    }
    fn until(&self) -> Option<u64> {
        self.spans.last().and_then(|span| span.1)
    }
    fn passed(&self, block: &Block) -> bool {
        self.until().map_or(false, |u| block.first >= u)
    }
    fn pause(&mut self, at: u64) {
        if let Some(last) = self.spans.last_mut() {
            last.1.get_or_insert(at);
        }
    }
    fn resume(&mut self, at: u64) {
        self.spans.push((at, None));
    }
    /// 分发已越过的旧区间不再需要；最后一段留着判断暂停与收尾。
    fn prune(&mut self, through: u64) {
        let last = self.spans.len().saturating_sub(1);
        let mut index = 0;
        self.spans.retain(|span| {
            index += 1;
            index - 1 == last || span.1.map_or(true, |u| u >= through)
        });
    }
}

/// 每路输出的计数与收尾信号：写盘线程写，控制线程与上报只读，不用锁。
#[derive(Default)]
pub struct Stats {
    frames: AtomicU64,
    bytes: AtomicU64,
    /// 这一路自己的队列满时丢的帧（已补静音）。
    dropped_frames: AtomicU64,
    dropped_preview: AtomicU64,
    max_write_us: AtomicU64,
    /// 最近一次缺口在这一路文件里的帧位置。
    last_glitch_frame: AtomicU64,
    /// 分发线程不再交新块：写盘线程排空自己的队列、补上收尾的丢帧后封口。
    finish: AtomicBool,
    tail_lost: AtomicU64,
    tail_mono: AtomicU64,
    /// 写盘线程已退出（正常收尾或写盘失败）。
    ended: AtomicBool,
    error: Mutex<Option<String>>,
    #[cfg(test)]
    stall: AtomicBool,
}
impl Stats {
    fn finish(&self, lost: u64, mono_us: f64) {
        self.tail_lost.store(lost, Ordering::Relaxed);
        self.tail_mono.store(mono_us.to_bits(), Ordering::Relaxed);
        self.finish.store(true, Ordering::Release);
    }
}
/// 分发线程这边的一路输出：区间、它自己的写盘队列、队列满时攒下的丢帧。
struct Route {
    id: String,
    gate: Gate,
    queue: Arc<ArrayQueue<Block>>,
    stats: Arc<Stats>,
    lost: u64,
    closing_since: Option<Instant>,
    /// 分段轨道暂停在这一帧：分发越过它时给写盘线程一个封段标记，暂停前的段及时封口、继续后的采样另起一段。
    seal_at: Option<u64>,
}
impl Route {
    /// 越过暂停边界时交封段标记，带上这一块之前落在区间里的丢帧（它们在暂停前）：写盘先补静音再封口。
    /// 返回 false 表示队列满、标记没交出去：丢帧已记下，标记等下一块再交。
    fn seal_if_passed(&mut self, block: &Block, lost: u64) -> bool {
        let marker = Block {
            flags: SEAL_SEGMENT,
            lost_before: self.lost + lost,
            first: block.first,
            mono_us: block.mono_us,
            ..EMPTY_BLOCK
        };
        if self.queue.push(marker).is_ok() {
            self.lost = 0;
            self.seal_at = None;
            true
        } else {
            self.lost += lost;
            false
        }
    }
    fn deliver(&mut self, mut item: Block) {
        item.lost_before += self.lost;
        let admitted = item.frames as u64;
        match self.queue.push(item) {
            Ok(()) => self.lost = 0,
            Err(item) => {
                self.lost = item.lost_before + admitted;
                self.stats
                    .dropped_frames
                    .fetch_add(admitted, Ordering::Relaxed);
            }
        }
    }
    fn route(&mut self, block: &Block) {
        // 丢掉的帧按它们覆盖的位置归属：只补落在这一路区间里的那部分。
        let mut lost = self
            .gate
            .overlap(block.first.saturating_sub(block.lost_before), block.first);
        let mut admitted = block.frames > 0 && self.gate.contains(block.first);
        if self.seal_at.is_some_and(|at| block.first >= at) {
            if !self.seal_if_passed(block, lost) && admitted {
                // 标记没交出去时，继续之后的这一块不能先于它写进暂停前的段：按丢弃计，新段从之后的块开始。
                self.stats
                    .dropped_frames
                    .fetch_add(block.frames as u64, Ordering::Relaxed);
                admitted = false;
            }
            lost = 0;
        }
        if lost > 0 || admitted {
            let mut item = *block;
            item.lost_before = lost;
            if !admitted {
                item.frames = 0;
            }
            self.deliver(item);
        }
        if self.gate.closing && self.gate.passed(block) {
            self.stats
                .finish(std::mem::take(&mut self.lost), block.mono_us);
        }
    }
    fn finished(&self) -> bool {
        self.stats.finish.load(Ordering::Relaxed) || self.stats.ended.load(Ordering::Relaxed)
    }
}
fn distribute(shared: Arc<Shared>, routes: Arc<Mutex<Vec<Route>>>) {
    // 已分发到整次采集的哪一帧。
    let mut through = 0u64;
    loop {
        if let Some(block) = shared.queue.pop() {
            if block.flags & PA_INPUT_OVERFLOW != 0 {
                shared.input_overflows.fetch_add(1, Ordering::Relaxed);
            }
            if block.flags & PA_INPUT_UNDERFLOW != 0 {
                shared.input_underflows.fetch_add(1, Ordering::Relaxed);
            }
            through = through.max(block.first + block.frames as u64);
            let mut routes = routes.lock().unwrap();
            for route in routes.iter_mut().filter(|r| !r.finished()) {
                route.route(&block);
                route.gate.prune(through);
            }
            routes.retain(|r| !r.finished());
            continue;
        }
        let stop = shared.stop.load(Ordering::Acquire);
        let stopped = shared.stream_stopped.load(Ordering::Acquire);
        let mono = f64::from_bits(shared.next_mono.load(Ordering::Acquire));
        {
            let mut routes = routes.lock().unwrap();
            for route in routes.iter_mut().filter(|r| !r.finished()) {
                let idle = route
                    .closing_since
                    .is_some_and(|since| since.elapsed() >= IDLE_FINISH);
                let reached = route.gate.until().map_or(true, |u| through >= u);
                if stop || (route.gate.closing && (stopped || reached || idle)) {
                    // 采集到了、却因为队列满丢掉而没有后续块带下来的帧：收尾时按区间补上。
                    let tail = route
                        .gate
                        .until()
                        .map_or(0, |u| route.gate.overlap(through, u));
                    route
                        .stats
                        .finish(std::mem::take(&mut route.lost) + tail, mono);
                }
            }
            routes.retain(|r| !r.finished());
        }
        if stop {
            break;
        }
        thread::sleep(Duration::from_millis(2));
    }
    shared.distributor_exited.store(true, Ordering::Release);
}

/// 音频编辑（或讲解）的整段文件：可暂停；推流时把采样与电平交给主进程。
pub struct FileSink {
    wav: Wav,
    path: String,
    stream: bool,
    sequence: u64,
    checkpoint: Instant,
    peak: Vec<f32>,
    sum: Vec<f64>,
    meter_frames: usize,
}
impl FileSink {
    pub fn create(
        path: &str,
        rate: u32,
        channels: usize,
        bits: u16,
        stream: bool,
    ) -> Result<Self, String> {
        let wav = Wav::create(Path::new(path), rate, channels as u16, bits).map_err(io_error)?;
        WRITING.lock().unwrap().push(path.to_string());
        Ok(Self {
            wav,
            path: path.to_string(),
            stream,
            sequence: 0,
            checkpoint: Instant::now(),
            peak: vec![0.0; channels],
            sum: vec![0.0; channels],
            meter_frames: 0,
        })
    }
}
impl Drop for FileSink {
    fn drop(&mut self) {
        let mut writing = WRITING.lock().unwrap();
        if let Some(index) = writing.iter().position(|item| *item == self.path) {
            writing.remove(index);
        }
    }
}
pub enum Sink {
    File(FileSink),
    /// 录屏的麦克风轨：5 秒一段写进录制目录，与系统声同一个分段写盘器。
    Track(segments::Writer),
}
impl Sink {
    fn write(
        &mut self,
        id: &str,
        block: &Block,
        stats: &Stats,
        channels: usize,
        rate: f64,
        preview: &mpsc::SyncSender<Lossy>,
    ) -> Result<(), String> {
        let ch = channels;
        let samples = &block.samples[..block.frames * ch];
        if block.lost_before > 0 || block.flags & (PA_INPUT_UNDERFLOW | PA_INPUT_OVERFLOW) != 0 {
            stats
                .last_glitch_frame
                .store(stats.frames.load(Ordering::Acquire), Ordering::Relaxed);
        }
        match self {
            Sink::Track(writer) => {
                if block.lost_before > 0 {
                    writer.write(
                        block.lost_before,
                        block.mono_us - block.lost_before as f64 * 1_000_000.0 / rate,
                        block.uncertainty,
                        None,
                    )?;
                }
                if block.flags & SEAL_SEGMENT != 0 {
                    writer.seal()?;
                }
                if block.frames > 0 {
                    writer.write(
                        block.frames as u64,
                        block.mono_us,
                        block.uncertainty,
                        Some(samples),
                    )?;
                }
                stats.frames.store(writer.frames(), Ordering::Release);
                stats.bytes.store(writer.bytes(), Ordering::Release);
            }
            Sink::File(file) => {
                if block.lost_before > 0 {
                    // 写盘跟不上、队列满时丢掉的采样补成等长静音：文件时长仍等于实际录制时长，后面的声音不会整体提前。
                    let silence = [0.0f32; 2048];
                    let mut left = block.lost_before as usize;
                    while left > 0 {
                        let n = left.min(BLOCK_FRAMES);
                        file.wav.write(&silence[..n * ch]).map_err(io_error)?;
                        left -= n;
                    }
                    stats.frames.fetch_add(block.lost_before, Ordering::AcqRel);
                    stats.bytes.store(file.wav.bytes, Ordering::Release);
                }
                if block.frames == 0 {
                    return Ok(());
                }
                file.wav.write(samples).map_err(io_error)?;
                let first_frame = stats
                    .frames
                    .fetch_add(block.frames as u64, Ordering::AcqRel);
                stats.bytes.store(file.wav.bytes, Ordering::Release);
                if file.checkpoint.elapsed() >= Duration::from_secs(1) {
                    file.wav.checkpoint().map_err(io_error)?;
                    file.checkpoint = Instant::now();
                }
                for (i, &sample) in samples.iter().enumerate() {
                    let c = i % ch;
                    file.peak[c] = file.peak[c].max(sample.abs());
                    file.sum[c] += (sample as f64).powi(2);
                }
                file.meter_frames += block.frames;
                // 预览与电平只是观察数据：通道满了直接丢，写盘线程绝不等主进程读管道。
                if file.stream {
                    let bytes: Vec<u8> = samples.iter().flat_map(|s| s.to_le_bytes()).collect();
                    let sent = preview.try_send((
                        json!({"event":"samples","sessionId":id,"sequence":file.sequence,"firstFrame":first_frame,"frames":block.frames,"channels":ch,"sampleRate":rate,"nativeMonoUs":block.mono_us,"uncertaintyUs":block.uncertainty,"format":"float32le"}),
                        bytes,
                    ));
                    if sent.is_err() {
                        stats.dropped_preview.fetch_add(1, Ordering::Relaxed);
                    }
                }
                file.sequence += 1;
                if file.meter_frames as f64 / rate >= 0.033 {
                    let rms: Vec<f64> = file
                        .sum
                        .iter()
                        .map(|s| (s / file.meter_frames as f64).sqrt())
                        .collect();
                    let clipped: Vec<bool> = file.peak.iter().map(|p| *p >= 0.999969).collect();
                    // 电平丢一条不计数：下一条 33 ms 后就会覆盖它。
                    let _ = preview.try_send((
                        json!({"event":"level","sessionId":id,"peak":file.peak,"rms":rms,"clipped":clipped,"durationSeconds":(first_frame+block.frames as u64) as f64/rate,"writtenBytes":file.wav.bytes}),
                        Vec::new(),
                    ));
                    file.peak.fill(0.0);
                    file.sum.fill(0.0);
                    file.meter_frames = 0;
                }
            }
        }
        Ok(())
    }
    /// 封口：整段文件更新文件头，分段轨道封最后一段。
    fn seal(&mut self, stats: &Stats) -> Result<(), String> {
        let sealed = match self {
            Sink::File(file) => {
                let saved = file.wav.checkpoint().map_err(io_error);
                stats.bytes.store(file.wav.bytes, Ordering::Release);
                saved
            }
            Sink::Track(writer) => {
                let sealed = writer.seal();
                stats.bytes.store(writer.bytes(), Ordering::Release);
                sealed
            }
        };
        sealed
    }
}

/// 一路输出的写盘线程：先建好写入端（整段文件要建文件，可能碰上慢盘），再只写自己的队列。
/// 写盘失败只结束这一路；正常收尾在分发线程给出结束信号、队列排空之后。
#[allow(clippy::too_many_arguments)]
fn write_output(
    id: String,
    make: Box<dyn FnOnce() -> Result<Sink, String> + Send>,
    queue: Arc<ArrayQueue<Block>>,
    stats: Arc<Stats>,
    channels: usize,
    rate: f64,
    preview: mpsc::SyncSender<Lossy>,
    ready: mpsc::Sender<Result<(), String>>,
    done: mpsc::Sender<Result<(), String>>,
) {
    let _alive = Alive::new();
    let mut sink = match make() {
        Ok(sink) => sink,
        Err(error) => {
            stats.ended.store(true, Ordering::Release);
            let _ = ready.send(Err(error));
            return;
        }
    };
    // 等它的一方已放弃（建文件超时）：这一路没有登记，删掉这里刚建出的空文件再退出。
    if ready.send(Ok(())).is_err() {
        stats.ended.store(true, Ordering::Release);
        if let Sink::File(file) = sink {
            let path = file.path.clone();
            drop(file);
            let _ = std::fs::remove_file(path);
        }
        return;
    }
    let mut result = Ok(());
    loop {
        if let Some(block) = queue.pop() {
            #[cfg(test)]
            while stats.stall.load(Ordering::Acquire) {
                thread::sleep(Duration::from_millis(1));
            }
            let started = Instant::now();
            if let Err(error) = sink.write(&id, &block, &stats, channels, rate, &preview) {
                result = Err(error);
                break;
            }
            stats
                .max_write_us
                .fetch_max(started.elapsed().as_micros() as u64, Ordering::Relaxed);
        } else if stats.finish.load(Ordering::Acquire) {
            // 结束信号之前交下的块可能刚好在读到信号之后才可见：再排空一次。
            if !queue.is_empty() {
                continue;
            }
            let lost = stats.tail_lost.load(Ordering::Relaxed);
            if lost > 0 {
                let marker = Block {
                    lost_before: lost,
                    mono_us: f64::from_bits(stats.tail_mono.load(Ordering::Relaxed)),
                    ..EMPTY_BLOCK
                };
                result = sink.write(&id, &marker, &stats, channels, rate, &preview);
            }
            break;
        } else {
            thread::sleep(Duration::from_millis(2));
        }
    }
    let result = result.and(sink.seal(&stats));
    if let Err(error) = &result {
        *stats.error.lock().unwrap() = Some(error.clone());
    }
    // 写入端（含分段写盘器持有的事件发送端）先放下，再报结束。
    drop(sink);
    stats.ended.store(true, Ordering::Release);
    let _ = done.send(result);
}

/// 一路输出的状态与健康计数来源；停止的应答由后台线程发，所以能整体带走。
#[derive(Clone)]
pub struct Report {
    pub id: String,
    /// 整段文件的路径，或分段轨道的目录。
    pub path: String,
    pub track: bool,
    stats: Arc<Stats>,
    shared: Arc<Shared>,
    /// 采集层计数的基线：开始时的累计值，加上暂停期间涨的（暂停那段不算这一路的）。
    base: Arc<[AtomicU64; 3]>,
    rate: f64,
    latency: f64,
    bits: u16,
    device: String,
    joined: bool,
}
impl Report {
    /// 采集层计数在这一路录着的期间涨了多少。
    fn grown(&self) -> [u64; 3] {
        let now = self.shared.baseline();
        [0, 1, 2].map(|i| now[i].saturating_sub(self.base[i].load(Ordering::Relaxed)))
    }
    /// 这一路期间的健康计数：采集层的增量，加上这一路自己的。
    fn health(&self) -> Value {
        let grown = self.grown();
        json!({
            "inputOverflows": grown[0],
            "inputUnderflows": grown[1],
            "droppedFrames": grown[2] + self.stats.dropped_frames.load(Ordering::Relaxed),
            "droppedPreviewBlocks": self.stats.dropped_preview.load(Ordering::Relaxed),
            "maxWriteMs": self.stats.max_write_us.load(Ordering::Relaxed) as f64 / 1000.0,
            "lastGlitchSeconds": self.stats.last_glitch_frame.load(Ordering::Relaxed) as f64 / self.rate,
        })
    }
    fn signature(&self) -> [u64; 5] {
        let grown = self.grown();
        [
            grown[0],
            grown[1],
            grown[2] + self.stats.dropped_frames.load(Ordering::Relaxed),
            self.stats.dropped_preview.load(Ordering::Relaxed),
            // 写盘峰值按 100 ms 一档上报，小抖动不刷日志。
            self.stats.max_write_us.load(Ordering::Relaxed) / 100_000,
        ]
    }
    fn status(&self, state: &str) -> Value {
        let frames = self.stats.frames.load(Ordering::Acquire);
        json!({"sessionId":self.id,"outputPath":self.path,"state":state,"sampleRate":self.rate,"inputLatency":self.latency,
            "callbackFrames":self.shared.callback_frames.load(Ordering::Relaxed),"frames":frames,"writtenBytes":self.stats.bytes.load(Ordering::Acquire),
            "durationSeconds":frames as f64 / self.rate,"health":self.health(),
            "device":self.device,"channels":self.shared.channels,"bitDepth":self.bits,"joined":self.joined})
    }
    fn error(&self) -> Option<String> {
        self.stats.error.lock().unwrap().clone()
    }
}
/// 一路输出写完之后要做的事：应答停止、报中断，或什么都不做（进程退出）。
pub enum Outcome {
    Reply(Value),
    Interrupted(String),
    Quiet,
}
/// 后台等这一路写完、封口，确认段事件已发出，再应答或报中断。控制线程不等磁盘。
fn settle(
    report: Report,
    done: mpsc::Receiver<Result<(), String>>,
    events: Option<mpsc::Sender<Reliable>>,
    outcome: Outcome,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        let written = done.recv_timeout(STOP_WAIT);
        if let Some(events) = events {
            let (tx, rx) = mpsc::channel();
            if events.send(Reliable::Barrier(tx)).is_ok() {
                let _ = rx.recv_timeout(BARRIER_WAIT);
            }
        }
        match outcome {
            Outcome::Quiet => {}
            Outcome::Reply(id) => match written {
                Ok(Ok(())) => emit(
                    json!({"id":id,"ok":true,"result":report.status("stopped")}),
                    &[],
                ),
                Ok(Err(error)) => emit(json!({"id":id,"ok":false,"error":failure(&error)}), &[]),
                // 磁盘卡得太久：如实回报还在收尾，写盘线程照常写完、封口事件随后到达。
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    let mut status = report.status("stopped");
                    status["pending"] = json!(true);
                    emit(json!({"id":id,"ok":true,"result":status}), &[])
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => emit(
                    json!({"id":id,"ok":false,"error":failure("CAPTURE_FAILED|录音写入线程异常，已录部分可恢复")}),
                    &[],
                ),
            },
            Outcome::Interrupted(error) => {
                let error = report
                    .error()
                    .filter(|_| !matches!(written, Ok(Ok(()))))
                    .unwrap_or(error);
                emit(
                    json!({"event":"interrupted","sessionId":report.id,"outputPath":report.path,"error":failure(&error),"writtenBytes":report.stats.bytes.load(Ordering::Acquire),"health":report.health()}),
                    &[],
                );
            }
        }
    })
}

/// 控制线程这边记着的一路输出。
struct Handle {
    report: Report,
    paused: bool,
    /// 暂停时的采集层累计计数：继续时把暂停期间涨的并进基线。
    paused_counts: [u64; 3],
    done: mpsc::Receiver<Result<(), String>>,
    health_sent: [u64; 5],
}
/// 麦克风的一路采集（一个 PortAudio 流），交给一路或几路输出；所有输出都结束才关设备。
pub struct Capture {
    capture: *mut c_void,
    shared: Arc<Shared>,
    routes: Arc<Mutex<Vec<Route>>>,
    handles: Vec<Handle>,
    distributor: Option<thread::JoinHandle<()>>,
    streamer: Option<thread::JoinHandle<()>>,
    events: Option<mpsc::Sender<Reliable>>,
    /// 控制线程上报健康计数也走可丢通道，主进程不读管道时不会卡住控制线程。
    preview: Option<mpsc::SyncSender<Lossy>>,
    rate: f64,
    latency: f64,
    pub bits: u16,
    device: String,
    exclusive: bool,
    health_at: Instant,
}
impl Capture {
    pub fn open(settings: &Settings) -> Result<Self, String> {
        let mut options = settings.options()?;
        let device = ffi::string(ffi::device(settings.device)?.name);
        let shared = Arc::new(Shared::new(settings.channels as usize, CAPTURE_BLOCKS));
        let (mut error, mut rate, mut latency) = (0, 0.0, 0.0);
        let capture = unsafe {
            ffi::hc_open(
                &mut options,
                sink,
                Arc::as_ptr(&shared) as *mut c_void,
                &mut error,
                &mut rate,
                &mut latency,
            )
        };
        ffi::check(error, settings.exclusive)?;
        shared
            .frame_us
            .store((1_000_000.0 / rate.max(1.0)).to_bits(), Ordering::Relaxed);
        let (events, reliable) = mpsc::channel::<Reliable>();
        let (preview, lossy) = mpsc::sync_channel::<Lossy>(PREVIEW_MESSAGES);
        let streamer = spawn_streamer(reliable, lossy);
        let routes = Arc::new(Mutex::new(Vec::new()));
        let (s, r) = (shared.clone(), routes.clone());
        let distributor = thread::spawn(move || distribute(s, r));
        Ok(Self {
            capture,
            shared,
            routes,
            handles: Vec::new(),
            distributor: Some(distributor),
            streamer: Some(streamer),
            events: Some(events),
            preview: Some(preview),
            rate,
            latency,
            bits: settings.bit_depth as u16,
            device,
            exclusive: settings.exclusive,
            health_at: Instant::now(),
        })
    }
    pub fn is_empty(&self) -> bool {
        self.handles.is_empty()
    }
    pub fn running(&self) -> bool {
        !self.shared.stream_stopped.load(Ordering::Acquire)
    }
    fn start_stream(&mut self) -> Result<(), String> {
        self.shared
            .last_callback_us
            .store(ffi::clock() as u64, Ordering::Relaxed);
        // 流停着，回调不会同时访问：重新开流后的时刻与之前不连续，从第一块重新放置。
        unsafe { *self.shared.placement.get() = Placement::default() };
        ffi::check(unsafe { ffi::hc_start(self.capture) }, self.exclusive)?;
        self.shared.stream_stopped.store(false, Ordering::Release);
        Ok(())
    }
    fn stop_stream(&mut self) -> i32 {
        let code = unsafe { ffi::hc_stop(self.capture) };
        // 回调已经停下，合并块里剩下的采样与最后没能入队的丢帧数由控制线程交给分发。
        unsafe {
            flush(&self.shared);
            settle_lost(&self.shared);
        }
        self.shared.stream_stopped.store(true, Ordering::Release);
        code
    }
    /// 设备停止提供采样：流开着却超过 5 秒没有回调，或驱动报告流已不活动。
    pub fn disconnected(&self) -> bool {
        let stalled = ffi::clock() - self.shared.last_callback_us.load(Ordering::Relaxed) as f64
            > 5_000_000.0;
        self.running() && (unsafe { ffi::hc_active(self.capture) } != 1 || stalled)
    }
    pub fn has_file(&self) -> bool {
        self.handles.iter().any(|h| !h.report.track)
    }
    pub fn owns(&self, id: &str) -> bool {
        self.handles.iter().any(|h| h.report.id == id)
    }
    fn index(&self, id: &str) -> usize {
        self.handles.iter().position(|h| h.report.id == id).unwrap()
    }
    /// 新开一路输出：写入端在它自己的线程里建好（建文件可能碰上慢盘，有上限地等），从此刻起的块都交给它。
    fn add(
        &mut self,
        id: String,
        path: String,
        track: bool,
        bits: u16,
        joined: bool,
        make: Box<dyn FnOnce() -> Result<Sink, String> + Send>,
    ) -> Result<Value, String> {
        let queue = Arc::new(ArrayQueue::new(OUTPUT_BLOCKS));
        let stats = Arc::new(Stats::default());
        let (ready_tx, ready) = mpsc::channel();
        let (done_tx, done) = mpsc::channel();
        let (q, s, p, ch, rate, writer_id) = (
            queue.clone(),
            stats.clone(),
            self.preview.clone().unwrap(),
            self.shared.channels,
            self.rate,
            id.clone(),
        );
        thread::spawn(move || write_output(writer_id, make, q, s, ch, rate, p, ready_tx, done_tx));
        match ready.recv_timeout(CREATE_WAIT) {
            Ok(Ok(())) => {}
            Ok(Err(error)) => return Err(error),
            Err(_) => {
                return Err("FILE_ERROR|磁盘没有响应，录音文件没能创建，请检查磁盘后重试".into())
            }
        }
        let base = Arc::new(self.shared.baseline().map(AtomicU64::new));
        self.routes.lock().unwrap().push(Route {
            id: id.clone(),
            gate: Gate::open(self.shared.captured.load(Ordering::Acquire)),
            queue,
            stats: stats.clone(),
            lost: 0,
            closing_since: None,
            seal_at: None,
        });
        self.handles.push(Handle {
            report: Report {
                id: id.clone(),
                path,
                track,
                stats,
                shared: self.shared.clone(),
                base,
                rate: self.rate,
                latency: self.latency,
                bits,
                device: self.device.clone(),
                joined,
            },
            paused: false,
            paused_counts: [0; 3],
            done,
            health_sent: [0; 5],
        });
        if !self.running() {
            if let Err(error) = self.start_stream() {
                drop(self.discard(&id));
                return Err(error);
            }
        }
        Ok(self.status(&id).unwrap())
    }
    pub fn add_file(
        &mut self,
        id: String,
        path: String,
        bits: u16,
        stream: bool,
        joined: bool,
    ) -> Result<Value, String> {
        let (rate, ch, file) = (self.rate.round() as u32, self.shared.channels, path.clone());
        self.add(
            id,
            path,
            false,
            bits,
            joined,
            Box::new(move || Ok(Sink::File(FileSink::create(&file, rate, ch, bits, stream)?))),
        )
    }
    pub fn add_track(
        &mut self,
        id: String,
        directory: String,
        joined: bool,
    ) -> Result<Value, String> {
        let dir = Path::new(&directory);
        if !dir.is_absolute() || !dir.is_dir() {
            return Err("FILE_ERROR|麦克风轨的录制目录不存在".into());
        }
        let writer = segments::Writer::new(
            id.clone(),
            dir,
            self.rate.round() as u32,
            self.shared.channels,
            self.bits,
            self.events.clone().unwrap(),
            self.preview.clone(),
        );
        let bits = self.bits;
        self.add(
            id,
            directory,
            true,
            bits,
            joined,
            Box::new(move || Ok(Sink::Track(writer))),
        )
    }
    /// 拿掉一路：分发不再交块，写盘线程写完已排队的就封口退出。返回它的状态来源与结束通知。
    fn discard(&mut self, id: &str) -> Handle {
        let mono = f64::from_bits(self.shared.next_mono.load(Ordering::Acquire));
        let mut routes = self.routes.lock().unwrap();
        if let Some(route) = routes.iter_mut().find(|r| r.id == id) {
            route.stats.finish(std::mem::take(&mut route.lost), mono);
        }
        routes.retain(|r| r.id != id);
        drop(routes);
        let index = self.index(id);
        self.handles.remove(index)
    }
    pub fn status(&self, id: &str) -> Option<Value> {
        let h = self.handles.iter().find(|h| h.report.id == id)?;
        Some(
            h.report
                .status(if h.paused { "paused" } else { "recording" }),
        )
    }
    /// 计数有变化时最多每秒报一次，每路输出各报自己的；通道满了这一秒先不报，计数是累计值，下一次照样带全。
    pub fn report_health(&mut self) {
        if self.health_at.elapsed() < Duration::from_secs(1) {
            return;
        }
        self.health_at = Instant::now();
        let Some(preview) = &self.preview else {
            return;
        };
        for h in &mut self.handles {
            let signature = h.report.signature();
            if signature == h.health_sent {
                continue;
            }
            let frames = h.report.stats.frames.load(Ordering::Acquire);
            let report = json!({"event":"health","sessionId":h.report.id,"durationSeconds":frames as f64 / self.rate,"health":h.report.health()});
            if preview.try_send((report, Vec::new())).is_ok() {
                h.health_sent = signature;
            }
        }
    }
    /// 写盘失败而结束的那几路：从登记里拿掉，后台确认段事件发出后报中断。
    pub fn collect_failures(&mut self) -> Vec<thread::JoinHandle<()>> {
        let failed: Vec<String> = self
            .handles
            .iter()
            .filter(|h| h.report.stats.ended.load(Ordering::Acquire))
            .map(|h| h.report.id.clone())
            .collect();
        failed
            .into_iter()
            .map(|id| {
                let handle = self.discard(&id);
                let error = handle
                    .report
                    .error()
                    .unwrap_or_else(|| "FILE_ERROR|录音文件写入失败，已录部分保留".into());
                settle(
                    handle.report,
                    handle.done,
                    self.events.clone(),
                    Outcome::Interrupted(error),
                )
            })
            .collect()
    }
    /// 停止一路：按下这一刻定终点，分发越过它（或流已停、设备不再出数据）就让那一路收尾；
    /// 应答由后台线程在写完、封口、段事件发出之后发，控制线程立即返回。
    pub fn stop(&mut self, id: &str, reply: Value) -> Result<thread::JoinHandle<()>, String> {
        let others_running = self
            .handles
            .iter()
            .any(|h| h.report.id != id && Self::needs_stream(h));
        if self.running() && !others_running {
            ffi::check(self.stop_stream(), false)?;
        }
        let until = self.shared.captured.load(Ordering::Acquire);
        if let Some(route) = self.routes.lock().unwrap().iter_mut().find(|r| r.id == id) {
            route.gate.pause(until);
            route.gate.closing = true;
            route.closing_since = Some(Instant::now());
        }
        let index = self.index(id);
        let handle = self.handles.remove(index);
        Ok(settle(
            handle.report,
            handle.done,
            self.events.clone(),
            Outcome::Reply(reply),
        ))
    }
    /// 这一路要不要流开着：在录的都要；暂停的分段轨道也要，继续时直接接上。
    fn needs_stream(h: &Handle) -> bool {
        !h.paused || h.report.track
    }
    pub fn pause(&mut self, id: &str) -> Result<Value, String> {
        let index = self.index(id);
        if !self.handles[index].paused {
            let track = self.handles[index].report.track;
            if !track
                && !self
                    .handles
                    .iter()
                    .any(|h| h.report.id != id && Self::needs_stream(h))
            {
                ffi::check(self.stop_stream(), false)?;
            }
            let until = self.shared.captured.load(Ordering::Acquire);
            if let Some(route) = self.routes.lock().unwrap().iter_mut().find(|r| r.id == id) {
                route.gate.pause(until);
                if track {
                    route.seal_at = Some(until);
                }
            }
            self.handles[index].paused = true;
            self.handles[index].paused_counts = self.shared.baseline();
        }
        Ok(self.status(id).unwrap())
    }
    pub fn resume(&mut self, id: &str) -> Result<Value, String> {
        let index = self.index(id);
        if self.handles[index].paused {
            let from = self.shared.captured.load(Ordering::Acquire);
            if let Some(route) = self.routes.lock().unwrap().iter_mut().find(|r| r.id == id) {
                route.gate.resume(from);
            }
            if !self.running() {
                self.start_stream()?;
            }
            let (now, handle) = (self.shared.baseline(), &self.handles[index]);
            for (i, base) in handle.report.base.iter().enumerate() {
                base.fetch_add(
                    now[i].saturating_sub(handle.paused_counts[i]),
                    Ordering::Relaxed,
                );
            }
            self.handles[index].paused = false;
        }
        Ok(self.status(id).unwrap())
    }
    /// 关设备：分发排空采集队列、让每路收尾；每路写完后按 `outcome` 报（中断或不报）。控制线程不等写盘。
    /// 返回要在进程退出前等完的后台线程。
    pub fn close(mut self, outcome: impl Fn(&Report) -> Outcome) -> Vec<thread::JoinHandle<()>> {
        let mut background = Vec::new();
        if !self.capture.is_null() {
            self.stop_stream();
            unsafe {
                ffi::hc_close(self.capture);
            }
            self.capture = std::ptr::null_mut();
        }
        self.shared.stop.store(true, Ordering::Release);
        if let Some(distributor) = self.distributor.take() {
            let _ = distributor.join();
        }
        for handle in std::mem::take(&mut self.handles) {
            let outcome = outcome(&handle.report);
            background.push(settle(
                handle.report,
                handle.done,
                self.events.clone(),
                outcome,
            ));
        }
        // 每路写完会放下自己的事件发送端；这里也放下，推流线程发完剩下的就退出。
        self.events = None;
        self.preview = None;
        background.extend(self.streamer.take());
        background
    }
}
impl Drop for Capture {
    fn drop(&mut self) {
        if !self.capture.is_null() {
            self.stop_stream();
            unsafe {
                ffi::hc_close(self.capture);
            }
            self.capture = std::ptr::null_mut();
        }
        self.shared.stop.store(true, Ordering::Release);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn feed(shared: &Shared, blocks: usize, frames: usize, flags_at: Option<usize>) {
        let input = vec![0.25f32; frames * shared.channels];
        for i in 0..blocks {
            let flags = if flags_at == Some(i) {
                PA_INPUT_OVERFLOW
            } else {
                0
            };
            unsafe { accept(shared, &input, frames, i as f64 * 10_000.0, 1.0, flags) };
        }
        unsafe { flush(shared) };
    }
    /// 不开设备的一路采集：分发线程 + 若干路输出，块由测试直接喂进采集队列。
    struct Rig {
        shared: Arc<Shared>,
        routes: Arc<Mutex<Vec<Route>>>,
        distributor: Option<thread::JoinHandle<()>>,
        preview: mpsc::SyncSender<Lossy>,
        previews: mpsc::Receiver<Lossy>,
    }
    impl Rig {
        fn new(channels: usize, capacity: usize) -> Self {
            let shared = Arc::new(Shared::new(channels, capacity));
            let routes = Arc::new(Mutex::new(Vec::new()));
            let (preview, previews) = mpsc::sync_channel(4096);
            Self {
                shared,
                routes,
                distributor: None,
                preview,
                previews,
            }
        }
        fn run(&mut self) {
            let (s, r) = (self.shared.clone(), self.routes.clone());
            self.distributor = Some(thread::spawn(move || distribute(s, r)));
        }
        fn output(
            &self,
            id: &str,
            make: Box<dyn FnOnce() -> Result<Sink, String> + Send>,
        ) -> (Arc<Stats>, mpsc::Receiver<Result<(), String>>) {
            let queue = Arc::new(ArrayQueue::new(OUTPUT_BLOCKS));
            let stats = Arc::new(Stats::default());
            let (ready_tx, ready) = mpsc::channel();
            let (done_tx, done) = mpsc::channel();
            let (q, s, p, ch, writer_id) = (
                queue.clone(),
                stats.clone(),
                self.preview.clone(),
                self.shared.channels,
                id.to_string(),
            );
            thread::spawn(move || {
                write_output(writer_id, make, q, s, ch, 48000.0, p, ready_tx, done_tx)
            });
            ready.recv().unwrap().unwrap();
            self.routes.lock().unwrap().push(Route {
                id: id.into(),
                gate: Gate::open(self.shared.captured.load(Ordering::Acquire)),
                queue,
                stats: stats.clone(),
                lost: 0,
                closing_since: None,
                seal_at: None,
            });
            (stats, done)
        }
        fn file(
            &self,
            id: &str,
            path: &Path,
            stream: bool,
        ) -> (Arc<Stats>, mpsc::Receiver<Result<(), String>>) {
            let (path, ch) = (path.to_str().unwrap().to_string(), self.shared.channels);
            self.output(
                id,
                Box::new(move || Ok(Sink::File(FileSink::create(&path, 48000, ch, 24, stream)?))),
            )
        }
        fn track(
            &self,
            id: &str,
            dir: &Path,
            events: mpsc::Sender<Reliable>,
        ) -> (Arc<Stats>, mpsc::Receiver<Result<(), String>>) {
            let writer = segments::Writer::new(
                id.into(),
                dir,
                48000,
                self.shared.channels,
                24,
                events,
                None,
            );
            self.output(id, Box::new(move || Ok(Sink::Track(writer))))
        }
        fn gate(&self, id: &str, change: impl FnOnce(&mut Route)) {
            change(
                self.routes
                    .lock()
                    .unwrap()
                    .iter_mut()
                    .find(|r| r.id == id)
                    .unwrap(),
            )
        }
        fn captured(&self) -> u64 {
            self.shared.captured.load(Ordering::Acquire)
        }
        /// 停流、排空、让每路收尾，等写盘线程都退出。
        fn finish(mut self) -> mpsc::Receiver<Lossy> {
            self.shared.stream_stopped.store(true, Ordering::Release);
            self.shared.stop.store(true, Ordering::Release);
            self.distributor.take().unwrap().join().unwrap();
            self.previews
        }
    }
    fn wait(done: &mpsc::Receiver<Result<(), String>>) -> Result<(), String> {
        done.recv_timeout(Duration::from_secs(10)).unwrap()
    }
    fn sealed_frames(received: &mpsc::Receiver<Reliable>) -> Vec<u64> {
        received
            .try_iter()
            .filter_map(|item| match item {
                Reliable::Event(value) if value["phase"] == "seal" => value["frames"].as_u64(),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn preview_backlog_never_blocks_disk() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("预览堵塞.wav");
        let mut rig = Rig::new(1, QUEUE_TEST);
        // 推流通道只放得下一条且永远没人读：等同主进程卡住不读管道。
        let (preview, _stalled) = mpsc::sync_channel(1);
        rig.preview = preview;
        let (stats, done) = rig.file("file", &path, true);
        feed(&rig.shared, 600, 480, None);
        rig.run();
        rig.finish();
        wait(&done).unwrap();
        // 480 帧的回调两两合并成 960 帧一块。
        assert_eq!(stats.frames.load(Ordering::Acquire), 600 * 480);
        assert!(stats.dropped_preview.load(Ordering::Relaxed) >= 299);
        assert_eq!(Wav::recover(&path).unwrap(), 600 * 480 * 3);
    }
    const QUEUE_TEST: usize = 4096;

    #[test]
    fn input_overflow_is_counted_per_output_and_recording_continues() {
        let dir = tempfile::tempdir().unwrap();
        let mut rig = Rig::new(2, QUEUE_TEST);
        feed(&rig.shared, 10, 256, Some(3));
        rig.run();
        while !rig.shared.queue.is_empty() {
            thread::sleep(Duration::from_millis(2));
        }
        // 第一次溢出发生在这一路开始之前，不算它的。
        let (stats, done) = rig.file("file", &dir.path().join("溢出.wav"), true);
        let base = rig.shared.baseline();
        feed(&rig.shared, 100, 256, Some(40));
        let shared = rig.shared.clone();
        let previews = rig.finish();
        wait(&done).unwrap();
        assert_eq!(stats.frames.load(Ordering::Acquire), 100 * 256);
        assert_eq!(shared.input_overflows.load(Ordering::Relaxed), 2);
        assert_eq!(shared.input_overflows.load(Ordering::Relaxed) - base[0], 1);
        assert_eq!(stats.last_glitch_frame.load(Ordering::Relaxed), 40 * 256);
        assert!(previews.try_iter().count() > 0);
    }

    #[test]
    fn full_output_queue_drops_are_counted_and_filled_with_silence() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("写盘卡住.wav");
        let mut rig = Rig::new(1, QUEUE_TEST);
        let (stats, done) = rig.file("file", &path, false);
        stats.stall.store(true, Ordering::Release);
        rig.run();
        // 写盘卡住：这一路自己的队列满了以后丢的块记作丢帧，恢复后补等长静音，文件时长不变。
        feed(&rig.shared, OUTPUT_BLOCKS + 20, 1000, None);
        while !rig.shared.queue.is_empty() {
            thread::sleep(Duration::from_millis(2));
        }
        stats.stall.store(false, Ordering::Release);
        feed(&rig.shared, 1, 1000, None);
        let shared = rig.shared.clone();
        rig.finish();
        wait(&done).unwrap();
        let total = (OUTPUT_BLOCKS as u64 + 21) * 1000;
        assert!(
            stats.dropped_frames.load(Ordering::Relaxed)
                + shared.dropped_frames.load(Ordering::Relaxed)
                >= 19 * 1000
        );
        assert_eq!(stats.frames.load(Ordering::Acquire), total);
        assert_eq!(Wav::recover(&path).unwrap(), total * 3);
    }

    #[test]
    fn frames_lost_right_before_stop_are_still_filled_with_silence() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("结尾丢帧.wav");
        // 采集队列只放得下 4 块、分发还没开始：最后两块入队失败后流就停了，由收尾块带着丢帧数交下去。
        let mut rig = Rig::new(1, 4);
        let (stats, done) = rig.file("file", &path, true);
        feed(&rig.shared, 6, 1024, None);
        rig.run();
        unsafe { settle_lost(&rig.shared) };
        let previews = rig.finish();
        wait(&done).unwrap();
        assert_eq!(stats.frames.load(Ordering::Acquire), 6 * 1024);
        assert_eq!(Wav::recover(&path).unwrap(), 6 * 1024 * 3);
        // 收尾块只补静音，不推出 0 帧的采样（主进程会把它当成协议错误）。
        let frames: Vec<u64> = previews
            .try_iter()
            .filter(|(value, _)| value["event"] == "samples")
            .map(|(value, _)| value["frames"].as_u64().unwrap())
            .collect();
        assert_eq!(frames.len(), 4);
        assert!(frames.iter().all(|frames| *frames > 0));
    }

    #[test]
    fn one_capture_feeds_the_audio_edit_file_and_a_screen_track_without_interrupting_either() {
        // 音频编辑先录 10 块；录屏这时开了麦克风轨，之后音频编辑暂停 5 块再继续，最后录屏先停。
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("口播.wav");
        let mut rig = Rig::new(1, QUEUE_TEST);
        let (take, take_done) = rig.file("take", &path, false);
        feed(&rig.shared, 10, 1000, None);
        let (events, received) = mpsc::channel();
        let (screen, screen_done) = rig.track("screen", dir.path(), events);
        feed(&rig.shared, 5, 1000, None);
        let at = rig.captured();
        rig.gate("take", |r| r.gate.pause(at));
        feed(&rig.shared, 5, 1000, None);
        let at = rig.captured();
        rig.gate("take", |r| r.gate.resume(at));
        feed(&rig.shared, 5, 1000, None);
        let at = rig.captured();
        rig.gate("screen", |r| {
            r.gate.pause(at);
            r.gate.closing = true;
        });
        feed(&rig.shared, 5, 1000, None);
        // 分发在全部区间登记好之后才开始：排着队的块按边界归属。
        rig.run();
        wait(&screen_done).unwrap();
        rig.finish();
        wait(&take_done).unwrap();
        assert_eq!(sealed_frames(&received), vec![15_000]);
        assert_eq!(screen.frames.load(Ordering::Acquire), 15_000);
        assert_eq!(take.frames.load(Ordering::Acquire), 25_000);
        assert_eq!(Wav::recover(&path).unwrap(), 25_000 * 3);
    }

    #[test]
    fn a_stalled_output_never_holds_up_control_changes_or_the_other_output() {
        // 音频编辑那一路写盘卡住：暂停、继续、新开一路都立刻完成，录屏轨照常落盘。
        let dir = tempfile::tempdir().unwrap();
        let mut rig = Rig::new(1, QUEUE_TEST);
        let (take, take_done) = rig.file("take", &dir.path().join("口播.wav"), false);
        let (events, received) = mpsc::channel();
        let (screen, screen_done) = rig.track("screen", dir.path(), events.clone());
        take.stall.store(true, Ordering::Release);
        rig.run();
        feed(&rig.shared, 50, 1000, None);
        thread::sleep(Duration::from_millis(100));
        let started = Instant::now();
        let at = rig.captured();
        rig.gate("take", |r| r.gate.pause(at));
        rig.gate("take", |r| r.gate.resume(at));
        let (extra, extra_done) = rig.track("extra", dir.path(), events);
        assert!(
            started.elapsed() < Duration::from_millis(500),
            "控制命令被写盘拖住了"
        );
        feed(&rig.shared, 50, 1000, None);
        let deadline = Instant::now() + Duration::from_secs(5);
        while (screen.frames.load(Ordering::Acquire) < 100_000
            || extra.frames.load(Ordering::Acquire) < 50_000)
            && Instant::now() < deadline
        {
            thread::sleep(Duration::from_millis(5));
        }
        assert_eq!(screen.frames.load(Ordering::Acquire), 100_000);
        assert_eq!(extra.frames.load(Ordering::Acquire), 50_000);
        assert_eq!(take.frames.load(Ordering::Acquire), 0);
        take.stall.store(false, Ordering::Release);
        rig.finish();
        for done in [&take_done, &screen_done, &extra_done] {
            wait(done).unwrap();
        }
        assert_eq!(take.frames.load(Ordering::Acquire), 100_000);
        assert_eq!(sealed_frames(&received).iter().sum::<u64>(), 150_000);
    }

    #[test]
    fn a_stopping_output_finishes_even_when_the_device_stops_delivering() {
        // 停止前最后几块因采集队列满丢了、设备随后不再出数据而流没停：按丢帧补齐尾巴后收尾，不干等。
        let dir = tempfile::tempdir().unwrap();
        let mut rig = Rig::new(1, 4);
        let (events, received) = mpsc::channel();
        let (_, done) = rig.track("screen", dir.path(), events);
        rig.shared.stream_stopped.store(false, Ordering::Release);
        feed(&rig.shared, 6, 1000, None);
        let at = rig.captured();
        rig.gate("screen", |r| {
            r.gate.pause(at);
            r.gate.closing = true;
            r.closing_since = Some(Instant::now());
        });
        rig.run();
        let started = Instant::now();
        wait(&done).unwrap();
        assert!(started.elapsed() < Duration::from_secs(2));
        assert_eq!(sealed_frames(&received), vec![6_000]);
        rig.finish();
    }

    #[test]
    fn a_file_counts_as_being_written_until_its_writer_has_sealed_it() {
        // 停止已应答而磁盘还在写：写盘线程结束之前这个文件都不能拿去恢复。
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("还在写.wav");
        let mut rig = Rig::new(1, QUEUE_TEST);
        let (stats, done) = rig.file("take", &path, false);
        stats.stall.store(true, Ordering::Release);
        rig.run();
        feed(&rig.shared, 5, 1000, None);
        let at = rig.captured();
        rig.gate("take", |r| {
            r.gate.pause(at);
            r.gate.closing = true;
        });
        thread::sleep(Duration::from_millis(50));
        assert!(writing(path.to_str().unwrap()));
        stats.stall.store(false, Ordering::Release);
        wait(&done).unwrap();
        assert!(!writing(path.to_str().unwrap()));
        rig.finish();
    }

    #[test]
    fn an_abandoned_file_creation_removes_the_file_it_made() {
        // 建文件等太久、开始命令已放弃：写盘线程醒来后删掉自己建出的空文件，不留在作品目录里。
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("放弃.wav");
        let (ready_tx, ready) = mpsc::channel();
        let (done_tx, _done) = mpsc::channel();
        drop(ready);
        let (preview, _previews) = mpsc::sync_channel(16);
        let file = path.to_str().unwrap().to_string();
        write_output(
            "late".into(),
            Box::new(move || Ok(Sink::File(FileSink::create(&file, 48000, 1, 24, false)?))),
            Arc::new(ArrayQueue::new(4)),
            Arc::new(Stats::default()),
            1,
            48000.0,
            preview,
            ready_tx,
            done_tx,
        );
        assert!(!path.exists());
        assert!(!writing(path.to_str().unwrap()));
    }

    #[test]
    fn frames_lost_across_a_pause_are_split_by_the_recording_spans() {
        // 采集队列满丢了 4 块（4000 帧），其中 2000 帧落在暂停之后：只补暂停之前的那一半。
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("暂停边界.wav");
        let mut rig = Rig::new(1, 2);
        let (stats, done) = rig.file("take", &path, false);
        feed(&rig.shared, 6, 1000, None);
        rig.gate("take", |r| r.gate.pause(4000));
        rig.run();
        while !rig.shared.queue.is_empty() {
            thread::sleep(Duration::from_millis(2));
        }
        rig.gate("take", |r| r.gate.resume(6000));
        feed(&rig.shared, 1, 1000, None);
        rig.finish();
        wait(&done).unwrap();
        // 前 2 块写进去，丢的 4000 帧里 [2000, 4000) 补静音，暂停中的 [4000, 6000) 不写，继续后再 1 块。
        assert_eq!(stats.frames.load(Ordering::Acquire), 5_000);
        assert_eq!(Wav::recover(&path).unwrap(), 5_000 * 3);
    }

    fn segment_events(received: &mpsc::Receiver<Reliable>, phase: &str) -> Vec<Value> {
        received
            .try_iter()
            .filter_map(|item| match item {
                Reliable::Event(value) if value["phase"] == phase => Some(value),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn a_paused_track_seals_at_once_and_resumes_into_a_new_segment_from_the_next_block() {
        // 录屏暂停时流不停：暂停前的段在暂停期间就封口，继续后第一块另起一段，时刻是它自己的。
        let dir = tempfile::tempdir().unwrap();
        let mut rig = Rig::new(1, QUEUE_TEST);
        let (events, received) = mpsc::channel();
        let (stats, done) = rig.track("screen", dir.path(), events);
        rig.run();
        feed(&rig.shared, 3, 1000, None);
        let at = rig.captured();
        rig.gate("screen", |r| {
            r.gate.pause(at);
            r.seal_at = Some(at);
        });
        feed(&rig.shared, 5, 1000, None);
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut sealed = Vec::new();
        while sealed.is_empty() && Instant::now() < deadline {
            sealed = segment_events(&received, "seal");
            thread::sleep(Duration::from_millis(2));
        }
        assert_eq!(sealed.len(), 1);
        assert_eq!(sealed[0]["frames"], 3_000);
        let at = rig.captured();
        rig.gate("screen", |r| r.gate.resume(at));
        let resumed = [0.5f32; 1000];
        unsafe {
            accept(&rig.shared, &resumed, 1000, 9_000_000.0, 1.0, 0);
            accept(&rig.shared, &resumed, 1000, 9_020_833.0, 1.0, 0);
            flush(&rig.shared);
        }
        let at = rig.captured();
        rig.gate("screen", |r| {
            r.gate.pause(at);
            r.gate.closing = true;
        });
        wait(&done).unwrap();
        rig.finish();
        assert_eq!(stats.frames.load(Ordering::Acquire), 5_000);
        let rest: Vec<Value> = received
            .try_iter()
            .filter_map(|item| match item {
                Reliable::Event(value) => Some(value),
                Reliable::Barrier(_) => None,
            })
            .collect();
        let opened: Vec<&Value> = rest.iter().filter(|v| v["phase"] == "open").collect();
        assert_eq!(opened.len(), 1);
        assert_eq!(opened[0]["firstFrame"], 3_000);
        assert_eq!(opened[0]["nativeMonoUs"], 9_000_000.0);
        let sealed: Vec<&Value> = rest.iter().filter(|v| v["phase"] == "seal").collect();
        assert_eq!(sealed.len(), 1);
        assert_eq!(sealed[0]["frames"], 2_000);
    }

    #[test]
    fn frames_lost_right_before_a_track_pause_are_filled_into_the_paused_segment() {
        // 采集队列满丢了 4 块（[2000, 6000)），暂停边界在 4000：[2000, 4000) 补进暂停前那段再封口，继续后的采样另起一段。
        let dir = tempfile::tempdir().unwrap();
        let mut rig = Rig::new(1, 2);
        let (events, received) = mpsc::channel();
        let (_, done) = rig.track("screen", dir.path(), events);
        feed(&rig.shared, 6, 1000, None);
        rig.gate("screen", |r| {
            r.gate.pause(4000);
            r.seal_at = Some(4000);
        });
        rig.run();
        while !rig.shared.queue.is_empty() {
            thread::sleep(Duration::from_millis(2));
        }
        rig.gate("screen", |r| r.gate.resume(6000));
        feed(&rig.shared, 1, 1000, None);
        let at = rig.captured();
        rig.gate("screen", |r| {
            r.gate.pause(at);
            r.gate.closing = true;
        });
        wait(&done).unwrap();
        rig.finish();
        let all: Vec<Value> = received
            .try_iter()
            .filter_map(|item| match item {
                Reliable::Event(value) => Some(value),
                Reliable::Barrier(_) => None,
            })
            .collect();
        let frames = |phase: &str, key: &str| -> Vec<u64> {
            all.iter()
                .filter(|v| v["phase"] == phase)
                .map(|v| v[key].as_u64().unwrap())
                .collect()
        };
        assert_eq!(frames("seal", "frames"), vec![4000, 1000]);
        assert_eq!(frames("open", "firstFrame"), vec![0, 4000]);
    }

    /// 可重复的伪随机抖动，范围 [-1, 1)。
    fn jitter(seed: &mut u64) -> f64 {
        *seed = seed
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        (*seed >> 11) as f64 / (1u64 << 53) as f64 * 2.0 - 1.0
    }

    #[test]
    fn placement_follows_sample_count_through_jitter_and_drift_without_jumping() {
        // 一小时、每回调 10 ms、测得时刻带 ±10 ms 抖动，设备比系统时钟慢 50 ppm：
        // 不触发重新对齐，每 5 秒的偏差不超过 0.5 ms（拼接时集中吸收也只有约 0.25% 变速），且一直跟住真实时刻。
        let frame_us = 1_000_000.0 / 48_000.0;
        let mut placement = Placement::default();
        let mut seed = 7;
        let (mut segment_start, mut worst_slip, mut worst_error) = (None::<f64>, 0f64, 0f64);
        for k in 0..360_000u64 {
            let truth = k as f64 * 480.0 * frame_us * (1.0 + 50e-6);
            let placed =
                placement.place(truth + 10_000.0 * jitter(&mut seed), 480, frame_us, false);
            worst_error = worst_error.max((placed - truth).abs());
            if k % 500 == 0 {
                if let Some(start) = segment_start {
                    worst_slip = worst_slip.max((placed - start - 5_000_000.0).abs());
                }
                segment_start = Some(placed);
            }
        }
        assert!(worst_slip <= 500.0 + 1e-6, "单段偏差 {worst_slip} µs");
        assert!(worst_error < 12_000.0, "偏离真实时刻 {worst_error} µs");
    }

    #[test]
    fn placement_reanchors_only_on_a_real_forward_jump_and_never_goes_back() {
        let frame_us = 1_000_000.0 / 48_000.0;
        let duration = 480.0 * frame_us;
        let mut p = Placement::default();
        assert_eq!(p.place(1_000_000.0, 480, frame_us, false), 1_000_000.0);
        // 小于 70 ms 的偏晚当抖动：按采样数推进，只缓慢修正。
        let next = 1_000_000.0 + duration;
        let placed = p.place(next + 30_000.0, 480, frame_us, false);
        assert!((placed - next - duration * SLEW).abs() < 1e-6);
        // 超过 70 ms 的偏晚是真的断了：重新对齐。
        assert_eq!(p.place(5_000_000.0, 480, frame_us, false), 5_000_000.0);
        // 带溢出标记（确实丢了采样）时偏晚多少就对齐多少。
        assert_eq!(p.place(5_020_000.0, 480, frame_us, true), 5_020_000.0);
        // 偏早（MME 批量回调给出重复时刻）再多也不往回跳。
        let next = 5_020_000.0 + duration;
        let placed = p.place(4_000_000.0, 480, frame_us, false);
        assert!((placed - (next - duration * SLEW)).abs() < 1e-6);
        let placed_again = p.place(4_000_000.0, 480, frame_us, true);
        assert!(placed_again > placed);
    }
}
