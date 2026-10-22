use rayon::prelude::*;
use realfft::{num_complex::Complex32, RealFftPlanner, RealToComplex};
use std::{
    cell::RefCell,
    f32::consts::TAU,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, OnceLock,
    },
};

struct Plan {
    fft: Arc<dyn RealToComplex<f32>>,
    window: Vec<f32>,
}
fn plans() -> &'static [Plan; 2] {
    static PLANS: OnceLock<[Plan; 2]> = OnceLock::new();
    PLANS.get_or_init(|| {
        let mut planner = RealFftPlanner::new();
        [8192, 2048].map(|n| Plan {
            fft: planner.plan_fft_forward(n),
            window: (0..n)
                .map(|i| 0.5 - 0.5 * (TAU * i as f32 / n as f32).cos())
                .collect(),
        })
    })
}
struct Scratch {
    input: Vec<f32>,
    output: Vec<Complex32>,
    scratch: Vec<Complex32>,
    power: Vec<f32>,
}
thread_local! {
    // 每个 Rayon 线程复用输入、输出、FFT 工作区，不按列分配。
    static SCRATCH: RefCell<Scratch> = RefCell::new(Scratch {
        input: vec![0.0;8192], output: vec![Complex32::default();4097],
        scratch: vec![Complex32::default();plans().iter().map(|p| p.fft.get_scratch_len()).max().unwrap()],
        power: Vec::new(),
    });
}

#[derive(Clone, Default, Debug)]
pub struct Bin {
    pub peak: f32,
    pub sum: f64,
}
#[derive(Clone, Debug)]
pub struct Column {
    pub bins: Vec<Bin>,
    pub count: u64,
}
impl Column {
    pub fn merge(&mut self, other: &Self) {
        self.count += other.count;
        for (a, b) in self.bins.iter_mut().zip(&other.bins) {
            a.peak = a.peak.max(b.peak);
            a.sum += b.sum;
        }
    }
    pub fn encode(&self, output: &mut Vec<u8>) {
        for bin in &self.bins {
            output.push(quantize(bin.peak as f64));
            output.push(quantize(bin.sum / self.count as f64));
        }
    }
}
pub fn quantize(power: f64) -> u8 {
    ((10.0 * power.max(1e-12).log10() + 120.0) * (255.0 / 120.0))
        .clamp(0.0, 255.0)
        .round() as u8
}

/// 音频块以全局采样帧标识；外侧仅在真正文件边界补零。
pub struct Samples {
    pub data: Vec<f32>,
    pub start: u64,
    pub channels: usize,
}
impl Scratch {
    fn transform(&mut self, audio: &Samples, center: u64, channel: usize, low_bins: usize) {
        self.power.resize(low_bins + 1025, 0.0);
        for (index, plan) in plans().iter().enumerate() {
            let n = plan.window.len();
            let begin = center as i64 - n as i64 / 2 - audio.start as i64;
            for (i, value) in self.input[..n].iter_mut().enumerate() {
                let frame = begin + i as i64;
                *value = if frame < 0 {
                    0.0
                } else {
                    audio
                        .data
                        .get(frame as usize * audio.channels + channel)
                        .copied()
                        .unwrap_or(0.0)
                        * plan.window[i]
                };
            }
            plan.fft
                .process_with_scratch(
                    &mut self.input[..n],
                    &mut self.output[..n / 2 + 1],
                    &mut self.scratch,
                )
                .expect("固定 FFT 缓冲区长度");
            let (offset, bins) = if index == 0 {
                (0, low_bins)
            } else {
                (low_bins, 1025)
            };
            for k in 0..bins {
                // 低采样率下契约仍保留 lowBins；奈奎斯特外的频点无可表示能量。
                let factor = if k == 0 || k == n / 2 {
                    2.0 / n as f32
                } else {
                    4.0 / n as f32
                };
                self.power[offset + k] = if k > n / 2 {
                    0.0
                } else {
                    self.output[k].norm_sqr() * factor * factor
                };
            }
        }
    }
}

/// 输出以列为单位，列内为 [声道][频点]；只在最终 IPC 读回时转成声道平面。
pub fn columns(
    audio: &Samples,
    low_bins: usize,
    first: u64,
    count: usize,
    level: i32,
    base_count: u64,
    cancelled: &AtomicBool,
) -> Result<Vec<Column>, String> {
    let group = 1_u64 << level.max(0);
    let hop = if level < 0 { 512 >> -level } else { 512 };
    let bins = low_bins + 1025;
    (0..count)
        .into_par_iter()
        .map(|i| {
            if cancelled.load(Ordering::Relaxed) {
                return Err("频谱计算已取消".into());
            }
            let column = first + i as u64;
            let begin = column * group;
            let end = if level < 0 {
                begin + 1
            } else {
                ((column + 1) * group).min(base_count)
            };
            let mut result = Column {
                bins: vec![Bin::default(); bins * audio.channels],
                count: end - begin,
            };
            SCRATCH.with_borrow_mut(|scratch| {
                for base in begin..end {
                    for channel in 0..audio.channels {
                        scratch.transform(audio, base * hop, channel, low_bins);
                        for (bin, power) in result.bins[channel * bins..(channel + 1) * bins]
                            .iter_mut()
                            .zip(&scratch.power)
                        {
                            bin.peak = bin.peak.max(*power);
                            bin.sum += *power as f64;
                        }
                    }
                }
            });
            Ok(result)
        })
        .collect()
}
