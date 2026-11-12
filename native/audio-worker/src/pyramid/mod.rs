//! 与 src/core/audioEdit/spectralPyramid.ts 对齐的可重建缓存；不改变用户文档格式。
mod fft;
mod reader;
#[cfg(test)]
mod tests;

use crate::dsp::audio::Audio;
use fft::{Column, Samples};
use rayon::prelude::*;
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    fs::{self, File, OpenOptions},
    io::{BufWriter, Seek, SeekFrom, Write},
    path::PathBuf,
    sync::atomic::{AtomicBool, Ordering},
    time::Instant,
};

type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;
pub const MIN_PERSISTED: usize = 3;
pub const MAX_LEVEL: usize = 15;
const BATCH_BASE_COLUMNS: u64 = 512;
/// 续算只能从所有层都没有未合并列的位置开始：第 3 层列数是 2^(15-3) 的整数倍时，各层计数都是偶数。
/// 合并用的是未量化的功率，落盘字节无法还原，所以对齐点之后的部分重算（最多约 6 分钟素材）。
const RESUME_ALIGN: u64 = 1 << (MAX_LEVEL - MIN_PERSISTED);

#[derive(Debug, Deserialize)]
pub struct TileRequest {
    pub input_path: PathBuf,
    pub output_path: PathBuf,
    pub level: i32,
    pub column_start: u64,
    pub column_count: usize,
}
#[derive(Debug, Deserialize)]
pub struct BuildRequest {
    pub input_path: PathBuf,
    pub output_directory: PathBuf,
}
pub fn column_count(level: i32, frames: u64) -> u64 {
    if frames == 0 {
        return 0;
    }
    if level >= 0 {
        ((frames - 1 + 256) / 512 + 1).div_ceil(1 << level)
    } else {
        let hop = 512_u64 >> -level;
        (frames - 1 + hop / 2) / hop + 1
    }
}
fn check(cancelled: &AtomicBool) -> Result<()> {
    if cancelled.load(Ordering::Relaxed) {
        Err("频谱计算已取消".into())
    } else {
        Ok(())
    }
}
#[derive(Clone, Copy)]
pub struct Resolution {
    low_window: usize,
    high_window: usize,
    low_fft: usize,
    high_fft: usize,
}
/// 与 TS spectralResolution 同源语义：有效分析窗与补零 FFT 网格分别指定。
pub fn resolution(level: i32) -> Resolution {
    let (low_window, high_window, low_fft, high_fft) = match level {
        -1 => (6144, 1536, 8192, 2048),
        -2 => (3072, 768, 4096, 1024),
        // 再细的层仍用 256 点：更短的窗只换来看不出的时间细节，却让谐波整体糊成竖纹。
        ..=-3 => (1024, 256, 4096, 1024),
        _ => (8192, 2048, 8192, 2048),
    };
    Resolution {
        low_window,
        high_window,
        low_fft,
        high_fft,
    }
}
impl Resolution {
    fn low_bins(self, rate: u32) -> usize {
        (1200_u64 * self.low_fft as u64 / rate as u64 + 1) as usize
    }
    fn high_bins(self) -> usize {
        self.high_fft / 2 + 1
    }
}

