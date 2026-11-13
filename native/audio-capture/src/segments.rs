//! 按 5 秒一段写独立 WAV：系统声与录屏的麦克风轨共用。
//!
//! 每秒更新文件头，进程中途被杀时已写的采样都能读回；每开一段、封一段都发一条不丢的事件（带段在整次采集里的起始帧、
//! 第一帧的单调时钟与位深），主进程据此登记轨道。写盘线程从不等管道：事件交给推流线程，电平是可丢的。
use crate::wav::Wav;
use serde_json::{json, Value};
use std::{
    collections::hash_map::RandomState,
    hash::{BuildHasher, Hasher},
    path::{Path, PathBuf},
    sync::mpsc,
    thread,
    time::{Duration, Instant},
};

/// 每段时长：设备时钟与系统时钟的漂移在每个拼接处吸收（主进程拼接时轻微拉伸），段不能太长。
pub const SEGMENT_SECONDS: u64 = 5;
const ZERO_FRAMES: usize = 1024;

/// 推流线程按顺序发出的不丢消息。`Barrier` 在它之前的事件都发出后应答：停止的应答要排在最后一段的封口事件之后。
pub enum Reliable {
    Event(Value),
    Barrier(mpsc::Sender<()>),
}
/// 可丢的消息（电平、健康计数、预览采样）：JSON 与随后的二进制。
pub type Lossy = (Value, Vec<u8>);

/// 推流线程：先发完不丢的事件，再发可丢的；所有发送端都放下后把剩下的不丢事件发完再退出。
pub fn spawn_streamer(
    reliable: mpsc::Receiver<Reliable>,
    lossy: mpsc::Receiver<Lossy>,
) -> thread::JoinHandle<()> {
    let send = |item: Reliable| match item {
        Reliable::Event(value) => crate::emit(value, &[]),
        Reliable::Barrier(done) => {
            let _ = done.send(());
        }
    };
    thread::spawn(move || loop {
        while let Ok(item) = reliable.try_recv() {
            send(item);
        }
        match lossy.recv_timeout(Duration::from_millis(20)) {
            Ok((value, binary)) => crate::emit(value, &binary),
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                for item in reliable.iter() {
                    send(item);
                }
                break;
            }
        }
    })
}

