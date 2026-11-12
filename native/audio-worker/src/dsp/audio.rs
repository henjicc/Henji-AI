use super::Result;
use hound::{SampleFormat, WavSpec};
use std::{
    fs::File,
    io::{BufReader, BufWriter, Read, Seek, SeekFrom, Write},
    path::Path,
};
use tempfile::NamedTempFile;

/// WAV 读取（RIFF 与超过 4 GiB 的 RF64/BW64）。hound 只认 32 位长度的 RIFF，
/// 长素材转出的浮点缓存超过 4 GiB 时是 RF64，这里统一自行解析头部并按块解码。
pub struct Audio {
    reader: BufReader<File>,
    pub spec: WavSpec,
    pub frames: u64,
    data_offset: u64,
    /// 下一次读取的位置（交错样本序号）。
    position: u64,
    bytes: Vec<u8>,
}

const WAVE_FORMAT_PCM: u16 = 1;
const WAVE_FORMAT_IEEE_FLOAT: u16 = 3;
const WAVE_FORMAT_EXTENSIBLE: u16 = 0xfffe;
/// 顺序读写每次搬运的样本数，内存与素材长度无关。
const COPY_SAMPLES: usize = 1 << 20;

fn u16_at(bytes: &[u8], offset: usize) -> u16 {
    u16::from_le_bytes([bytes[offset], bytes[offset + 1]])
}
fn u32_at(bytes: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap())
}
fn u64_at(bytes: &[u8], offset: usize) -> u64 {
    u64::from_le_bytes(bytes[offset..offset + 8].try_into().unwrap())
}

impl Audio {
    pub fn open(path: &Path) -> Result<Self> {
        let file = File::open(path)?;
        let file_len = file.metadata()?.len();
        let mut reader = BufReader::new(file);
        let mut head = [0_u8; 12];
        reader
            .read_exact(&mut head)
            .map_err(|_| "not a WAV file")?;
        let large = match &head[..4] {
            b"RIFF" => false,
            b"RF64" | b"BW64" => true,
            _ => return Err("not a WAV file".into()),
        };
        if &head[8..12] != b"WAVE" {
            return Err("not a WAV file".into());
        }
        let mut ds64_data = None;
        let mut format = None;
        let mut position = 12_u64;
        let (data_offset, data_bytes) = loop {
            let mut chunk = [0_u8; 8];
            reader
                .read_exact(&mut chunk)
                .map_err(|_| "WAV has no data chunk")?;
            let size = u32_at(&chunk, 4);
            let body = position + 8;
            match &chunk[..4] {
                b"ds64" => {
                    let mut value = [0_u8; 24];
                    reader.read_exact(&mut value)?;
                    ds64_data = Some(u64_at(&value, 8));
                }
                b"fmt " => {
                    if size < 16 {
                        return Err("WAV fmt chunk is too short".into());
                    }
                    let mut value = vec![0_u8; size.min(40) as usize];
                    reader.read_exact(&mut value)?;
                    let mut tag = u16_at(&value, 0);
                    if tag == WAVE_FORMAT_EXTENSIBLE && value.len() >= 26 {
                        tag = u16_at(&value, 24);
                    }
                    format = Some((tag, u16_at(&value, 2), u32_at(&value, 4), u16_at(&value, 12), u16_at(&value, 14)));
                }
                b"data" => {
                    let declared = match (large, ds64_data) {
                        (true, Some(bytes)) if size == u32::MAX => bytes,
                        _ => u64::from(size),
                    };
                    break (body, declared.min(file_len.saturating_sub(body)));
                }
                _ => {}
            }
            position = body + u64::from(size) + u64::from(size & 1);
            reader.seek(SeekFrom::Start(position))?;
        };
        let (tag, channels, sample_rate, block_align, bits) = format.ok_or("WAV has no fmt chunk")?;
        if channels == 0 || sample_rate == 0 {
            return Err("WAV must have channels and a nonzero sample rate".into());
        }
        let sample_format = match tag {
            WAVE_FORMAT_PCM => SampleFormat::Int,
            WAVE_FORMAT_IEEE_FLOAT => SampleFormat::Float,
            _ => return Err("supported WAV formats: PCM16/24/32 or float32".into()),
        };
        if !matches!((sample_format, bits), (SampleFormat::Int, 16 | 24 | 32) | (SampleFormat::Float, 32))
            || u32::from(block_align) != u32::from(channels) * u32::from(bits / 8)
        {
            return Err("supported WAV formats: PCM16/24/32 or float32".into());
        }
        if data_bytes % u64::from(block_align) != 0 {
            return Err("WAV contains an incomplete sample frame".into());
        }
        reader.seek(SeekFrom::Start(data_offset))?;
        Ok(Self {
            reader,
            spec: WavSpec { channels, sample_rate, bits_per_sample: bits, sample_format },
            frames: data_bytes / u64::from(block_align),
            data_offset,
            position: 0,
            bytes: Vec::new(),
        })
    }

