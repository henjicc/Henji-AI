//! 系统声（回环）采集：与麦克风同一套落盘做法，独立于界面与主进程。
//!
//! 采集线程只把数据包按设备给出的时间戳放上时间轴、交给队列；写盘线程按 5 秒一段写成独立 WAV（每秒更新文件头），
//! 每开一段、封一段都发一条不丢的事件，主进程据此登记轨道。没有声音播放时回环端点不出数据，按时间补静音，
//! 时间轴始终连续；输出设备切换、暂时没有设备的那段同样是静音。
use crate::wav::Wav;
use crossbeam_queue::ArrayQueue;
use serde_json::{json, Value};
use std::{
    collections::hash_map::RandomState,
    hash::{BuildHasher, Hasher},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc, Arc,
    },
    thread,
    time::{Duration, Instant},
};

/// 每段时长：设备时钟与系统时钟的漂移在每个拼接处吸收（主进程拼接时轻微拉伸），段不能太长。
pub const SEGMENT_SECONDS: u64 = 5;
pub const CHANNELS: usize = 2;
/// 与原来界面写出的系统声一致：16 位双声道。
pub const BITS: u16 = 16;
const CHUNK_FRAMES: usize = 1024;
/// 采集到写盘之间的缓冲：WASAPI 每 10 ms 一包，4096 块在 48 kHz 约 40 秒，磁盘卡几十秒也不丢；整队约 32 MB。
const QUEUE_CHUNKS: usize = 4096;
/// 数据包时间戳与时间轴的出入超过这个才按时间戳重新对齐（补静音或去掉重叠）；以内当作连续，时间戳的小抖动不造成断续。
const ALIGN_TOLERANCE_US: f64 = 3_000.0;
/// 超过这么久没有数据包才补静音；补到离现在这么远为止，给还在路上的包留位置。停止时补到现在。
pub const IDLE_AFTER_US: f64 = 100_000.0;
pub const IDLE_LAG_US: f64 = 50_000.0;

#[derive(Clone, Copy)]
pub struct Chunk {
    pub frames: u64,
    /// 第一帧的单调时钟（与 hc_clock 同源的 QPC 微秒）。
    pub mono_us: f64,
    /// 静音块不带采样，写盘时写零。
    pub silent: bool,
    /// 本块之前因队列满没能入队的帧数，写盘时先补成等长静音。
    pub lost_before: u64,
    pub samples: [f32; CHUNK_FRAMES * CHANNELS],
}
const EMPTY: Chunk = Chunk {
    frames: 0,
    mono_us: 0.0,
    silent: true,
    lost_before: 0,
    samples: [0.0; CHUNK_FRAMES * CHANNELS],
};