/// 即时块采用原始 RG 平面，不经 JSON 传输采样值；主进程负责原子缓存发布。
pub fn tile(req: TileRequest, cancelled: &AtomicBool) -> Result<Value> {
    let began = Instant::now();
    if !(-5..=2).contains(&req.level) || req.column_count > 1024 {
        return Err("即时频谱层级或列数无效".into());
    }
    check(cancelled)?;
    let mut input = Audio::open(&req.input_path)?;
    let total = column_count(req.level, input.frames);
    let count = total
        .saturating_sub(req.column_start)
        .min(req.column_count as u64) as usize;
    let layout = resolution(req.level);
    let low = layout.low_bins(input.spec.sample_rate);
    let high = layout.high_bins();
    let channels = input.spec.channels as usize;
    let group = 1_u64 << req.level.max(0);
    let hop = if req.level < 0 {
        512 >> -req.level
    } else {
        512
    };
    let first = req
        .column_start
        .checked_mul(group)
        .and_then(|v| v.checked_mul(hop))
        .ok_or("列范围溢出")?;
    let context = layout.low_window.max(layout.high_window) as u64 / 2;
    let start = first.saturating_sub(context).min(input.frames);
    let end = first
        .saturating_add(count as u64 * group * hop)
        .saturating_add(context)
        .min(input.frames);
    let frames = input.frames;
    let sample_rate = input.spec.sample_rate;
    input.seek(start)?;
    let mut data = Vec::new();
    reader::Stream::new(input)?.append((end - start) as usize * channels, &mut data)?;
    let read_ms = began.elapsed().as_secs_f64() * 1000.0;
    check(cancelled)?;
    let rows = fft::columns(
        &Samples {
            data,
            start,
            channels,
        },
        low,
        req.column_start,
        count,
        req.level,
        column_count(0, frames),
        cancelled,
    )?;
    let fft_ms = began.elapsed().as_secs_f64() * 1000.0 - read_ms;
    let mut temp = crate::dsp::audio::temporary(&req.output_path)?;
    let bins = low + high;
    let mut bytes = vec![0; channels * count * bins * 2];
    bytes
        .par_chunks_mut(bins * 2)
        .enumerate()
        .for_each(|(i, output)| {
            let channel = i / count;
            let row = &rows[i % count];
            for (pair, bin) in output
                .chunks_exact_mut(2)
                .zip(&row.bins[channel * bins..(channel + 1) * bins])
            {
                pair[0] = fft::quantize(bin.peak as f64);
                pair[1] = fft::quantize(bin.sum / row.count as f64);
            }
        });
    let encode_ms = began.elapsed().as_secs_f64() * 1000.0 - read_ms - fft_ms;
    check(cancelled)?;
    temp.write_all(&bytes)?;
    // 可重建缓存无需每块 fsync；原子改名确保读者只看到完整块。
    temp.persist_noclobber(&req.output_path)?;
    Ok(
        json!({ "columnCount":count, "sampleRate":sample_rate, "channels":channels,
        "durationFrames":frames,"lowBins":low,"highBins":high,"readMs":read_ms,"fftMs":fft_ms,"encodeMs":encode_ms,"elapsedMs":began.elapsed().as_secs_f64()*1000.0 }),
    )
}

