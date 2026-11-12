use super::{
    audio::{self, Audio, F32Writer},
    lpc,
    spectrum::Transform,
    validate_fft, DeclickRequest, HealRequest, Region, Result, TimeRange,
};
use rustfft::num_complex::Complex32;
use serde_json::{json, Value};
use std::{
    f64::consts::{PI, TAU},
    fs::File,
    io::Read,
    path::Path,
    time::Instant,
};

// Groups overlapping in time are solved together against original context
// (order independent). A long selection is processed in output chunks of this
// many frames, so the working set does not grow with the selection length.
const HEAL_CHUNK_FRAMES: u64 = 1 << 20;

// 与主进程的契约：electron/main/services/audio-edit/dsp-adapter.ts 的 AUDIO_WORKER_CONTRACT 按下面几个常量
// 判断“修复只改写选区、只读选区两侧多少帧”（编辑后声音只重算改动的帧靠它），改了要两边一起改；dsp-adapter.test.ts 读本文件核对。
/// 频谱修复的 hop = n / HEAL_HOP_DIVISOR；选区两侧读 n + hop 帧。
pub(crate) const HEAL_HOP_DIVISOR: usize = 4;
/// 去爆音一条命令最多几段。
pub(crate) const DECLICK_MAX_RANGES: usize = 4096;
/// 去爆音单段上限（毫秒）。
pub(crate) const DECLICK_MAX_MS: u64 = 128;
/// 两侧训练上下文 = 单段上限帧数 × DECLICK_MARGIN_PER_LIMIT，夹在 [DECLICK_MARGIN_MIN, DECLICK_MARGIN_MAX]。
pub(crate) const DECLICK_MARGIN_PER_LIMIT: u64 = 4;
pub(crate) const DECLICK_MARGIN_MIN: u64 = 512;
pub(crate) const DECLICK_MARGIN_MAX: u64 = 8192;

struct Selection {
    region: Region,
    low: usize,
    high: usize,
    width: usize,
    mask: Option<Vec<u8>>,
}

impl Selection {
    /// HJMK v1, little-endian: magic[4]="HJMK", version:u16=1,
    /// headerBytes:u16=16, width:u32, height:u32, followed by exactly width*height
    /// bytes. Row-major mask[frequency][time], 0=keep, 255=full repair.
    /// hop=N/4; width=ceil((end-start)/hop); height=highBin-lowBin+1;
    /// lowBin=ceil(lowHz*N/sampleRate), highBin=floor(highHz*N/sampleRate).
    /// x maps to center start+x*hop, y maps to bin lowBin+y. Frequency increases
    /// bottom-to-top conceptually; file row zero is LOW frequency (flip in UI).
    fn new(region: Region, audio: &Audio, n: usize) -> Result<Self> {
        audio::validate_range(region.start_frame, region.end_frame, audio.frames)?;
        if !region.low_hz.is_finite()
            || !region.high_hz.is_finite()
            || region.low_hz < 0.0
            || region.low_hz > region.high_hz
            || region.high_hz > audio.spec.sample_rate as f64 / 2.0
        {
            return Err("frequencies must satisfy 0 <= low_hz <= high_hz <= sample_rate/2".into());
        }
        let low = (region.low_hz * n as f64 / audio.spec.sample_rate as f64).ceil() as usize;
        let high = (region.high_hz * n as f64 / audio.spec.sample_rate as f64).floor() as usize;
        if low > high {
            return Err(
                "frequency selection contains no FFT bin; widen it or increase fft_size".into(),
            );
        }
        let width = (region.end_frame - region.start_frame).div_ceil((n / HEAL_HOP_DIVISOR) as u64) as usize;
        let height = high - low + 1;
        let mask = if let Some(path) = &region.mask_path {
            let mut file = File::open(path)?;
            let expected = (width as u64) * (height as u64);
            if file.metadata()?.len() != 16 + expected {
                return Err("mask byte length does not match region dimensions".into());
            }
            let mut header = [0_u8; 16];
            file.read_exact(&mut header)?;
            if &header[..4] != b"HJMK"
                || header[4..8] != [1, 0, 16, 0]
                || u32::from_le_bytes(header[8..12].try_into()?) as usize != width
                || u32::from_le_bytes(header[12..16].try_into()?) as usize != height
            {
                return Err("invalid HJMK v1 header or mask dimensions".into());
            }
            let mut bytes = vec![0; expected as usize];
            file.read_exact(&mut bytes)?;
            Some(bytes)
        } else {
            None
        };
        Ok(Self {
            region,
            low,
            high,
            width,
            mask,
        })
    }