    fn bytes_per_sample(&self) -> u64 {
        u64::from(self.spec.bits_per_sample / 8)
    }

    pub fn seek(&mut self, frame: u64) -> Result<()> {
        if frame > self.frames {
            return Err("seek beyond end of WAV".into());
        }
        self.position = frame * u64::from(self.spec.channels);
        self.reader
            .seek(SeekFrom::Start(self.data_offset + self.position * self.bytes_per_sample()))?;
        Ok(())
    }

    /// 从当前位置按块解码 count 个交错样本追加到 output；浮点样本必须有限。
    pub fn append(&mut self, count: usize, output: &mut Vec<f32>) -> Result<()> {
        let total = self.frames * u64::from(self.spec.channels);
        if self.position + count as u64 > total {
            return Err("unexpected end of WAV".into());
        }
        let width = self.bytes_per_sample() as usize;
        self.bytes.resize(count * width, 0);
        self.reader.read_exact(&mut self.bytes)?;
        self.position += count as u64;
        output.reserve(count);
        match (self.spec.sample_format, width) {
            (SampleFormat::Float, _) => {
                for sample in self.bytes.chunks_exact(4) {
                    let value = f32::from_le_bytes(sample.try_into().unwrap());
                    if !value.is_finite() {
                        return Err("WAV contains non-finite samples".into());
                    }
                    output.push(value);
                }
            }
            (_, 2) => output.extend(
                self.bytes
                    .chunks_exact(2)
                    .map(|s| i16::from_le_bytes([s[0], s[1]]) as f32 / 32768.0),
            ),
            (_, 3) => output.extend(self.bytes.chunks_exact(3).map(|s| {
                (i32::from_le_bytes([0, s[0], s[1], s[2]]) >> 8) as f32 / 8_388_608.0
            })),
            _ => output.extend(
                self.bytes
                    .chunks_exact(4)
                    .map(|s| i32::from_le_bytes(s.try_into().unwrap()) as f32 / 2_147_483_648.0),
            ),
        }
        Ok(())
    }

    /// 从当前位置到末尾逐个样本读取（内部按块解码）。
    pub fn samples(&mut self) -> Box<dyn Iterator<Item = Result<f32>> + '_> {
        let mut buffer = Vec::new();
        let mut index = 0;
        Box::new(std::iter::from_fn(move || {
            if index == buffer.len() {
                let left = self.frames * u64::from(self.spec.channels) - self.position;
                if left == 0 {
                    return None;
                }
                buffer.clear();
                index = 0;
                if let Err(error) = self.append(left.min(COPY_SAMPLES as u64) as usize, &mut buffer) {
                    return Some(Err(error));
                }
            }
            index += 1;
            Some(Ok(buffer[index - 1]))
        }))
    }

    pub fn read(&mut self, start: u64, end: u64) -> Result<Vec<f32>> {
        self.seek(start)?;
        let mut data = Vec::new();
        self.append((end - start) as usize * usize::from(self.spec.channels), &mut data)?;
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
    // 几 GB 的输出在慢盘上刷盘可能很久：期间持续续期，不让主进程按无进展超时误杀。
    let finished = std::sync::atomic::AtomicBool::new(false);
    std::thread::scope(|scope| -> Result<()> {
        let beat = scope.spawn(|| {
            while !finished.load(std::sync::atomic::Ordering::Relaxed) {
                crate::progress::alive();
                std::thread::park_timeout(std::time::Duration::from_secs(1));
            }
        });
        let synced = temp.as_file().sync_all();
        finished.store(true, std::sync::atomic::Ordering::Relaxed);
        beat.thread().unpark();
        Ok(synced?)
    })?;
    crate::progress::alive();
    let bytes = temp.as_file().metadata()?.len();
    temp.persist_noclobber(output)?;
    Ok(bytes)
}