/// 每层每声道一个追加文件：level-{层}-channel-{声道}.rg，内容 [列][频点][R,G]。
/// manifest.json 原子替换；available 是所有声道都 flush 后的列数，只有 done 才包含末尾不足组。
/// 未量化的功率和计数只在内存中逐级合并，不能从落盘字节恢复上一层。
struct Store {
    directory: PathBuf,
    writers: Vec<Vec<BufWriter<File>>>,
    pending: Vec<Option<Column>>,
    available: Vec<u64>,
    /// 已落盘（sync_data）的续算对齐点序号；清单宣称的对齐点不会超过它。
    synced: u64,
    sample_rate: u32,
    channels: usize,
    frames: u64,
    low: usize,
}
impl Store {
    /// 目录已存在且清单与输入一致时，从对齐点续写：对齐点之前的字节保留，之后的按同样的计算原位重写。
    /// 计算是确定的，重写的字节与原有字节相同，读者按旧清单读到的内容始终有效。返回续算起点（第 3 层列数）。
    fn open(directory: PathBuf, input: &Audio) -> Result<(Self, u64)> {
        let channels = input.spec.channels as usize;
        let low = resolution(0).low_bins(input.spec.sample_rate);
        let row = ((low + 1025) * 2) as u64;
        let fresh = !directory.try_exists()?;
        if fresh {
            fs::create_dir(&directory)?;
        }
        let mut resume = if fresh {
            0
        } else {
            fs::read(directory.join("manifest.json"))
                .ok()
                .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
                .filter(|m| {
                    m["format"] == "spectral-pyramid-v1"
                        && m["sampleRate"] == input.spec.sample_rate
                        && m["channels"] == channels
                        && m["durationFrames"] == input.frames
                        && m["lowBins"] == low
                        && m["highBins"] == 1025
                })
                .and_then(|m| m["available"][MIN_PERSISTED].as_u64())
                .map_or(0, |columns| columns / RESUME_ALIGN * RESUME_ALIGN)
        };
        let file = |level: usize, channel: usize| directory.join(format!("level-{level}-channel-{channel}.rg"));
        // 某个文件比对齐点短（被外部截断）就整遍重算。
        for level in MIN_PERSISTED..=MAX_LEVEL {
            for channel in 0..channels {
                let need = (resume >> (level - MIN_PERSISTED)) * row;
                if fs::metadata(file(level, channel)).map_or(true, |m| m.len() < need) {
                    resume = 0;
                }
            }
        }
        let mut writers = Vec::new();
        let mut available = vec![0; MAX_LEVEL + 1];
        for level in MIN_PERSISTED..=MAX_LEVEL {
            available[level] = resume >> (level - MIN_PERSISTED);
            let offset = available[level] * row;
            writers.push(
                (0..channels)
                    .map(|channel| -> std::io::Result<BufWriter<File>> {
                        let mut handle = OpenOptions::new().write(true).create(true).truncate(false).open(file(level, channel))?;
                        // 从头重算且与清单不一致时先清空，避免残留更长的旧内容。
                        if resume == 0 {
                            handle.set_len(0)?;
                        }
                        handle.seek(SeekFrom::Start(offset))?;
                        Ok(BufWriter::new(handle))
                    })
                    .collect::<std::io::Result<Vec<_>>>()?,
            );
        }
        Ok((
            Self {
                directory,
                writers,
                pending: vec![None; MAX_LEVEL + 1],
                available,
                synced: resume / RESUME_ALIGN,
                sample_rate: input.spec.sample_rate,
                channels,
                frames: input.frames,
                low,
            },
            resume,
        ))
    }
    fn push(&mut self, mut level: usize, mut columns: Vec<Column>) -> Result<()> {
        let bins = self.low + 1025;
        while level <= MAX_LEVEL && !columns.is_empty() {
            let encoded: Vec<Vec<u8>> = columns
                .par_iter()
                .map(|column| {
                    let mut bytes = Vec::with_capacity(column.bins.len() * 2);
                    column.encode(&mut bytes);
                    bytes
                })
                .collect();
            for channel in 0..self.channels {
                for bytes in &encoded {
                    self.writers[level - MIN_PERSISTED][channel]
                        .write_all(&bytes[channel * bins * 2..(channel + 1) * bins * 2])?;
                }
            }
            self.available[level] += columns.len() as u64;
            let mut next = Vec::with_capacity(columns.len().div_ceil(2));
            let mut previous = self.pending[level].take();
            for column in columns {
                if let Some(mut first) = previous.take() {
                    first.merge(&column);
                    next.push(first);
                } else {
                    previous = Some(column);
                }
            }
            self.pending[level] = previous;
            columns = next;
            level += 1;
        }
        Ok(())
    }
    fn publish(&mut self, covered: u64, done: bool) -> Result<Value> {
        for layer in &mut self.writers {
            for writer in layer {
                writer.flush()?;
            }
        }
        // 续算信任清单里对齐点之前的字节：对齐点前进（或完成）时先把数据落盘再换清单，
        // 断电后不会出现清单还在、数据页却没写进磁盘的情况。对齐点之间不 sync，避免每批都刷盘。
        let aligned = self.available[MIN_PERSISTED] / RESUME_ALIGN;
        if done || aligned > self.synced {
            for layer in &self.writers {
                for writer in layer {
                    writer.get_ref().sync_data()?;
                }
            }
            self.synced = aligned;
        }
        let manifest = json!({"format":"spectral-pyramid-v1","sampleRate":self.sample_rate,"channels":self.channels,
            "durationFrames":self.frames,"lowBins":self.low,"highBins":1025,"available":self.available,
            "coveredFrames":covered,"done":done});
        let mut temporary = tempfile::NamedTempFile::new_in(&self.directory)?;
        serde_json::to_writer(&mut temporary, &manifest)?;
        // Windows 上主进程正在读清单时替换会被拒绝访问；读取只持有很短时间，稍等重试，不能让整遍计算失败。
        let target = self.directory.join("manifest.json");
        let mut attempt = 0;
        loop {
            match temporary.persist(&target) {
                Ok(_) => break,
                Err(error)
                    if error.error.kind() == std::io::ErrorKind::PermissionDenied
                        && attempt < 100 =>
                {
                    temporary = error.file;
                    attempt += 1;
                    std::thread::sleep(std::time::Duration::from_millis(5));
                }
                Err(error) => return Err(error.error.into()),
            }
        }
        Ok(manifest)
    }
}

