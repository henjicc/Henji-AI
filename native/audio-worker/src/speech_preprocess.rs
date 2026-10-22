//! 移植自“说吧” src-tauri/src/audio_dsp.rs 的离线路径。
//! nnnoiseless（BSD-3-Clause）与 ebur128（MIT）；EQ 使用原项目 RBJ 搁架实现。
//! 输入为既有录音服务的有限大小单声道分块，原音不覆盖；补偿降噪一帧延迟。
use ebur128::{EbuR128, Mode};
use nnnoiseless::DenoiseState;
use serde::Deserialize;
use serde_json::{json, Value};
use std::{error::Error, path::PathBuf};
const FRAME: usize = 480;
const RATE: u32 = 48_000;
const EQ_BASS_FREQ: f32 = 150.0;
const EQ_TREBLE_FREQ: f32 = 4000.0;
const EQ_SHELF_Q: f32 = 0.707;

#[derive(Debug, Deserialize)]
pub struct Request { pub input_path: PathBuf, pub output_path: PathBuf }

#[derive(Clone, Copy)]
struct BiquadCoeffs {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
}

impl BiquadCoeffs {
    fn identity() -> Self {
        Self {
            b0: 1.0,
            b1: 0.0,
            b2: 0.0,
            a1: 0.0,
            a2: 0.0,
        }
    }

    /// RBJ Audio EQ Cookbook 低频搁架系数。
    fn low_shelf(rate: f32, freq: f32, gain_db: f32, q: f32) -> Self {
        if gain_db == 0.0 {
            return Self::identity();
        }
        let a = 10f32.powf(gain_db / 40.0);
        let w0 = 2.0 * std::f32::consts::PI * freq / rate;
        let (sin_w0, cos_w0) = w0.sin_cos();
        let alpha = sin_w0 / 2.0 * ((a + 1.0 / a) * (1.0 / q - 1.0) + 2.0).sqrt();
        let two_sqrt_a_alpha = 2.0 * a.sqrt() * alpha;
        let b0 = a * ((a + 1.0) - (a - 1.0) * cos_w0 + two_sqrt_a_alpha);
        let b1 = 2.0 * a * ((a - 1.0) - (a + 1.0) * cos_w0);
        let b2 = a * ((a + 1.0) - (a - 1.0) * cos_w0 - two_sqrt_a_alpha);
        let a0 = (a + 1.0) + (a - 1.0) * cos_w0 + two_sqrt_a_alpha;
        let a1 = -2.0 * ((a - 1.0) + (a + 1.0) * cos_w0);
        let a2 = (a + 1.0) + (a - 1.0) * cos_w0 - two_sqrt_a_alpha;
        Self {
            b0: b0 / a0,
            b1: b1 / a0,
            b2: b2 / a0,
            a1: a1 / a0,
            a2: a2 / a0,
        }
    }

    /// RBJ Audio EQ Cookbook 高频搁架系数。
    fn high_shelf(rate: f32, freq: f32, gain_db: f32, q: f32) -> Self {
        if gain_db == 0.0 {
            return Self::identity();
        }
        let a = 10f32.powf(gain_db / 40.0);
        let w0 = 2.0 * std::f32::consts::PI * freq / rate;
        let (sin_w0, cos_w0) = w0.sin_cos();
        let alpha = sin_w0 / 2.0 * ((a + 1.0 / a) * (1.0 / q - 1.0) + 2.0).sqrt();
        let two_sqrt_a_alpha = 2.0 * a.sqrt() * alpha;
        let b0 = a * ((a + 1.0) + (a - 1.0) * cos_w0 + two_sqrt_a_alpha);
        let b1 = -2.0 * a * ((a - 1.0) + (a + 1.0) * cos_w0);
        let b2 = a * ((a + 1.0) + (a - 1.0) * cos_w0 - two_sqrt_a_alpha);
        let a0 = (a + 1.0) - (a - 1.0) * cos_w0 + two_sqrt_a_alpha;
        let a1 = 2.0 * ((a - 1.0) - (a + 1.0) * cos_w0);
        let a2 = (a + 1.0) - (a - 1.0) * cos_w0 - two_sqrt_a_alpha;
        Self {
            b0: b0 / a0,
            b1: b1 / a0,
            b2: b2 / a0,
            a1: a1 / a0,
            a2: a2 / a0,
        }
    }
}