pub struct Shared {
    queue: ArrayQueue<Chunk>,
    pub rate: u32,
    pub stop_capture: AtomicBool,
    pub stop_writer: AtomicBool,
    pub failed: AtomicBool,
    /// 只由采集线程读写：入队失败累计的帧数。
    lost: AtomicU64,
    pub frames: AtomicU64,
    pub bytes: AtomicU64,
    pub segments: AtomicU64,
    pub silence_frames: AtomicU64,
    pub unavailable_frames: AtomicU64,
    pub trimmed_frames: AtomicU64,
    pub discontinuities: AtomicU64,
    pub dropped_frames: AtomicU64,
    pub device_switches: AtomicU64,
    pub max_write_us: AtomicU64,
}
impl Shared {
    pub fn new(rate: u32, capacity: usize) -> Self {
        Self {
            queue: ArrayQueue::new(capacity),
            rate,
            stop_capture: AtomicBool::new(false),
            stop_writer: AtomicBool::new(false),
            failed: AtomicBool::new(false),
            lost: AtomicU64::new(0),
            frames: AtomicU64::new(0),
            bytes: AtomicU64::new(0),
            segments: AtomicU64::new(0),
            silence_frames: AtomicU64::new(0),
            unavailable_frames: AtomicU64::new(0),
            trimmed_frames: AtomicU64::new(0),
            discontinuities: AtomicU64::new(0),
            dropped_frames: AtomicU64::new(0),
            device_switches: AtomicU64::new(0),
            max_write_us: AtomicU64::new(0),
        }
    }
    fn push(&self, mut chunk: Chunk) {
        chunk.lost_before = self.lost.load(Ordering::Relaxed);
        if self.queue.push(chunk).is_ok() {
            self.lost.store(0, Ordering::Relaxed);
        } else {
            self.lost.fetch_add(chunk.frames, Ordering::Relaxed);
            self.dropped_frames
                .fetch_add(chunk.frames, Ordering::Relaxed);
        }
    }
    pub fn push_silence(&self, frames: u64, mono_us: f64) {
        if frames > 0 {
            self.push(Chunk {
                frames,
                mono_us,
                ..EMPTY
            });
        }
    }
    /// 交错双声道采样，按块切开入队。
    pub fn push_samples(&self, samples: &[f32], mono_us: f64) {
        let rate = self.rate as f64;
        for (index, part) in samples.chunks(CHUNK_FRAMES * CHANNELS).enumerate() {
            let mut chunk = Chunk {
                frames: (part.len() / CHANNELS) as u64,
                mono_us: mono_us + (index * CHUNK_FRAMES) as f64 * 1_000_000.0 / rate,
                silent: false,
                ..EMPTY
            };
            chunk.samples[..part.len()].copy_from_slice(part);
            self.push(chunk);
        }
    }
    /// 停止前最后几块没能入队的帧也要补成静音：等写盘腾出位置，交一个只带丢帧数的空块。
    /// `end_us` 是时间轴的终点，丢的帧紧挨在它前面。
    pub fn settle_lost(&self, end_us: f64) {
        let lost = self.lost.swap(0, Ordering::Relaxed);
        if lost == 0 {
            return;
        }
        let marker = Chunk {
            lost_before: lost,
            mono_us: end_us,
            ..EMPTY
        };
        while self.queue.push(marker).is_err() {
            if self.failed.load(Ordering::Acquire) {
                return;
            }
            thread::sleep(Duration::from_millis(1));
        }
    }
    pub fn health(&self) -> Value {
        let rate = self.rate as f64;
        json!({
            "segments": self.segments.load(Ordering::Relaxed),
            "silenceSeconds": self.silence_frames.load(Ordering::Relaxed) as f64 / rate,
            "unavailableSeconds": self.unavailable_frames.load(Ordering::Relaxed) as f64 / rate,
            "trimmedFrames": self.trimmed_frames.load(Ordering::Relaxed),
            "discontinuities": self.discontinuities.load(Ordering::Relaxed),
            "droppedFrames": self.dropped_frames.load(Ordering::Relaxed),
            "deviceSwitches": self.device_switches.load(Ordering::Relaxed),
            "maxWriteMs": self.max_write_us.load(Ordering::Relaxed) as f64 / 1000.0,
        })
    }
    fn health_signature(&self) -> [u64; 5] {
        [
            self.dropped_frames.load(Ordering::Relaxed),
            self.discontinuities.load(Ordering::Relaxed),
            self.device_switches.load(Ordering::Relaxed),
            // 静音与不可用按秒、写盘峰值按 100 ms 一档上报，不刷日志。
            (self.unavailable_frames.load(Ordering::Relaxed) / self.rate as u64),
            self.max_write_us.load(Ordering::Relaxed) / 100_000,
        ]
    }
}

/// 数据包放上时间轴的结果：先补 `fill` 帧静音（从 `fill_mono_us` 开始），再丢掉包首 `skip` 帧，余下从 `mono_us` 开始。
#[derive(Debug, PartialEq)]
pub struct Placement {
    pub fill: u64,
    pub fill_mono_us: f64,
    pub skip: usize,
    pub mono_us: f64,
}
/// 系统声时间轴：文件里的每一帧都对应一个真实时刻。连续的数据包照设备时钟写（漂移留给拼接处吸收），
/// 只有出现空白（没声音、换设备）或重叠时才按数据包的时间戳补静音或去掉重叠。
pub struct Timeline {
    rate: f64,
    next_us: f64,
}
impl Timeline {
    pub fn new(rate: u32, start_us: f64) -> Self {
        Self {
            rate: rate as f64,
            next_us: start_us,
        }
    }
    pub fn place(&mut self, timestamp_us: Option<f64>, frames: usize) -> Placement {
        let at = timestamp_us.unwrap_or(self.next_us);
        let drift = at - self.next_us;
        let fill_mono_us = self.next_us;
        let (fill, skip) = if drift > ALIGN_TOLERANCE_US {
            ((drift * self.rate / 1_000_000.0).round() as u64, 0)
        } else if drift < -ALIGN_TOLERANCE_US {
            (
                0,
                ((-drift * self.rate / 1_000_000.0).round() as usize).min(frames),
            )
        } else {
            (0, 0)
        };
        let mono_us = at + skip as f64 * 1_000_000.0 / self.rate;
        // 以数据包自己的时间戳续接：连续时不累计误差。
        self.next_us = self
            .next_us
            .max(at + frames as f64 * 1_000_000.0 / self.rate);
        Placement {
            fill,
            fill_mono_us,
            skip,
            mono_us,
        }
    }
    /// 一段时间没有数据包：补静音到 `now - lag`。返回补的帧数与起点。
    pub fn idle(&mut self, now_us: f64, lag_us: f64, after_us: f64) -> Option<(u64, f64)> {
        if now_us - self.next_us <= after_us {
            return None;
        }
        let frames = ((now_us - lag_us - self.next_us) * self.rate / 1_000_000.0).floor();
        if frames < 1.0 {
            return None;
        }
        let mono = self.next_us;
        self.next_us += frames * 1_000_000.0 / self.rate;
        Some((frames as u64, mono))
    }
    pub fn end_us(&self) -> f64 {
        self.next_us
    }
}