pub fn build(
    req: BuildRequest,
    cancelled: &AtomicBool,
    yield_to_tiles: impl Fn(),
    progress: impl Fn(Value),
) -> Result<Value> {
    let began = Instant::now();
    check(cancelled)?;
    let mut input = Audio::open(&req.input_path)?;
    let (mut store, resume) = Store::open(req.output_directory, &input)?;
    let total = column_count(0, input.frames);
    let frames = input.frames;
    let channels = input.spec.channels as usize;
    // 续算起点是第 3 层列的对齐点，对应的基础列也落在批边界上；上下文从该批需要的最早样本读起。
    let first_base = resume * 8;
    let mut read_frame = (first_base * 512).saturating_sub(4096).min(frames);
    if resume == 0 {
        store.publish(0, false)?;
    }
    input.seek(read_frame)?;
    // 滑动上下文仅保留下一批需要的重叠窗。每个源样本只解码一次，内存不随素材长度增长。
    let mut samples = reader::Stream::new(input)?;
    let mut block = Samples {
        data: Vec::new(),
        start: read_frame,
        channels,
    };
    for base in (first_base..total).step_by(BATCH_BASE_COLUMNS as usize) {
        yield_to_tiles();
        check(cancelled)?;
        let limit = (base + BATCH_BASE_COLUMNS).min(total);
        let start = (base * 512).saturating_sub(4096).min(frames);
        let end = ((limit - 1) * 512 + 4096).min(frames);
        let discard = ((start - block.start) as usize * channels).min(block.data.len());
        block.data.drain(..discard);
        block.start = start;
        samples.append((end - read_frame) as usize * channels, &mut block.data)?;
        read_frame = end;
        let rows = fft::columns(
            &block,
            store.low,
            base / 8,
            (limit - base).div_ceil(8) as usize,
            3,
            total,
            cancelled,
        )?;
        store.push(MIN_PERSISTED, rows)?;
        check(cancelled)?;
        // 最后一批的非整组只在最终 done 清单发布，避免把末尾误判为完整时间覆盖。
        if limit < total {
            let covered = (limit * 512).saturating_sub(256).min(frames);
            store.publish(covered, false)?;
            progress(json!({"coveredFrames":covered,"durationFrames":frames,"done":false}));
        }
    }
    for level in MIN_PERSISTED..MAX_LEVEL {
        if let Some(column) = store.pending[level].take() {
            store.push(level + 1, vec![column])?;
        }
    }
    check(cancelled)?;
    let mut result = store.publish(frames, true)?;
    progress(json!({"coveredFrames":frames,"durationFrames":frames,"done":true}));
    result["elapsedMs"] = json!(began.elapsed().as_secs_f64() * 1000.0);
    result["resumedFromFrame"] = json!((first_base * 512).min(frames));
    Ok(result)
}
