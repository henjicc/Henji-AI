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
    fs::{self, File},
    io::{BufWriter, Write},
    path::PathBuf,
    sync::atomic::{AtomicBool, Ordering},
    time::Instant,
};

type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;
pub const MIN_PERSISTED: usize = 3;
pub const MAX_LEVEL: usize = 15;
const BATCH_BASE_COLUMNS: u64 = 512;

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
fn low_bins(rate: u32) -> usize {
    (1200_u64 * 8192 / rate as u64 + 1) as usize
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
    let low = low_bins(input.spec.sample_rate);
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
    let start = first.saturating_sub(4096).min(input.frames);
    let end = first
        .saturating_add(count as u64 * group * hop)
        .saturating_add(4096)
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
    let bins = low + 1025;
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
        "durationFrames":frames,"lowBins":low,"highBins":1025,"readMs":read_ms,"fftMs":fft_ms,"encodeMs":encode_ms,"elapsedMs":began.elapsed().as_secs_f64()*1000.0 }),
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
    sample_rate: u32,
    channels: usize,
    frames: u64,
    low: usize,
}
impl Store {
    fn new(directory: PathBuf, input: &Audio) -> Result<Self> {
        // 必须新建目录，避免失败重试覆盖仍被读者持有的上一代文件。
        fs::create_dir(&directory)?;
        let channels = input.spec.channels as usize;
        let mut writers = Vec::new();
        for level in MIN_PERSISTED..=MAX_LEVEL {
            writers.push(
                (0..channels)
                    .map(|channel| {
                        File::create(directory.join(format!("level-{level}-channel-{channel}.rg")))
                            .map(BufWriter::new)
                    })
                    .collect::<std::io::Result<Vec<_>>>()?,
            );
        }
        Ok(Self {
            directory,
            writers,
            pending: vec![None; MAX_LEVEL + 1],
            available: vec![0; MAX_LEVEL + 1],
            sample_rate: input.spec.sample_rate,
            channels,
            frames: input.frames,
            low: low_bins(input.spec.sample_rate),
        })
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
        let manifest = json!({"format":"spectral-pyramid-v1","sampleRate":self.sample_rate,"channels":self.channels,
            "durationFrames":self.frames,"lowBins":self.low,"highBins":1025,"available":self.available,
            "coveredFrames":covered,"done":done});
        let mut temporary = tempfile::NamedTempFile::new_in(&self.directory)?;
        serde_json::to_writer(&mut temporary, &manifest)?;
        temporary.persist(self.directory.join("manifest.json"))?;
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
    let input = Audio::open(&req.input_path)?;
    let mut store = Store::new(req.output_directory, &input)?;
    store.publish(0, false)?;
    let total = column_count(0, input.frames);
    let frames = input.frames;
    let channels = input.spec.channels as usize;
    // 滑动上下文仅保留下一批需要的重叠窗。每个源样本只解码一次，内存不随素材长度增长。
    let mut samples = reader::Stream::new(input)?;
    let mut block = Samples {
        data: Vec::new(),
        start: 0,
        channels,
    };
    let mut read_frame = 0_u64;
    for base in (0..total).step_by(BATCH_BASE_COLUMNS as usize) {
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
    Ok(result)
}