    fn weight(&self, center: i64, bin: usize, n: usize) -> f32 {
        if bin < self.low
            || bin > self.high
            || center + n as i64 / 2 <= self.region.start_frame as i64
            || center - n as i64 / 2 >= self.region.end_frame as i64
        {
            return 0.0;
        }
        // Extend edge columns to windows intersecting the rectangle; the final
        // time-domain delta is gated INSIDE the exact selected sample interval.
        let x = ((center - self.region.start_frame as i64).max(0) as usize / (n / HEAL_HOP_DIVISOR))
            .min(self.width - 1);
        self.mask.as_ref().map_or(1.0, |mask| {
            mask[(bin - self.low) * self.width + x] as f32 / 255.0
        })
    }
}

fn groups(ranges: impl Iterator<Item = TimeRange>) -> Vec<TimeRange> {
    let mut ranges: Vec<_> = ranges.collect();
    ranges.sort_by_key(|r| r.start_frame);
    let mut merged: Vec<TimeRange> = Vec::new();
    for r in ranges {
        if let Some(last) = merged.last_mut() {
            if r.start_frame <= last.end_frame {
                last.end_frame = last.end_frame.max(r.end_frame);
                continue;
            }
        }
        merged.push(r);
    }
    merged
}

/// 修复结果按顺序交给 emit：一次给出整段或分块给出均可，总样本数必须等于区间长度 × 声道数。
type Emit<'a> = dyn FnMut(&[f32]) -> Result<()> + 'a;

fn render(
    input_path: &Path,
    output_path: &Path,
    ranges: &[TimeRange],
    mut repair: impl FnMut(&mut Audio, &TimeRange, &mut Emit) -> Result<()>,
) -> Result<(u64, u32, u16, u64)> {
    let mut audio = Audio::open(input_path)?;
    let channels = audio.spec.channels;
    let sample_rate = audio.spec.sample_rate;
    let frames = audio.frames;
    let mut temp = audio::temporary(output_path)?;
    // 超过 4 GiB 自动写成 RF64，长素材不再因 RIFF 长度字段被拒绝。
    let mut writer = F32Writer::new(temp.as_file_mut(), channels, sample_rate)?;
    let report = |done: u64| crate::progress::report(done, frames);
    let mut cursor = 0;
    for range in ranges {
        audio::copy_to(&mut audio, &mut writer, cursor, range.start_frame, report)?;
        let expected = (range.end_frame - range.start_frame) * u64::from(channels);
        let mut written = 0_u64;
        {
            let mut emit = |samples: &[f32]| -> Result<()> {
                if samples.iter().any(|x| !x.is_finite()) {
                    return Err("repair produced a non-finite sample".into());
                }
                written += samples.len() as u64;
                if written > expected {
                    return Err("internal repair length mismatch".into());
                }
                writer.write_samples(samples)?;
                report(range.start_frame + written / u64::from(channels));
                Ok(())
            };
            repair(&mut audio, range, &mut emit)?;
        }
        if written != expected {
            return Err("internal repair length mismatch".into());
        }
        cursor = range.end_frame;
    }
    audio::copy_to(&mut audio, &mut writer, cursor, frames, report)?;
    writer.finalize()?;
    let bytes = audio::publish(temp, output_path)?;
    Ok((frames, sample_rate, channels, bytes))
}