/// 段文件名用随机 UUID：与原来界面写的分段同一命名规则，轨道记录与恢复都认它。
fn segment_id() -> String {
    // 标准库的 RandomState 每次都取进程随机种子的新键，两次哈希凑出 128 位，不必为此引入随机数依赖。
    let random = || {
        let mut hasher = RandomState::new().build_hasher();
        hasher.write_u64(crate::ffi::clock().to_bits());
        hasher.finish()
    };
    let (a, b) = (random(), random());
    format!(
        "{:08x}-{:04x}-4{:03x}-{:x}{:03x}-{:012x}",
        a >> 32,
        (a >> 16) & 0xffff,
        a & 0xfff,
        8 | (b >> 62),
        (b >> 48) & 0xfff,
        b & 0xffff_ffff_ffff
    )
}

struct Segment {
    id: String,
    file: String,
    wav: Wav,
    frames: u64,
    start_us: f64,
}
struct Meter {
    peak: [f32; CHANNELS],
    sum: [f64; CHANNELS],
    frames: u64,
}
/// 写盘：按帧数切段，段与段首尾相接。所有事件都带段在整次采集里的起始帧和单调时钟。
pub struct Writer {
    session: String,
    directory: PathBuf,
    rate: f64,
    segment_frames: u64,
    current: Option<Segment>,
    total: u64,
    bytes_before: u64,
    sealed: u64,
    checkpoint: Instant,
    meter: Meter,
    events: mpsc::Sender<Value>,
    levels: Option<mpsc::SyncSender<Value>>,
}
impl Writer {
    pub fn new(
        session: String,
        directory: &Path,
        rate: u32,
        events: mpsc::Sender<Value>,
        levels: Option<mpsc::SyncSender<Value>>,
    ) -> Self {
        Self {
            session,
            directory: directory.to_path_buf(),
            rate: rate as f64,
            segment_frames: rate as u64 * SEGMENT_SECONDS,
            current: None,
            total: 0,
            bytes_before: 0,
            sealed: 0,
            checkpoint: Instant::now(),
            meter: Meter {
                peak: [0.0; CHANNELS],
                sum: [0.0; CHANNELS],
                frames: 0,
            },
            events,
            levels,
        }
    }
    pub fn frames(&self) -> u64 {
        self.total
    }
    pub fn bytes(&self) -> u64 {
        self.bytes_before + self.current.as_ref().map_or(0, |s| s.wav.bytes)
    }
    fn open(&mut self, start_us: f64) -> Result<(), String> {
        let id = segment_id();
        let file = format!("{id}.wav");
        let wav = Wav::create(
            &self.directory.join(&file),
            self.rate as u32,
            CHANNELS as u16,
            BITS,
        )
        .map_err(crate::io_error)?;
        // 段一开就登记：进程中途被杀，主进程凭这条记录和文件里已写的采样补出这一段。
        let _ = self.events.send(json!({"event":"segment","phase":"open","sessionId":self.session,"segmentId":id,"file":file,"firstFrame":self.total,"sampleRate":self.rate,"channels":CHANNELS,"nativeMonoUs":start_us}));
        self.current = Some(Segment {
            id,
            file,
            wav,
            frames: 0,
            start_us,
        });
        Ok(())
    }
    pub fn seal(&mut self) -> Result<(), String> {
        let Some(mut segment) = self.current.take() else {
            return Ok(());
        };
        segment.wav.checkpoint().map_err(crate::io_error)?;
        self.bytes_before += segment.wav.bytes;
        // 一帧都没写进去的段（刚开段就写盘失败）不封口：主进程按文件补齐时会放弃它。
        if segment.frames == 0 {
            return Ok(());
        }
        self.sealed += 1;
        let _ = self.events.send(json!({"event":"segment","phase":"seal","sessionId":self.session,"segmentId":segment.id,"file":segment.file,"firstFrame":self.total - segment.frames,"frames":segment.frames,"sampleRate":self.rate,"channels":CHANNELS,"nativeMonoUs":segment.start_us}));
        Ok(())
    }
    /// 写 `frames` 帧，`samples` 为空时写静音；跨段时在段界切开，后一段的起点按帧数推算。
    pub fn write(
        &mut self,
        frames: u64,
        mono_us: f64,
        samples: Option<&[f32]>,
    ) -> Result<(), String> {
        const ZERO: [f32; CHUNK_FRAMES * CHANNELS] = [0.0; CHUNK_FRAMES * CHANNELS];
        let mut offset = 0u64;
        while offset < frames {
            if self.current.is_none() {
                self.open(mono_us + offset as f64 * 1_000_000.0 / self.rate)?;
            }
            let segment = self.current.as_mut().unwrap();
            let n = (self.segment_frames - segment.frames).min(frames - offset);
            match samples {
                Some(data) => segment
                    .wav
                    .write(&data[offset as usize * CHANNELS..(offset + n) as usize * CHANNELS])
                    .map_err(crate::io_error)?,
                None => {
                    let mut left = n as usize;
                    while left > 0 {
                        let step = left.min(CHUNK_FRAMES);
                        segment
                            .wav
                            .write(&ZERO[..step * CHANNELS])
                            .map_err(crate::io_error)?;
                        left -= step;
                    }
                }
            }
            if let Some(data) = samples {
                for (i, &sample) in data
                    [offset as usize * CHANNELS..(offset + n) as usize * CHANNELS]
                    .iter()
                    .enumerate()
                {
                    let c = i % CHANNELS;
                    self.meter.peak[c] = self.meter.peak[c].max(sample.abs());
                    self.meter.sum[c] += (sample as f64).powi(2);
                }
            }
            segment.frames += n;
            self.total += n;
            self.meter.frames += n;
            offset += n;
            if segment.frames == self.segment_frames {
                self.seal()?;
            }
        }
        if self.checkpoint.elapsed() >= Duration::from_secs(1) {
            if let Some(segment) = self.current.as_mut() {
                segment.wav.checkpoint().map_err(crate::io_error)?;
            }
            self.checkpoint = Instant::now();
        }
        self.level();
        Ok(())
    }
    fn level(&mut self) {
        if (self.meter.frames as f64) < self.rate * 0.033 {
            return;
        }
        let frames = self.meter.frames as f64;
        let rms: Vec<f64> = self.meter.sum.iter().map(|s| (s / frames).sqrt()).collect();
        let clipped: Vec<bool> = self.meter.peak.iter().map(|p| *p >= 0.999969).collect();
        if let Some(levels) = &self.levels {
            // 电平丢一条不要紧，下一条 33 ms 后就到。
            let _ = levels.try_send(json!({"event":"level","sessionId":self.session,"peak":self.meter.peak,"rms":rms,"clipped":clipped,"durationSeconds":self.total as f64 / self.rate,"writtenBytes":self.bytes()}));
        }
        self.meter = Meter {
            peak: [0.0; CHANNELS],
            sum: [0.0; CHANNELS],
            frames: 0,
        };
    }
}

