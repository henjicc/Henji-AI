use super::{Audio, Result};
use std::{
    fs::File,
    io::{BufReader, Read},
};

enum Source {
    Float(BufReader<File>),
    Pcm16(BufReader<File>),
    Other(Audio),
}
pub struct Stream {
    source: Source,
    bytes: Vec<u8>,
    first: Option<f32>,
}
impl Stream {
    pub fn new(mut audio: Audio) -> Result<Self> {
        // hound 仍负责 WAV/扩展头解析。正式解码缓存为 float32，整块读取后直接解码，
        // 避免每个样本穿过动态迭代器和数次 read 调用；PCM24/32 继续复用成熟读取器。
        let mut first = None;
        let source = if audio.spec.sample_format == hound::SampleFormat::Float {
            first = audio.reader.samples::<f32>().next().transpose()?;
            Source::Float(audio.reader.into_inner())
        } else if audio.spec.bits_per_sample == 16 {
            // 先由 hound 校验一个样本，拒绝不受支持的容器位宽，再批量解码 PCM16。
            first = audio
                .reader
                .samples::<i16>()
                .next()
                .transpose()?
                .map(|v| v as f32 / 32768.0);
            Source::Pcm16(audio.reader.into_inner())
        } else {
            Source::Other(audio)
        };
        if first.is_some_and(|v| !v.is_finite()) {
            return Err("WAV 含非有限采样值".into());
        }
        Ok(Self {
            source,
            bytes: Vec::new(),
            first,
        })
    }
    pub fn append(&mut self, mut count: usize, output: &mut Vec<f32>) -> Result<()> {
        if count > 0 {
            if let Some(value) = self.first.take() {
                output.push(value);
                count -= 1;
            }
        }
        match &mut self.source {
            Source::Float(reader) => {
                self.bytes.resize(count * 4, 0);
                reader.read_exact(&mut self.bytes)?;
                output.reserve(count);
                for sample in self.bytes.chunks_exact(4) {
                    let value = f32::from_le_bytes(sample.try_into().unwrap());
                    if !value.is_finite() {
                        return Err("WAV 含非有限采样值".into());
                    }
                    output.push(value);
                }
            }
            Source::Pcm16(reader) => {
                self.bytes.resize(count * 2, 0);
                reader.read_exact(&mut self.bytes)?;
                output.reserve(count);
                output.extend(
                    self.bytes.chunks_exact(2).map(|sample| {
                        i16::from_le_bytes(sample.try_into().unwrap()) as f32 / 32768.0
                    }),
                );
            }
            Source::Other(audio) => {
                let mut samples = audio.samples();
                for _ in 0..count {
                    output.push(samples.next().ok_or("WAV 提前结束")??);
                }
            }
        }
        Ok(())
    }
}