pub fn declick(req: DeclickRequest) -> Result<Value> {
    let began = Instant::now();
    let source = Audio::open(&req.input_path)?;
    if req.ranges.len() > DECLICK_MAX_RANGES {
        return Err(format!("at most {DECLICK_MAX_RANGES} ranges per command").into());
    }
    for r in &req.ranges {
        audio::validate_range(r.start_frame, r.end_frame, source.frames)?;
    }
    let merged = groups(req.ranges.iter().cloned());
    let limit = u64::from(source.spec.sample_rate) * DECLICK_MAX_MS / 1000;
    for r in &merged {
        if r.end_frame - r.start_frame > limit {
            return Err(format!("declick selection (including overlapping/adjacent ranges) exceeds 128 ms ({limit} frames at {} Hz)",source.spec.sample_rate).into());
        }
        if r.start_frame < 32 || source.frames - r.end_frame < 32 {
            return Err("declick requires at least 32 clean context frames on each side".into());
        }
    }
    drop(source);
    let margin = (limit * DECLICK_MARGIN_PER_LIMIT).clamp(DECLICK_MARGIN_MIN, DECLICK_MARGIN_MAX);
    let (frames, sr, channels, bytes) = render(
        &req.input_path,
        &req.output_path,
        &merged,
        |audio, range, emit| {
            let c = usize::from(audio.spec.channels);
            let from = range.start_frame.saturating_sub(margin);
            let to = (range.end_frame + margin).min(audio.frames);
            let block = audio.read(from, to)?;
            let start = (range.start_frame - from) as usize;
            let len = (range.end_frame - range.start_frame) as usize;
            // Stop training before other requested ranges, not merely the current one.
            let left_bound = merged
                .iter()
                .filter(|r| r.end_frame <= range.start_frame)
                .map(|r| r.end_frame)
                .max()
                .unwrap_or(0)
                .saturating_sub(from) as usize;
            let right_bound = merged
                .iter()
                .filter(|r| r.start_frame >= range.end_frame)
                .map(|r| r.start_frame)
                .min()
                .unwrap_or(audio.frames)
                .saturating_sub(from)
                .min((block.len() / c) as u64) as usize;
            let mut output = vec![0.0; len * c];
            for channel in 0..c {
                let left: Vec<_> = (left_bound..start)
                    .map(|i| block[i * c + channel])
                    .collect();
                let right: Vec<_> = (start + len..right_bound)
                    .map(|i| block[i * c + channel])
                    .collect();
                let prediction = lpc::interpolate(&left, &right, len)?;
                for i in 0..len {
                    output[i * c + channel] = prediction[i];
                }
            }
            emit(&output)
        },
    )?;
    Ok(
        json!({"outputPath":req.output_path,"sampleRate":sr,"channels":channels,"frames":frames,"sampleFormat":"float32","processedRanges":req.ranges.len(),"mergedRanges":merged.len(),"maxRangeMs":128,"bytes":bytes,"elapsedMs":began.elapsed().as_secs_f64()*1000.0}),
    )
}

fn wrap(x: f64) -> f64 {
    (x + PI).rem_euclid(TAU) - PI
}

fn spectrum_at(fft: &mut Transform, signal: &[f32], center: i64) -> Vec<Complex32> {
    let mut buffer: Vec<_> = (0..fft.n)
        .map(|j| {
            let i = center - fft.n as i64 / 2 + j as i64;
            Complex32::new(
                if i >= 0 {
                    signal.get(i as usize).copied().unwrap_or(0.0) * fft.window[j]
                } else {
                    0.0
                },
                0.0,
            )
        })
        .collect();
    fft.forward(&mut buffer);
    buffer
}

fn fade(frame: u64, region: &Region, hop: usize) -> f32 {
    if frame < region.start_frame || frame >= region.end_frame {
        return 0.0;
    }
    let length = region.end_frame - region.start_frame;
    let ramp = (hop as u64).min(length / 8).max(1);
    let distance = (frame - region.start_frame).min(region.end_frame - 1 - frame);
    let t = (distance as f64 / ramp as f64).min(1.0);
    (0.5 - 0.5 * (PI * t).cos()) as f32
}

pub fn spectral_heal(req: HealRequest) -> Result<Value> {
    spectral_heal_in_chunks(req, HEAL_CHUNK_FRAMES)
}