pub fn write_loop(shared: Arc<Shared>, mut writer: Writer) -> Result<(), String> {
    let result = (|| {
        loop {
            let Some(chunk) = shared.queue.pop() else {
                if shared.stop_writer.load(Ordering::Acquire) {
                    break;
                }
                thread::sleep(Duration::from_millis(2));
                continue;
            };
            let started = Instant::now();
            if chunk.lost_before > 0 {
                // 写盘跟不上时丢掉的帧补成等长静音：后面的声音不会整体提前。
                let rate = shared.rate as f64;
                writer.write(
                    chunk.lost_before,
                    chunk.mono_us - chunk.lost_before as f64 * 1_000_000.0 / rate,
                    None,
                )?;
            }
            if chunk.frames > 0 {
                let samples =
                    (!chunk.silent).then(|| &chunk.samples[..chunk.frames as usize * CHANNELS]);
                writer.write(chunk.frames, chunk.mono_us, samples)?;
            }
            shared.frames.store(writer.frames(), Ordering::Release);
            shared.bytes.store(writer.bytes(), Ordering::Release);
            shared.segments.store(writer.sealed, Ordering::Relaxed);
            shared
                .max_write_us
                .fetch_max(started.elapsed().as_micros() as u64, Ordering::Relaxed);
        }
        Ok(())
    })();
    let sealed = writer.seal();
    shared.bytes.store(writer.bytes(), Ordering::Release);
    shared.segments.store(writer.sealed, Ordering::Relaxed);
    if result.is_err() || sealed.is_err() {
        shared.failed.store(true, Ordering::Release);
    }
    result.and(sealed)
}

