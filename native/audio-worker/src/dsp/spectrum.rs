use super::{
    audio::{self, Audio},
    validate_fft, Result, SpectrogramRequest,
};
use rustfft::{num_complex::Complex32, Fft, FftPlanner};
use serde_json::{json, Value};
use std::{
    f32::consts::TAU,
    io::{BufWriter, Write},
    sync::Arc,
    time::Instant,
};

pub struct Transform {
    pub n: usize,
    pub window: Vec<f32>,
    forward: Arc<dyn Fft<f32>>,
    inverse: Arc<dyn Fft<f32>>,
    scratch: Vec<Complex32>,
}

impl Transform {
    pub fn new(n: usize) -> Self {
        let mut planner = FftPlanner::new();
        let forward = planner.plan_fft_forward(n);
        let inverse = planner.plan_fft_inverse(n);
        let scratch = vec![
            Complex32::default();
            forward
                .get_inplace_scratch_len()
                .max(inverse.get_inplace_scratch_len())
        ];
        Self {
            n,
            window: (0..n)
                .map(|i| 0.5 - 0.5 * (TAU * i as f32 / n as f32).cos())
                .collect(),
            forward,
            inverse,
            scratch,
        }
    }
    pub fn forward(&mut self, data: &mut [Complex32]) {
        self.forward.process_with_scratch(data, &mut self.scratch);
    }
    pub fn inverse(&mut self, data: &mut [Complex32]) {
        self.inverse.process_with_scratch(data, &mut self.scratch);
    }
}

/// HJSP v1: 64-byte header, all integers little-endian. Offsets:
/// 0 magic[4]="HJSP", 4 version:u16=1, 6 headerBytes:u16=64,
/// 8 sampleRate:u32, 12 channels:u32 (output planes), 16 fftSize:u32,
/// 20 hop:u32, 24 frames:u64 (STFT columns), 32 bins:u32=N/2+1,
/// 36 sourceChannels:u32, 40 startFrame:u64, 48 endFrame:u64 (exclusive),
/// 56 channel:i32 (-1=all, otherwise zero-based source index), 60 reserved:u32=0.
/// Payload u8[channel][time][bin], frequency increases DC..Nyquist.
/// Column t is centered at startFrame+t*hop; out-of-file samples are zero.
/// Periodic Hann, coherent-gain-corrected ONE-SIDED amplitude, dBFS:
/// round(clamp((20*log10(amplitude)+120)/120,0,1)*255).
/// DC/Nyquist are not doubled. No per-file normalization or dithering.
/// Largest column spacing: one hour at 48 kHz still fits a few thousand columns.
pub const MAX_HOP: usize = 1 << 24;

fn quantize_row(buffer: &[Complex32], n: usize, gain: f32, row: &mut [u8]) {
    for (k, value) in row.iter_mut().enumerate() {
        let factor = if k == 0 || k == n / 2 { 1.0 } else { 2.0 };
        let amplitude = buffer[k].norm() * factor / gain;
        let db = 20.0 * amplitude.max(1e-6).log10();
        *value = ((db + 120.0) * (255.0 / 120.0)).clamp(0.0, 255.0).round() as u8;
    }
}

