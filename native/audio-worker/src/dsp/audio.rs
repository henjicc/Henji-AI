use super::Result;
use hound::{SampleFormat, WavReader, WavSpec, WavWriter};
use std::{fs::File, io::BufReader, path::Path};
use tempfile::NamedTempFile;

pub struct Audio {
    pub reader: WavReader<BufReader<File>>,
    pub spec: WavSpec,
    pub frames: u64,
}

impl Audio {
    pub fn open(path: &Path) -> Result<Self> {
        let reader = WavReader::open(path)?;
        let spec = reader.spec();
        if spec.channels == 0 || spec.sample_rate == 0 {
            return Err("WAV must have channels and a nonzero sample rate".into());
        }
        if !matches!(
            (spec.sample_format, spec.bits_per_sample),
            (SampleFormat::Int, 16 | 24 | 32) | (SampleFormat::Float, 32)
        ) {
            return Err("supported WAV formats: PCM16/24/32 or float32".into());
        }
        if reader.len() % u32::from(spec.channels) != 0 {
            return Err("WAV contains an incomplete sample frame".into());
        }
        let frames = u64::from(reader.duration());
        Ok(Self {
            reader,
            spec,
            frames,
        })
    }

    pub fn seek(&mut self, frame: u64) -> Result<()> {
        self.reader.seek(u32::try_from(frame)?)?;
        Ok(())
    }

    pub fn samples(&mut self) -> Box<dyn Iterator<Item = Result<f32>> + '_> {
        let scale = 2_f32.powi(i32::from(self.spec.bits_per_sample) - 1);
        let iter: Box<dyn Iterator<Item = std::result::Result<f32, hound::Error>> + '_> =
            if self.spec.sample_format == SampleFormat::Float {
                Box::new(self.reader.samples::<f32>())
            } else {
                Box::new(
                    self.reader
                        .samples::<i32>()
                        .map(move |s| s.map(|x| x as f32 / scale)),
                )
            };
        Box::new(iter.map(|s| {
            let x = s?;
            if !x.is_finite() {
                return Err("WAV contains non-finite samples".into());
            }
            Ok(x)
        }))
    }

    pub fn read(&mut self, start: u64, end: u64) -> Result<Vec<f32>> {
        self.seek(start)?;
        let count = (end - start) as usize * usize::from(self.spec.channels);
        let data = self.samples().take(count).collect::<Result<Vec<_>>>()?;
        if data.len() != count {
            return Err("unexpected end of WAV".into());
        }
        Ok(data)
    }
}

pub fn validate_range(start: u64, end: u64, frames: u64) -> Result<()> {
    if start >= end || end > frames {
        return Err(format!("range must satisfy 0 <= start_frame < end_frame <= {frames}").into());
    }
    Ok(())
}

pub fn temporary(output: &Path) -> Result<NamedTempFile> {
    if output.try_exists()? {
        return Err("output_path already exists; use a new output path".into());
    }
    let parent = output
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    Ok(tempfile::Builder::new()
        .prefix(".henji-audio-")
        .tempfile_in(parent)?)
}

pub fn publish(temp: NamedTempFile, output: &Path) -> Result<u64> {
    temp.as_file().sync_all()?;
    let bytes = temp.as_file().metadata()?.len();
    temp.persist_noclobber(output)?;
    Ok(bytes)
}

/// Copy untouched intervals without any DSP round trip. PCM32 is normalized to
/// f32, hence its least significant bits can round; float32/PCM16/24 are exact.
pub fn copy_to<W: std::io::Write + std::io::Seek>(
    audio: &mut Audio,
    writer: &mut WavWriter<W>,
    start: u64,
    end: u64,
) -> Result<()> {
    audio.seek(start)?;
    let count = (end - start) * u64::from(audio.spec.channels);
    let mut samples = audio.samples();
    for _ in 0..count {
        writer.write_sample(samples.next().ok_or("unexpected end of WAV")??)?;
    }
    Ok(())
}