/// 一次系统声采集：采集线程、写盘线程与推流线程。推流先发不丢的段事件，再发可丢的电平与健康计数。
pub struct SystemSession {
    pub id: String,
    directory: String,
    pub shared: Arc<Shared>,
    device: String,
    capture: Option<thread::JoinHandle<()>>,
    writer: Option<thread::JoinHandle<Result<(), String>>>,
    streamer: Option<thread::JoinHandle<()>>,
    events: Option<mpsc::Sender<Value>>,
    reports: Option<mpsc::SyncSender<Value>>,
    health_sent: [u64; 5],
    health_at: Instant,
}
impl SystemSession {
    pub fn start(id: String, directory: String) -> Result<Self, String> {
        let path = Path::new(&directory);
        if !path.is_absolute() || !path.is_dir() {
            return Err("FILE_ERROR|系统声音的录制目录不存在".into());
        }
        let (events, reliable) = mpsc::channel::<Value>();
        let (reports, lossy) = mpsc::sync_channel::<Value>(256);
        let streamer = thread::spawn(move || loop {
            while let Ok(value) = reliable.try_recv() {
                crate::emit(value, &[]);
            }
            match lossy.recv_timeout(Duration::from_millis(20)) {
                Ok(value) => crate::emit(value, &[]),
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    for value in reliable.iter() {
                        crate::emit(value, &[]);
                    }
                    break;
                }
            }
        });
        let started = capture::spawn(id.clone(), events.clone());
        let (capture, rate, device) = match started {
            Ok(value) => value,
            // 打开设备超时的话采集线程还卡在驱动里、拿着事件发送端：不等它，推流线程随它结束自行退出，命令循环不被堵住。
            Err(error) => return Err(error),
        };
        let shared = Arc::new(Shared::new(rate, QUEUE_CHUNKS));
        // 界面没有显示系统声电平的位置，不往管道里推；以后要显示时把发送端传进来即可。
        let writer = Writer::new(id.clone(), path, rate, events.clone(), None);
        let s = shared.clone();
        let writer = thread::spawn(move || write_loop(s, writer));
        capture.begin(shared.clone());
        Ok(Self {
            id,
            directory,
            shared,
            device,
            capture: Some(capture.handle),
            writer: Some(writer),
            streamer: Some(streamer),
            events: Some(events),
            reports: Some(reports),
            health_sent: [0; 5],
            health_at: Instant::now(),
        })
    }
    pub fn directory(&self) -> &str {
        &self.directory
    }
    pub fn status(&self) -> Value {
        let rate = self.shared.rate as f64;
        let frames = self.shared.frames.load(Ordering::Acquire);
        json!({"sessionId":self.id,"outputPath":self.directory,"state":"recording","sampleRate":rate,"channels":CHANNELS,"bitDepth":BITS,"device":self.device,"inputLatency":0,"callbackFrames":0,
            "frames":frames,"writtenBytes":self.shared.bytes.load(Ordering::Acquire),"durationSeconds":frames as f64 / rate,"systemHealth":self.shared.health()})
    }
    pub fn report_health(&mut self) {
        let signature = self.shared.health_signature();
        if signature == self.health_sent || self.health_at.elapsed() < Duration::from_secs(1) {
            return;
        }
        self.health_at = Instant::now();
        let Some(reports) = &self.reports else {
            return;
        };
        let frames = self.shared.frames.load(Ordering::Acquire);
        let report = json!({"event":"systemHealth","sessionId":self.id,"durationSeconds":frames as f64 / self.shared.rate as f64,"health":self.shared.health()});
        if reports.try_send(report).is_ok() {
            self.health_sent = signature;
        }
    }
    pub fn close(&mut self) -> Result<Value, String> {
        let Some(capture) = self.capture.take() else {
            return Ok(self.status());
        };
        // 先停采集（补静音到此刻、交出最后的丢帧），再让写盘排空队列、封口最后一段。
        self.shared.stop_capture.store(true, Ordering::Release);
        let _ = capture.join();
        self.shared.stop_writer.store(true, Ordering::Release);
        let written = self.writer.take().map(|writer| writer.join());
        // 段事件排在结束回复之前：等推流线程把它们都发完。
        self.events = None;
        self.reports = None;
        if let Some(streamer) = self.streamer.take() {
            let _ = streamer.join();
        }
        if let Some(written) = written {
            written
                .map_err(|_| "CAPTURE_FAILED|系统声音写入线程异常，已录部分可恢复".to_string())??;
        }
        let mut result = self.status();
        result["state"] = json!("stopped");
        Ok(result)
    }
}
impl Drop for SystemSession {
    fn drop(&mut self) {
        let _ = self.close();
    }
}