pub fn spectrogram(req: SpectrogramRequest) -> Result<Value> {
    let began = Instant::now();
    validate_fft(req.fft_size)?;
    let n = req.fft_size;
    let window_size = req.window_size.unwrap_or(n);
    validate_fft(window_size)?;
    if window_size > n {
        return Err("window_size must not exceed fft_size".into());
    }
    let hop = req.hop.unwrap_or(n / 4);
    // 旧调用允许 hop 大于窗长；启用聚合后仍按输出列数控制 IPC 数据量。
    if hop == 0 || hop > MAX_HOP {
        return Err(format!("hop must be in 1..={MAX_HOP}").into());
    }
    let mut input = Audio::open(&req.input_path)?;
    let start = req.start_frame.unwrap_or(0);
    let end = req.end_frame.unwrap_or(input.frames);
    audio::validate_range(start, end, input.frames)?;
    let source_channels = usize::from(input.spec.channels);
    if req.channel.is_some_and(|c| c >= source_channels) {
        return Err("channel is out of range (zero-based)".into());
    }
    let channels: Vec<usize> = req
        .channel
        .map_or_else(|| (0..source_channels).collect(), |c| vec![c]);
    let frames = (end - start).div_ceil(hop as u64);
    let bins = n / 2 + 1;
    let bytes = 64 + channels.len() as u64 * frames * bins as u64;
    let mut temp = audio::temporary(&req.output_path)?;
    let mut writer = BufWriter::new(temp.as_file_mut());
    writer.write_all(b"HJSP")?;
    writer.write_all(&1_u16.to_le_bytes())?;
    writer.write_all(&64_u16.to_le_bytes())?;
    for x in [
        input.spec.sample_rate,
        channels.len() as u32,
        n as u32,
        hop as u32,
    ] {
        writer.write_all(&x.to_le_bytes())?;
    }
    writer.write_all(&frames.to_le_bytes())?;
    writer.write_all(&(bins as u32).to_le_bytes())?;
    writer.write_all(&(source_channels as u32).to_le_bytes())?;
    writer.write_all(&start.to_le_bytes())?;
    writer.write_all(&end.to_le_bytes())?;
    writer.write_all(&req.channel.map_or(-1, |c| c as i32).to_le_bytes())?;
    writer.write_all(&0_u32.to_le_bytes())?;
    let mut fft = Transform::new(n);
    let window: Vec<f32> = (0..window_size)
        .map(|i| 0.5 - 0.5 * (TAU * i as f32 / window_size as f32).cos())
        .collect();
    // 以实际窗的相干增益归一化，补零不会让画面变暗。
    let gain = window.iter().sum::<f32>();
    let mut ring = vec![0_f32; window_size];
    let mut buffer = vec![Complex32::default(); n];
    let mut row = vec![0_u8; bins];
    let mut peak = vec![0_u8; bins];
    let mut energy = vec![0_f64; bins];
    let powers: Vec<f64> = (0..256)
        .map(|v| 10_f64.powf((v as f64 / 255.0 * 120.0 - 120.0) / 10.0))
        .collect();
    // 与显示端相同：65% 峰值 dB + 35% 能量均值 dB，长总览也保留爆音。
    const PEAK_WEIGHT: f64 = 0.65;
    let pooled = req.time_pooling && hop > window_size / 4;
    let step = if pooled { window_size / 4 } else { hop };
    for &channel in &channels {
        let total = input.frames as i64;
        let first_center = if pooled {
            (start as i64 - hop as i64 / 2).max(0)
        } else {
            start as i64
        };
        let first_begin = first_center - (window_size / 2) as i64;
        input.seek(first_begin.max(0) as u64)?;
        let mut samples = input.samples();
        let mut next_frame = first_begin;
        let mut head = 0;
        let mut previous_center: Option<i64> = None;
        ring.fill(0.0);
        for t in 0..frames {
            let center = start as i64 + t as i64 * hop as i64;
            // 以全文件为上下文，绝不能把 tile 边界当作文件边界补零。
            let begin = if pooled {
                (center - hop as i64 / 2).max(0)
            } else {
                center
            };
            let limit = if pooled && t == frames - 1 && end == total as u64 {
                // 最后一格延展到真实文件末尾，不能漏掉半 hop 尾段里的瞬态。
                total
            } else if pooled {
                (center + (hop as i64 + 1) / 2).min(total)
            } else {
                center + 1
            };
            peak.fill(0);
            energy.fill(0.0);
            let mut count = 0;
            for position in (begin..limit).step_by(step) {
                let delta =
                    previous_center.map_or(window_size, |previous| (position - previous) as usize);
                let read_count = delta.min(window_size);
                let target = position - (window_size / 2) as i64;
                // 稀疏旧协议跳过两窗之间的样本；连续总览只顺序读，内存与音频长度无关。
                while next_frame < target {
                    if (0..total).contains(&next_frame) {
                        for _ in 0..source_channels {
                            samples.next().ok_or("unexpected end of WAV")??;
                        }
                    }
                    next_frame += 1;
                }
                if delta >= window_size {
                    head = 0;
                }
                for j in 0..read_count {
                    let mut value = 0.0;
                    if (0..total).contains(&next_frame) {
                        for c in 0..source_channels {
                            let x = samples.next().ok_or("unexpected end of WAV")??;
                            if c == channel {
                                value = x;
                            }
                        }
                    }
                    ring[(head + j) % window_size] = value;
                    next_frame += 1;
                }
                if delta < window_size {
                    head = (head + delta) % window_size;
                }
                buffer.fill(Complex32::default());
                for j in 0..window_size {
                    buffer[j] = Complex32::new(ring[(head + j) % window_size] * window[j], 0.0);
                }
                fft.forward(&mut buffer);
                quantize_row(&buffer, n, gain, &mut row);
                if pooled {
                    for k in 0..bins {
                        peak[k] = peak[k].max(row[k]);
                        energy[k] += powers[row[k] as usize];
                    }
                }
                count += 1;
                previous_center = Some(position);
            }
            if pooled {
                for k in 0..bins {
                    let mean = ((10.0 * (energy[k] / count as f64).max(1e-12).log10() + 120.0)
                        * 255.0
                        / 120.0)
                        .clamp(0.0, 255.0);
                    row[k] =
                        (peak[k] as f64 * PEAK_WEIGHT + mean * (1.0 - PEAK_WEIGHT)).round() as u8;
                }
            }
            writer.write_all(&row)?;
        }
    }
    writer.flush()?;
    drop(writer);
    let written = audio::publish(temp, &req.output_path)?;
    debug_assert_eq!(written, bytes);
    Ok(
        json!({"outputPath":req.output_path,"format":"HJSP","formatVersion":1,"headerBytes":64,
        "sampleRate":input.spec.sample_rate,"channels":channels.len(),"sourceChannels":source_channels,
        "channel":req.channel,"fftSize":n,"windowSize":window_size,"timePooling":req.time_pooling,"hop":hop,"frames":frames,"bins":bins,
        "startFrame":start,"endFrame":end,"minDb":-120,"maxDb":0,"bytes":written,
        "elapsedMs":began.elapsed().as_secs_f64()*1000.0}),
    )
}