/// chunk_frames 只影响工作集大小，不影响结果：输出逐样本与整段一次处理相同。
pub(super) fn spectral_heal_in_chunks(req: HealRequest, chunk_frames: u64) -> Result<Value> {
    let began = Instant::now();
    validate_fft(req.fft_size)?;
    if !req.strength.is_finite() || !(0.0..=1.0).contains(&req.strength) {
        return Err("strength must be in 0..=1".into());
    }
    let audio = Audio::open(&req.input_path)?;
    if req
        .sample_rate
        .is_some_and(|sr| sr != audio.spec.sample_rate)
    {
        return Err("sample_rate does not match input WAV; no resampling is performed".into());
    }
    if req.regions.len() > 1024 {
        return Err("at most 1024 regions per command".into());
    }
    let n = req.fft_size;
    let hop = n / HEAL_HOP_DIVISOR;
    let selections = req
        .regions
        .into_iter()
        .map(|r| Selection::new(r, &audio, n))
        .collect::<Result<Vec<_>>>()?;
    drop(audio);
    let merged = groups(selections.iter().map(|s| TimeRange {
        start_frame: s.region.start_frame,
        end_frame: s.region.end_frame,
    }));
    let mut fft = Transform::new(n);
    let strength = req.strength;
    let (frames, sr, channels, bytes) = render(
        &req.input_path,
        &req.output_path,
        &merged,
        |audio, range, emit| heal_range(audio, range, &selections, &merged, &mut fft, strength, chunk_frames.max(1), emit),
    )?;
    Ok(
        json!({"outputPath":req.output_path,"sampleRate":sr,"channels":channels,"frames":frames,"sampleFormat":"float32","processedRegions":selections.len(),"mergedRanges":merged.len(),"fftSize":n,"hop":hop,"strength":strength,"bytes":bytes,"elapsedMs":began.elapsed().as_secs_f64()*1000.0}),
    )
}

/// 读取绝对帧区间 [start, end) 中落在文件内的部分，返回实际起点；文件外的样本由 spectrum_at 按零处理。
fn read_window(audio: &mut Audio, start: i64, end: i64) -> Result<(i64, Vec<f32>)> {
    let limit = audio.frames as i64;
    let (from, to) = (start.clamp(0, limit), end.clamp(0, limit));
    Ok((from, if to > from { audio.read(from as u64, to as u64)? } else { Vec::new() }))
}

fn channel_of(data: &[f32], channels: usize, channel: usize) -> Vec<f32> {
    data.chunks_exact(channels).map(|s| s[channel]).collect()
}