#[cfg(windows)]
mod capture {
    pub use crate::wasapi::spawn;
}
#[cfg(not(windows))]
mod capture {
    use serde_json::Value;
    use std::sync::{mpsc, Arc};
    pub struct Started {
        pub handle: std::thread::JoinHandle<()>,
    }
    impl Started {
        pub fn begin(&self, _shared: Arc<super::Shared>) {}
    }
    pub fn spawn(
        _id: String,
        _events: mpsc::Sender<Value>,
    ) -> Result<(Started, u32, String), String> {
        Err("UNSUPPORTED|当前系统的系统声音由界面采集".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn writer(dir: &Path, rate: u32) -> (Writer, mpsc::Receiver<Value>) {
        let (events, received) = mpsc::channel();
        (Writer::new("s".into(), dir, rate, events, None), received)
    }

    #[test]
    fn idle_endpoint_is_filled_with_silence_and_timeline_stays_continuous() {
        // 2 秒内一个数据包都没有（没声音播放）：每 10 ms 看一次，补出的静音首尾相接，停止时补到此刻。
        let mut timeline = Timeline::new(48000, 1_000_000.0);
        let mut filled = Vec::new();
        for step in 1..=200 {
            if let Some(fill) = timeline.idle(
                1_000_000.0 + step as f64 * 10_000.0,
                IDLE_LAG_US,
                IDLE_AFTER_US,
            ) {
                filled.push(fill);
            }
        }
        if let Some(fill) = timeline.idle(3_000_000.0, 0.0, 0.0) {
            filled.push(fill);
        }
        let mut expected = 1_000_000.0;
        for (frames, mono) in &filled {
            assert!((mono - expected).abs() < 0.5, "静音段之间不能有缝");
            expected += *frames as f64 * 1_000_000.0 / 48000.0;
        }
        let total: u64 = filled.iter().map(|(frames, _)| frames).sum();
        assert!(
            (total as i64 - 96_000).abs() <= 1,
            "2 秒应补 96000 帧，实际 {total}"
        );
        // 声音恢复：数据包按自己的时间戳接上，中间不用再补。
        let placed = timeline.place(Some(3_000_000.0), 480);
        assert_eq!((placed.fill, placed.skip), (0, 0));
    }

    #[test]
    fn packets_after_a_pause_in_playback_are_placed_by_their_timestamps() {
        let mut timeline = Timeline::new(48000, 0.0);
        assert_eq!(timeline.place(Some(0.0), 480).fill, 0);
        // 连续的包有几微秒抖动，也当作连续。
        let continuous = timeline.place(Some(10_000.0 + 400.0), 480);
        assert_eq!((continuous.fill, continuous.skip), (0, 0));
        // 隔了 250 ms 才来下一个包：补 250 ms 静音再写。
        let gap = timeline.place(Some(270_400.0), 480);
        assert_eq!(gap.fill, 12_000);
        assert!((gap.mono_us - 270_400.0).abs() < 1e-6);
        // 补静音补多了（包在路上耽搁了），新包与已写的部分重叠：去掉重叠的帧。
        let mut ahead = Timeline::new(48000, 0.0);
        ahead.idle(500_000.0, 0.0, 0.0);
        let overlap = ahead.place(Some(480_000.0), 1920);
        assert_eq!((overlap.fill, overlap.skip), (0, 960));
        assert!((overlap.mono_us - 500_000.0).abs() < 1e-6);
    }

    #[test]
    fn segments_are_contiguous_and_split_at_exact_frame_counts() {
        let dir = tempfile::tempdir().unwrap();
        // 每秒 1000 帧、每段 5000 帧；写 3000 帧声音 + 4000 帧静音 + 4000 帧声音，应切成 5000 + 5000 + 1000。
        let (mut w, received) = writer(dir.path(), 1000);
        let tone: Vec<f32> = (0..2 * 1000 * 7).map(|i| (i % 7) as f32 / 10.0).collect();
        w.write(3000, 10_000.0, Some(&tone[..2 * 3000])).unwrap();
        w.write(4000, 3_010_000.0, None).unwrap();
        w.write(4000, 7_010_000.0, Some(&tone[..2 * 4000])).unwrap();
        w.seal().unwrap();
        let all: Vec<Value> = received.try_iter().collect();
        let sealed: Vec<&Value> = all.iter().filter(|v| v["phase"] == "seal").collect();
        assert_eq!(
            sealed
                .iter()
                .map(|v| v["frames"].as_u64().unwrap())
                .collect::<Vec<_>>(),
            vec![5000, 5000, 1000]
        );
        assert_eq!(
            sealed
                .iter()
                .map(|v| v["firstFrame"].as_u64().unwrap())
                .collect::<Vec<_>>(),
            vec![0, 5000, 10000]
        );
        // 第二段从第 5000 帧开始：落在第二次写入（3.01 秒起的静音）里 2000 帧处。
        assert!((sealed[1]["nativeMonoUs"].as_f64().unwrap() - 5_010_000.0).abs() < 1e-6);
        assert!((sealed[2]["nativeMonoUs"].as_f64().unwrap() - 10_010_000.0).abs() < 1e-6);
        for seal in &sealed {
            let path = dir.path().join(seal["file"].as_str().unwrap());
            assert_eq!(
                Wav::recover(&path).unwrap(),
                seal["frames"].as_u64().unwrap() * 4
            );
        }
        // 每一段先开后封，开的那条同样带首帧与时钟。
        let opened: Vec<&Value> = all.iter().filter(|v| v["phase"] == "open").collect();
        assert_eq!(opened.len(), 3);
        assert_eq!(opened[1]["firstFrame"], 5000);
    }

    #[test]
    fn full_queue_drops_are_counted_and_written_back_as_silence() {
        let dir = tempfile::tempdir().unwrap();
        // 写盘线程还没开始取：前 4 块入队，后面的入队失败，记作丢帧，下一块成功入队时带上，写盘补静音。
        let shared = Arc::new(Shared::new(48000, 4));
        let samples = vec![0.25f32; 2 * 480];
        for i in 0..10 {
            shared.push_samples(&samples, i as f64 * 10_000.0);
        }
        assert_eq!(shared.dropped_frames.load(Ordering::Relaxed), 6 * 480);
        let (events, received) = mpsc::channel();
        let writer = Writer::new("s".into(), dir.path(), 48000, events, None);
        let s = shared.clone();
        let worker = thread::spawn(move || write_loop(s, writer));
        while !shared.queue.is_empty() {
            thread::sleep(Duration::from_millis(2));
        }
        shared.push_samples(&samples, 100_000.0);
        shared.stop_writer.store(true, Ordering::Release);
        worker.join().unwrap().unwrap();
        assert_eq!(shared.frames.load(Ordering::Acquire), 11 * 480);
        let sealed: Vec<Value> = received
            .try_iter()
            .filter(|v| v["phase"] == "seal")
            .collect();
        let path = dir.path().join(sealed[0]["file"].as_str().unwrap());
        assert_eq!(Wav::recover(&path).unwrap(), 11 * 480 * 4);
    }

    #[test]
    fn segment_ids_are_version_4_uuids() {
        let id = segment_id();
        let parts: Vec<&str> = id.split('-').collect();
        assert_eq!(
            parts.iter().map(|p| p.len()).collect::<Vec<_>>(),
            vec![8, 4, 4, 4, 12]
        );
        assert!(parts[2].starts_with('4'));
        assert!("89ab".contains(&parts[3][..1]));
        assert_ne!(id, segment_id());
    }
}