struct Biquad {
    c: BiquadCoeffs,
    x1: f32,
    x2: f32,
    y1: f32,
    y2: f32,
}

impl Biquad {
    fn new(c: BiquadCoeffs) -> Self {
        Self {
            c,
            x1: 0.0,
            x2: 0.0,
            y1: 0.0,
            y2: 0.0,
        }
    }

    #[inline]
    fn process(&mut self, x: f32) -> f32 {
        let c = self.c;
        let y = c.b0 * x + c.b1 * self.x1 + c.b2 * self.x2 - c.a1 * self.y1 - c.a2 * self.y2;
        self.x2 = self.x1;
        self.x1 = x;
        self.y2 = self.y1;
        self.y1 = y;
        y
    }
}

/// 简单两段搁架 EQ（低频 + 高频），对应设置里"调整高低频"的诉求。
/// 增益为 0 时对应恒等系数，`active` 直接跳过处理，零开销也不引入浮点误差。
struct ShelfEq {
    bass: Biquad,
    treble: Biquad,
    active: bool,
}

impl ShelfEq {
    fn new(rate: f32, bass_gain_db: f32, treble_gain_db: f32) -> Self {
        Self {
            bass: Biquad::new(BiquadCoeffs::low_shelf(
                rate,
                EQ_BASS_FREQ,
                bass_gain_db,
                EQ_SHELF_Q,
            )),
            treble: Biquad::new(BiquadCoeffs::high_shelf(
                rate,
                EQ_TREBLE_FREQ,
                treble_gain_db,
                EQ_SHELF_Q,
            )),
            active: bass_gain_db != 0.0 || treble_gain_db != 0.0,
        }
    }

    fn process_slice(&mut self, samples: &mut [f32]) {
        if !self.active {
            return;
        }
        for s in samples.iter_mut() {
            *s = self.treble.process(self.bass.process(*s));
        }
    }
}


fn loudness(samples: &[f32]) -> Result<f64, Box<dyn Error>> {
    let mut meter = EbuR128::new(1, RATE, Mode::I)?;
    meter.add_frames_f32(samples)?;
    Ok(meter.loudness_global()?)
}

fn denoise(input: &[f32]) -> Vec<f32> {
    let mut state = DenoiseState::new();
    let mut output = Vec::with_capacity(input.len() + FRAME);
    let mut source = [0.0; FRAME];
    let mut wet = [0.0; FRAME];
    // 多喂一帧零，移除首帧算法延迟，保留尾音与原始时间长度。
    for start in (0..input.len().div_ceil(FRAME) * FRAME + FRAME).step_by(FRAME) {
        for (j, sample) in source.iter_mut().enumerate() {
            *sample = input.get(start + j).copied().unwrap_or(0.0) * 32768.0;
        }
        state.process_frame(&mut wet, &source);
        if start > 0 { output.extend(wet.iter().map(|v| v / 32768.0)); }
    }
    output.truncate(input.len());
    output
}

fn process(input: &[f32], rate: u32, noise: bool) -> Result<Vec<f32>, Box<dyn Error>> {
    if rate == 0 || input.iter().any(|v| !v.is_finite()) { return Err("录音采样无效".into()); }
    if input.is_empty() { return Ok(Vec::new()); }
    let ratio = RATE as f64 / rate as f64;
    let length = (input.len() as f64 * ratio).round() as usize;
    let source: Vec<f32> = (0..length).map(|i| {
        let p = i as f64 / ratio; let a = p.floor() as usize;
        let x = input[a.min(input.len() - 1)];
        x + (input[(a + 1).min(input.len() - 1)] - x) * (p - a as f64) as f32
    }).collect();
    let mut wet = if noise { denoise(&source) } else { source };
    // 固定中性 EQ，不向用户暴露算法调节项，保持原离线处理顺序。
    ShelfEq::new(RATE as f32, 0.0, 0.0).process_slice(&mut wet);
    let measured = loudness(&wet)?;
    let gain = if measured.is_finite() && measured > -90.0 { 10f32.powf(((-20.0 - measured) as f32).min(40.0) / 20.0) } else { 1.0 };
    let limit = 10f32.powf(-1.0 / 20.0);
    wet.iter_mut().for_each(|v| *v = (*v * gain).clamp(-limit, limit));
    Ok(wet)
}