/// 32 位浮点 WAV 写出，与 FFmpeg `-rf64 auto` 相同的布局：头部预留 28 字节 JUNK，
/// 结束时总长不超过 4 GiB 写普通 RIFF，超过则把 JUNK 改成 ds64 并升级为 RF64。
pub struct F32Writer<W: Write + Seek> {
    output: BufWriter<W>,
    channels: u16,
    data_bytes: u64,
}
const JUNK_BYTES: u64 = 28;
const FMT_BYTES: u64 = 18;
const DATA_SIZE_OFFSET: u64 = 12 + 8 + JUNK_BYTES + 8 + FMT_BYTES + 4;

impl<W: Write + Seek> F32Writer<W> {
    pub fn new(output: W, channels: u16, sample_rate: u32) -> Result<Self> {
        let mut output = BufWriter::new(output);
        let block = u32::from(channels) * 4;
        output.write_all(b"RIFF\0\0\0\0WAVEJUNK")?;
        output.write_all(&(JUNK_BYTES as u32).to_le_bytes())?;
        output.write_all(&[0; JUNK_BYTES as usize])?;
        output.write_all(b"fmt ")?;
        output.write_all(&(FMT_BYTES as u32).to_le_bytes())?;
        output.write_all(&WAVE_FORMAT_IEEE_FLOAT.to_le_bytes())?;
        output.write_all(&channels.to_le_bytes())?;
        output.write_all(&sample_rate.to_le_bytes())?;
        output.write_all(&(sample_rate * block).to_le_bytes())?;
        output.write_all(&(block as u16).to_le_bytes())?;
        output.write_all(&32_u16.to_le_bytes())?;
        output.write_all(&0_u16.to_le_bytes())?;
        output.write_all(b"data\0\0\0\0")?;
        Ok(Self { output, channels, data_bytes: 0 })
    }

    pub fn write_samples(&mut self, samples: &[f32]) -> Result<()> {
        for &sample in samples {
            self.output.write_all(&sample.to_le_bytes())?;
        }
        self.data_bytes += samples.len() as u64 * 4;
        Ok(())
    }

    pub fn finalize(self) -> Result<()> {
        self.finalize_with_limit(u64::from(u32::MAX))
    }

    /// limit 是普通 RIFF 允许的最大长度字段；测试用很小的值验证 RF64 分支。
    pub(crate) fn finalize_with_limit(mut self, limit: u64) -> Result<()> {
        let riff_bytes = DATA_SIZE_OFFSET + self.data_bytes - 8;
        let output = &mut self.output;
        if riff_bytes <= limit && self.data_bytes <= limit {
            output.seek(SeekFrom::Start(4))?;
            output.write_all(&(riff_bytes as u32).to_le_bytes())?;
            output.seek(SeekFrom::Start(DATA_SIZE_OFFSET))?;
            output.write_all(&(self.data_bytes as u32).to_le_bytes())?;
        } else {
            let frames = self.data_bytes / (u64::from(self.channels) * 4);
            output.seek(SeekFrom::Start(0))?;
            output.write_all(b"RF64")?;
            output.write_all(&u32::MAX.to_le_bytes())?;
            output.seek(SeekFrom::Start(12))?;
            output.write_all(b"ds64")?;
            output.write_all(&(JUNK_BYTES as u32).to_le_bytes())?;
            output.write_all(&riff_bytes.to_le_bytes())?;
            output.write_all(&self.data_bytes.to_le_bytes())?;
            output.write_all(&frames.to_le_bytes())?;
            output.write_all(&0_u32.to_le_bytes())?;
            output.seek(SeekFrom::Start(DATA_SIZE_OFFSET))?;
            output.write_all(&u32::MAX.to_le_bytes())?;
        }
        output.flush()?;
        Ok(())
    }
}

/// 原样复制未处理的区间，不经过任何 DSP；PCM32 归一化为 f32 时最低位可能舍入，float32/PCM16/24 精确。
pub fn copy_to<W: Write + Seek>(
    audio: &mut Audio,
    writer: &mut F32Writer<W>,
    start: u64,
    end: u64,
    mut progress: impl FnMut(u64),
) -> Result<()> {
    audio.seek(start)?;
    let channels = u64::from(audio.spec.channels);
    let mut left = (end - start) * channels;
    let mut buffer = Vec::with_capacity(COPY_SAMPLES);
    while left > 0 {
        let count = left.min(COPY_SAMPLES as u64) as usize;
        buffer.clear();
        audio.append(count, &mut buffer)?;
        writer.write_samples(&buffer)?;
        left -= count as u64;
        progress(end - left / channels);
    }
    Ok(())
}
