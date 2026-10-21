use super::{
    audio::{self, Audio},
    lpc,
    spectrum::Transform,
    validate_fft, DeclickRequest, HealRequest, Region, Result, TimeRange,
};
use hound::{SampleFormat, WavSpec, WavWriter};
use rustfft::num_complex::Complex32;
use serde_json::{json, Value};
use std::{
    f64::consts::{PI, TAU},
    fs::File,
    io::{BufWriter, Read},
    path::Path,
    time::Instant,
};

// Bound only local working sets, not recording duration. Groups overlapping in
// time are solved together against original context (order independent).
const MAX_GROUP_SAMPLES: u64 = 16_000_000;
const MAX_MASK_BYTES: u64 = 64 * 1024 * 1024;

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
    fn new(region: Region, audio: &Audio, n: usize, mask_budget: &mut u64) -> Result<Self> {
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
        let width = (region.end_frame - region.start_frame).div_ceil((n / 4) as u64) as usize;
        let height = high - low + 1;
        let mask = if let Some(path) = &region.mask_path {
            let mut file = File::open(path)?;
            let expected = (width as u64) * (height as u64);
            if expected > *mask_budget {
                return Err("combined masks exceed 64 MiB; split the selection".into());
            }
            *mask_budget -= expected;
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
        let x = ((center - self.region.start_frame as i64).max(0) as usize / (n / 4))
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

fn render(
    input_path: &Path,
    output_path: &Path,
    ranges: &[TimeRange],
    margin: u64,
    mut repair: impl FnMut(&[f32], usize, usize, usize, usize, &TimeRange) -> Result<Vec<f32>>,
) -> Result<(u64, u32, u16, u64)> {
    let mut audio = Audio::open(input_path)?;
    let channels = usize::from(audio.spec.channels);
    if audio.frames * channels as u64 * 4 + 68 > u32::MAX as u64 {
        return Err("float32 output exceeds WAV RIFF 4 GiB limit; split the input".into());
    }
    // Check all working sets before allocating or writing any output.
    for range in ranges {
        if (range.end_frame - range.start_frame + 2 * margin) * channels as u64 > MAX_GROUP_SAMPLES
        {
            return Err("repair context exceeds 16000000 samples; split the selection".into());
        }
    }
    let mut temp = audio::temporary(output_path)?;
    let spec = WavSpec {
        sample_format: SampleFormat::Float,
        bits_per_sample: 32,
        ..audio.spec
    };
    let mut writer = WavWriter::new(BufWriter::new(temp.as_file_mut()), spec)?;
    let mut cursor = 0;
    for range in ranges {
        audio::copy_to(&mut audio, &mut writer, cursor, range.start_frame)?;
        let from = range.start_frame.saturating_sub(margin);
        let to = (range.end_frame + margin).min(audio.frames);
        let block = audio.read(from, to)?;
        let start = (range.start_frame - from) as usize;
        let length = (range.end_frame - range.start_frame) as usize;
        let repaired = repair(&block, channels, start, length, from as usize, range)?;
        if repaired.len() != length * channels {
            return Err("internal repair length mismatch".into());
        }
        for x in repaired {
            if !x.is_finite() {
                return Err("repair produced a non-finite sample".into());
            }
            writer.write_sample(x)?;
        }
        cursor = range.end_frame;
    }
    let end = audio.frames;
    audio::copy_to(&mut audio, &mut writer, cursor, end)?;
    writer.finalize()?;
    let bytes = audio::publish(temp, output_path)?;
    Ok((
        audio.frames,
        audio.spec.sample_rate,
        audio.spec.channels,
        bytes,
    ))
}

pub fn declick(req: DeclickRequest) -> Result<Value> {
    let began = Instant::now();
    let audio = Audio::open(&req.input_path)?;
    if req.ranges.len() > 4096 {
        return Err("at most 4096 ranges per command".into());
    }
    for r in &req.ranges {
        audio::validate_range(r.start_frame, r.end_frame, audio.frames)?;
    }
    let merged = groups(req.ranges.iter().cloned());
    let limit = u64::from(audio.spec.sample_rate) * 128 / 1000;
    for r in &merged {
        if r.end_frame - r.start_frame > limit {
            return Err(format!("declick selection (including overlapping/adjacent ranges) exceeds 128 ms ({limit} frames at {} Hz)",audio.spec.sample_rate).into());
        }
        if r.start_frame < 32 || audio.frames - r.end_frame < 32 {
            return Err("declick requires at least 32 clean context frames on each side".into());
        }
    }
    let margin = (limit * 4).clamp(512, 8192);
    let (frames, sr, channels, bytes) = render(
        &req.input_path,
        &req.output_path,
        &merged,
        margin,
        |block, c, start, len, from, range| {
            // Stop training before other requested ranges, not merely the current one.
            let left_bound = merged
                .iter()
                .filter(|r| r.end_frame <= range.start_frame)
                .map(|r| r.end_frame)
                .max()
                .unwrap_or(0)
                .saturating_sub(from as u64) as usize;
            let right_bound = merged
                .iter()
                .filter(|r| r.start_frame >= range.end_frame)
                .map(|r| r.start_frame)
                .min()
                .unwrap_or(audio.frames)
                .saturating_sub(from as u64)
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
            Ok(output)
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
    let hop = n / 4;
    let mut mask_budget = MAX_MASK_BYTES;
    let selections = req
        .regions
        .into_iter()
        .map(|r| Selection::new(r, &audio, n, &mut mask_budget))
        .collect::<Result<Vec<_>>>()?;
    let merged = groups(selections.iter().map(|s| TimeRange {
        start_frame: s.region.start_frame,
        end_frame: s.region.end_frame,
    }));
    let mut fft = Transform::new(n);
    let (frames, sr, channels, bytes) = render(
        &req.input_path,
        &req.output_path,
        &merged,
        (n * 3) as u64,
        |block, c, start, len, from, range| {
            let local: Vec<_> = selections
                .iter()
                .filter(|s| {
                    s.region.start_frame < range.end_frame && s.region.end_frame > range.start_frame
                })
                .collect();
            let mut output = block[start * c..(start + len) * c].to_vec();
            if req.strength == 0.0
                || local
                    .iter()
                    .all(|s| s.mask.as_ref().is_some_and(|m| m.iter().all(|&x| x == 0)))
            {
                return Ok(output);
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
            let lc = start as i64 - n as i64 / 2;
            let rc = (start + len) as i64 + n as i64 / 2;
            for channel in 0..c {
                let signal: Vec<_> = block.chunks_exact(c).map(|s| s[channel]).collect();
                let left = spectrum_at(&mut fft, &signal, lc);
                let before = spectrum_at(&mut fft, &signal, lc - hop as i64);
                let right = spectrum_at(&mut fft, &signal, rc);
                let after = spectrum_at(&mut fft, &signal, rc + hop as i64);
                let mut delta = vec![0_f32; len];
                let mut norm = vec![0_f32; len];
                let first = start as i64 - n as i64 / 2;
                let last = (start + len) as i64 + n as i64 / 2;
                for center in (first..last).step_by(hop) {
                    let original = spectrum_at(&mut fft, &signal, center);
                    let mut difference = vec![Complex32::default(); n];
                    for k in 0..=n / 2 {
                        let weight = local
                            .iter()
                            .map(|s| s.weight(center + from as i64, k, n))
                            .fold(0_f32, f32::max)
                            * req.strength;
                        if weight == 0.0 {
                            continue;
                        }
                        let expected = TAU * k as f64 / n as f64;
                        let wl = expected
                            + wrap(
                                (left[k] * before[k].conj()).arg() as f64 - expected * hop as f64,
                            ) / hop as f64;
                        let wr = expected
                            + wrap(
                                (after[k] * right[k].conj()).arg() as f64 - expected * hop as f64,
                            ) / hop as f64;
                        let t = ((center - lc) as f64 / (rc - lc) as f64).clamp(0.0, 1.0);
                        let (magnitude, phase) = if left_valid && right_valid {
                            let omega = (wl + wr) / 2.0;
                            let phase_error = wrap(
                                right[k].arg() as f64
                                    - left[k].arg() as f64
                                    - omega * (rc - lc) as f64,
                            );
                            (
                                (1.0 - t) * left[k].norm() as f64 + t * right[k].norm() as f64,
                                left[k].arg() as f64
                                    + omega * (center - lc) as f64
                                    + phase_error * t,
                            )
                        } else if left_valid {
                            (
                                left[k].norm() as f64,
                                left[k].arg() as f64 + wl * (center - lc) as f64,
                            )
                        } else {
                            (
                                right[k].norm() as f64,
                                right[k].arg() as f64 + wr * (center - rc) as f64,
                            )
                        };
                        let mut replacement =
                            Complex32::from_polar(magnitude as f32, wrap(phase) as f32);
                        if k == 0 || k == n / 2 {
                            replacement.im = 0.0;
                        }
                        difference[k] = (replacement - original[k]) * weight;
                        if k > 0 && k < n / 2 {
                            difference[n - k] = difference[k].conj();
                        }
                    }
                    fft.inverse(&mut difference);
                    for (j, value) in difference.iter().enumerate() {
                        let pos = center - n as i64 / 2 + j as i64 - start as i64;
                        if pos >= 0 && (pos as usize) < len {
                            let pos = pos as usize;
                            delta[pos] += value.re * fft.window[j] / n as f32;
                            norm[pos] += fft.window[j] * fft.window[j];
                        }
                    }
                }
                for i in 0..len {
                    let gate = local
                        .iter()
                        .map(|s| fade(range.start_frame + i as u64, &s.region, hop))
                        .fold(0_f32, f32::max);
                    if gate > 0.0 && norm[i] > 1e-10 {
                        output[i * c + channel] += delta[i] / norm[i] * gate;
                    }
                }
            }
            Ok(output)
        },
    )?;
    Ok(
        json!({"outputPath":req.output_path,"sampleRate":sr,"channels":channels,"frames":frames,"sampleFormat":"float32","processedRegions":selections.len(),"mergedRanges":merged.len(),"fftSize":n,"hop":hop,"strength":req.strength,"bytes":bytes,"elapsedMs":began.elapsed().as_secs_f64()*1000.0}),
    )
}