pub fn run(request: Request) -> Result<Value, Box<dyn Error>> {
    if request.input_path == request.output_path { return Err("预处理不能覆盖原录音".into()); }
    let mut reader = hound::WavReader::open(&request.input_path)?;
    let spec = reader.spec();
    // 与既有录音块容量契约一致；防止独立命令加载无界音频。
    if spec.channels != 1 || reader.duration() > 2 * 1024 * 1024 || !(8000..=192000).contains(&spec.sample_rate) {
        return Err("录音块声道、采样率或容量无效".into());
    }
    let samples: Vec<f32> = if spec.sample_format == hound::SampleFormat::Float {
        reader.samples::<f32>().collect::<Result<_, _>>()?
    } else {
        let scale = (1u64 << (spec.bits_per_sample - 1)) as f32;
        reader.samples::<i32>().map(|v| v.map(|s| s as f32 / scale)).collect::<Result<_, _>>()?
    };
    let output = process(&samples, spec.sample_rate, true)?;
    let mut writer = hound::WavWriter::create(&request.output_path, hound::WavSpec { channels: 1, sample_rate: RATE, bits_per_sample: 16, sample_format: hound::SampleFormat::Int })?;
    for sample in &output { writer.write_sample((sample * 32767.0).round() as i16)?; }
    writer.finalize()?;
    let measured = loudness(&output)?;
    Ok(json!({ "sampleRate": RATE, "frames": output.len(), "lufs": if measured.is_finite() { Some(measured) } else { None } }))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn voice() -> Vec<f32> { (0..RATE as usize * 3).map(|i| {
        let t = i as f32 / RATE as f32;
        (1..=12).map(|h| (std::f32::consts::TAU * 180.0 * h as f32 * t).sin() / h as f32).sum::<f32>() * 0.08
    }).collect() }
    #[test]
    fn normalization_reaches_target_and_keeps_time() {
        let signal = voice();
        let output = process(&signal, RATE, false).unwrap();
        assert_eq!(signal.len(), output.len());
        assert!((loudness(&output).unwrap() + 20.0).abs() < 1.0);
        let output = process(&signal, RATE, true).unwrap();
        assert_eq!(signal.len(), output.len());
        assert!((loudness(&output).unwrap() + 20.0).abs() < 1.0);
    }
    #[test]
    fn noise_reduction_improves_snr() {
        let clean = voice(); let mut seed = 42u32;
        let noisy: Vec<_> = clean.iter().map(|v| { seed = seed.wrapping_mul(1664525).wrapping_add(1013904223); v + (seed as f64 / u32::MAX as f64 - 0.5) as f32 * 0.09 }).collect();
        let output = denoise(&noisy);
        // 去除模型热身；比较对原始干净信号的误差，不以输出变安静冒充降噪。
        let error = |signal: &[f32]| clean.iter().zip(signal).skip(RATE as usize / 2).map(|(a,b)| (a-b).powi(2) as f64).sum::<f64>();
        let before = error(&noisy); let after = error(&output);
        assert!(after < before, "降噪前误差 {before}，降噪后 {after}");
    }
    #[test]
    fn silence_short_tail_and_resampling_are_finite() {
        for rate in [16000, 44100, 48000] {
            let output = process(&vec![0.0; 481], rate, true).unwrap();
            assert_eq!(output.len(), (481.0 * RATE as f64 / rate as f64).round() as usize);
            assert!(output.iter().all(|v| v.is_finite() && v.abs() < 1e-6));
        }
    }
}
