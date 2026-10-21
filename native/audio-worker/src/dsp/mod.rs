//! Native, file-based DSP. All frame ranges are half-open sample-frame indices,
//! never interleaved sample indices. Outputs must not exist (also protects input
//! aliases/hard links); a sibling temporary is published only after success.
mod audio;
mod heal;
mod lpc;
mod spectrum;

pub use heal::{declick, spectral_heal};
use serde::Deserialize;
pub use spectrum::spectrogram;
use std::{error::Error, path::PathBuf};
type Result<T> = std::result::Result<T, Box<dyn Error>>;

fn default_fft() -> usize {
    2048
}
fn full_strength() -> f32 {
    1.0
}

#[derive(Debug, Deserialize)]
pub struct SpectrogramRequest {
    pub input_path: PathBuf,
    pub output_path: PathBuf,
    #[serde(default = "default_fft")]
    pub fft_size: usize,
    pub hop: Option<usize>,
    pub channel: Option<usize>,
    pub start_frame: Option<u64>,
    pub end_frame: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Region {
    pub start_frame: u64,
    pub end_frame: u64,
    pub low_hz: f64,
    pub high_hz: f64,
    pub mask_path: Option<PathBuf>,
}

#[derive(Debug, Deserialize)]
pub struct HealRequest {
    pub input_path: PathBuf,
    pub output_path: PathBuf,
    /// Optional assertion, not a resampling request.
    pub sample_rate: Option<u32>,
    pub regions: Vec<Region>,
    #[serde(default = "full_strength")]
    pub strength: f32,
    #[serde(default = "default_fft")]
    pub fft_size: usize,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TimeRange {
    pub start_frame: u64,
    pub end_frame: u64,
}

#[derive(Debug, Deserialize)]
pub struct DeclickRequest {
    pub input_path: PathBuf,
    pub output_path: PathBuf,
    pub ranges: Vec<TimeRange>,
}

fn validate_fft(n: usize) -> Result<()> {
    if !(64..=16384).contains(&n) || !n.is_power_of_two() {
        return Err("fft_size must be a power of two in 64..=16384".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests;