/// 段文件名用随机 UUID：与原来界面写的分段同一命名规则，轨道记录与恢复都认它。
pub fn segment_id() -> String {
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
    uncertainty_us: f64,
}
/// 写盘：按帧数切段，段与段首尾相接。所有事件都带段在整次采集里的起始帧和单调时钟。
pub struct Writer {
    session: String,
    directory: PathBuf,
    rate: f64,
    channels: usize,
    bits: u16,
    segment_frames: u64,
    current: Option<Segment>,
    total: u64,
    bytes_before: u64,
    pub sealed: u64,
    checkpoint: Instant,
    peak: Vec<f32>,
    sum: Vec<f64>,
    meter_frames: u64,
    events: mpsc::Sender<Reliable>,
    levels: Option<mpsc::SyncSender<Lossy>>,
}
impl Writer {
    pub fn new(
        session: String,
        directory: &Path,
        rate: u32,
        channels: usize,
        bits: u16,
        events: mpsc::Sender<Reliable>,
        levels: Option<mpsc::SyncSender<Lossy>>,
    ) -> Self {
        Self {
            session,
            directory: directory.to_path_buf(),
            rate: rate as f64,
            channels,
            bits,
            segment_frames: rate as u64 * SEGMENT_SECONDS,
            current: None,
            total: 0,
            bytes_before: 0,
            sealed: 0,
            checkpoint: Instant::now(),
            peak: vec![0.0; channels],
            sum: vec![0.0; channels],
            meter_frames: 0,
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
    fn event(&self, phase: &str, segment: &Segment) {
        let mut value = json!({"event":"segment","phase":phase,"sessionId":self.session,"segmentId":segment.id,"file":segment.file,"firstFrame":self.total - segment.frames,
            "sampleRate":self.rate,"channels":self.channels,"bitDepth":self.bits,"nativeMonoUs":segment.start_us,"uncertaintyUs":segment.uncertainty_us});
        if phase == "seal" {
            value["frames"] = json!(segment.frames);
        }
        let _ = self.events.send(Reliable::Event(value));
    }
    fn open(&mut self, start_us: f64, uncertainty_us: f64) -> Result<(), String> {
        let id = segment_id();
        let file = format!("{id}.wav");
        let wav = Wav::create(
            &self.directory.join(&file),
            self.rate as u32,
            self.channels as u16,
            self.bits,
        )
        .map_err(crate::io_error)?;
        let segment = Segment {
            id,
            file,
            wav,
            frames: 0,
            start_us,
            uncertainty_us,
        };
        // 段一开就登记：进程中途被杀，主进程凭这条记录和文件里已写的采样补出这一段。
        self.event("open", &segment);
        self.current = Some(segment);
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
        self.event("seal", &segment);
        Ok(())
    }
    /// 写 `frames` 帧（交错采样），`samples` 为空时写静音；跨段时在段界切开，后一段的起点按帧数推算。
    pub fn write(
        &mut self,
        frames: u64,
        mono_us: f64,
        uncertainty_us: f64,
        samples: Option<&[f32]>,
    ) -> Result<(), String> {
        let ch = self.channels;
        let zero = [0.0f32; ZERO_FRAMES * 2];
        let mut offset = 0u64;
        while offset < frames {
            if self.current.is_none() {
                self.open(
                    mono_us + offset as f64 * 1_000_000.0 / self.rate,
                    uncertainty_us,
                )?;
            }
            let segment = self.current.as_mut().unwrap();
            let n = (self.segment_frames - segment.frames).min(frames - offset);
            let range = offset as usize * ch..(offset + n) as usize * ch;
            match samples {
                Some(data) => {
                    segment
                        .wav
                        .write(&data[range.clone()])
                        .map_err(crate::io_error)?;
                    for (i, &sample) in data[range].iter().enumerate() {
                        let c = i % ch;
                        self.peak[c] = self.peak[c].max(sample.abs());
                        self.sum[c] += (sample as f64).powi(2);
                    }
                }
                None => {
                    let mut left = n as usize;
                    while left > 0 {
                        let step = left.min(ZERO_FRAMES);
                        segment
                            .wav
                            .write(&zero[..step * ch])
                            .map_err(crate::io_error)?;
                        left -= step;
                    }
                }
            }
            segment.frames += n;
            self.total += n;
            self.meter_frames += n;
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
        if (self.meter_frames as f64) < self.rate * 0.033 {
            return;
        }
        let frames = self.meter_frames as f64;
        if let Some(levels) = &self.levels {
            let rms: Vec<f64> = self.sum.iter().map(|s| (s / frames).sqrt()).collect();
            let clipped: Vec<bool> = self.peak.iter().map(|p| *p >= 0.999969).collect();
            // 电平丢一条不要紧，下一条 33 ms 后就到。
            let _ = levels.try_send((json!({"event":"level","sessionId":self.session,"peak":self.peak,"rms":rms,"clipped":clipped,"durationSeconds":self.total as f64 / self.rate,"writtenBytes":self.bytes()}), Vec::new()));
        }
        self.peak.fill(0.0);
        self.sum.fill(0.0);
        self.meter_frames = 0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn segments_are_contiguous_and_split_at_exact_frame_counts() {
        let dir = tempfile::tempdir().unwrap();
        // 每秒 1000 帧、每段 5000 帧；写 3000 帧声音 + 4000 帧静音 + 4000 帧声音，应切成 5000 + 5000 + 1000。
        let (events, received) = mpsc::channel();
        let mut w = Writer::new("s".into(), dir.path(), 1000, 2, 16, events, None);
        let tone: Vec<f32> = (0..2 * 1000 * 7).map(|i| (i % 7) as f32 / 10.0).collect();
        w.write(3000, 10_000.0, 0.0, Some(&tone[..2 * 3000]))
            .unwrap();
        w.write(4000, 3_010_000.0, 0.0, None).unwrap();
        w.write(4000, 7_010_000.0, 0.0, Some(&tone[..2 * 4000]))
            .unwrap();
        w.seal().unwrap();
        let all: Vec<Value> = received
            .try_iter()
            .filter_map(|item| match item {
                Reliable::Event(value) => Some(value),
                Reliable::Barrier(_) => None,
            })
            .collect();
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
            assert_eq!(seal["bitDepth"], 16);
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
    fn mono_24_bit_segments_keep_their_own_format() {
        // 麦克风轨按录音设置的声道与位深写：单声道 24 位每帧 3 字节。
        let dir = tempfile::tempdir().unwrap();
        let (events, received) = mpsc::channel();
        let mut w = Writer::new("m".into(), dir.path(), 1000, 1, 24, events, None);
        w.write(1500, 0.0, 12.0, Some(&vec![0.5f32; 1500])).unwrap();
        w.seal().unwrap();
        let sealed: Vec<Value> = received
            .try_iter()
            .filter_map(|item| match item {
                Reliable::Event(value) if value["phase"] == "seal" => Some(value),
                _ => None,
            })
            .collect();
        assert_eq!(sealed.len(), 1);
        assert_eq!(sealed[0]["channels"], 1);
        assert_eq!(sealed[0]["bitDepth"], 24);
        assert_eq!(sealed[0]["uncertaintyUs"], 12.0);
        let path = dir.path().join(sealed[0]["file"].as_str().unwrap());
        assert_eq!(Wav::recover(&path).unwrap(), 1500 * 3);
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