#[allow(clippy::too_many_arguments)]
fn heal_range(
    audio: &mut Audio,
    range: &TimeRange,
    selections: &[Selection],
    merged: &[TimeRange],
    fft: &mut Transform,
    strength: f32,
    chunk_frames: u64,
    emit: &mut Emit,
) -> Result<()> {
    let n = fft.n;
    let hop = n / HEAL_HOP_DIVISOR;
    let c = usize::from(audio.spec.channels);
    let len = range.end_frame - range.start_frame;
    let local: Vec<_> = selections
        .iter()
        .filter(|s| s.region.start_frame < range.end_frame && s.region.end_frame > range.start_frame)
        .collect();
    if strength == 0.0
        || local
            .iter()
            .all(|s| s.mask.as_ref().is_some_and(|m| m.iter().all(|&x| x == 0)))
    {
        let mut at = range.start_frame;
        while at < range.end_frame {
            let to = (at + chunk_frames).min(range.end_frame);
            emit(&audio.read(at, to)?)?;
            at = to;
        }
        return Ok(());
    }
    // Anchors must have wholly clean windows, including nearby OTHER ranges.
    let left_end = range.start_frame;
    let right_start = range.end_frame;
    let previous = merged
        .iter()
        .filter(|r| r.end_frame <= left_end)
        .map(|r| r.end_frame)
        .max()
        .unwrap_or(0);
    let next = merged
        .iter()
        .filter(|r| r.start_frame >= right_start)
        .map(|r| r.start_frame)
        .min()
        .unwrap_or(audio.frames);
    let left_valid = left_end - previous >= (n + hop) as u64;
    let right_valid = next - right_start >= (n + hop) as u64;
    if !left_valid && !right_valid {
        return Err("spectral_heal requires fft_size+hop clean context frames on at least one side; combine nearby selections or reduce fft_size".into());
    }
    // 下面的中心点都用绝对帧号；half 是半个窗长。
    let half = n as i64 / 2;
    let step = hop as i64;
    let base = range.start_frame as i64;
    let lc = base - half;
    let rc = range.end_frame as i64 + half;
    let (left_from, left_data) = read_window(audio, lc - step - half, lc + half)?;
    let (right_from, right_data) = read_window(audio, rc - half, rc + step + half)?;
    let anchors: Vec<_> = (0..c)
        .map(|channel| {
            let left = channel_of(&left_data, c, channel);
            let right = channel_of(&right_data, c, channel);
            [
                spectrum_at(fft, &left, lc - left_from),
                spectrum_at(fft, &left, lc - step - left_from),
                spectrum_at(fft, &right, rc - right_from),
                spectrum_at(fft, &right, rc + step - right_from),
            ]
        })
        .collect();
    // 第 k 个分析中心位于 base - half + k * hop。每块只算窗口覆盖本块输出的中心，并按 k 递增累加，
    // 所以分块结果与整段一次处理逐样本一致。
    let mut at = 0_u64;
    while at < len {
        let end = (at + chunk_frames).min(len);
        let k_begin = (at / hop as u64) as i64;
        let k_end = (end as i64 + n as i64).div_euclid(step) + 1;
        let (from, data) = read_window(audio, base + k_begin * step - n as i64, base + (k_end - 1) * step)?;
        let count = (end - at) as usize;
        let offset = (base + at as i64 - from) as usize;
        let mut output = data[offset * c..(offset + count) * c].to_vec();
        for (channel, [left, before, right, after]) in anchors.iter().enumerate() {
            let signal = channel_of(&data, c, channel);
            let mut delta = vec![0_f32; count];
            let mut norm = vec![0_f32; count];
            for k in k_begin..k_end {
                let relative = k * step - half;
                if relative >= len as i64 + half {
                    break;
                }
                let center = base + relative;
                let original = spectrum_at(fft, &signal, center - from);
                let mut difference = vec![Complex32::default(); n];
                for bin in 0..=n / 2 {
                    let weight = local
                        .iter()
                        .map(|s| s.weight(center, bin, n))
                        .fold(0_f32, f32::max)
                        * strength;
                    if weight == 0.0 {
                        continue;
                    }
                    let expected = TAU * bin as f64 / n as f64;
                    let wl = expected
                        + wrap(
                            (left[bin] * before[bin].conj()).arg() as f64 - expected * hop as f64,
                        ) / hop as f64;
                    let wr = expected
                        + wrap(
                            (after[bin] * right[bin].conj()).arg() as f64 - expected * hop as f64,
                        ) / hop as f64;
                    let t = ((center - lc) as f64 / (rc - lc) as f64).clamp(0.0, 1.0);
                    let (magnitude, phase) = if left_valid && right_valid {
                        let omega = (wl + wr) / 2.0;
                        let phase_error = wrap(
                            right[bin].arg() as f64
                                - left[bin].arg() as f64
                                - omega * (rc - lc) as f64,
                        );
                        (
                            (1.0 - t) * left[bin].norm() as f64 + t * right[bin].norm() as f64,
                            left[bin].arg() as f64
                                + omega * (center - lc) as f64
                                + phase_error * t,
                        )
                    } else if left_valid {
                        (
                            left[bin].norm() as f64,
                            left[bin].arg() as f64 + wl * (center - lc) as f64,
                        )
                    } else {
                        (
                            right[bin].norm() as f64,
                            right[bin].arg() as f64 + wr * (center - rc) as f64,
                        )
                    };
                    let mut replacement =
                        Complex32::from_polar(magnitude as f32, wrap(phase) as f32);
                    if bin == 0 || bin == n / 2 {
                        replacement.im = 0.0;
                    }
                    difference[bin] = (replacement - original[bin]) * weight;
                    if bin > 0 && bin < n / 2 {
                        difference[n - bin] = difference[bin].conj();
                    }
                }
                fft.inverse(&mut difference);
                for (j, value) in difference.iter().enumerate() {
                    let position = relative - half + j as i64 - at as i64;
                    if position >= 0 && (position as usize) < count {
                        let position = position as usize;
                        delta[position] += value.re * fft.window[j] / n as f32;
                        norm[position] += fft.window[j] * fft.window[j];
                    }
                }
            }
            for i in 0..count {
                let frame = range.start_frame + at + i as u64;
                let gate = local
                    .iter()
                    .map(|s| fade(frame, &s.region, hop))
                    .fold(0_f32, f32::max);
                if gate > 0.0 && norm[i] > 1e-10 {
                    output[i * c + channel] += delta[i] / norm[i] * gate;
                }
            }
        }
        emit(&output)?;
        at = end;
    }
    Ok(())
}
