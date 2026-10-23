use std::{
    fs::{File, OpenOptions},
    io::{self, Read, Seek, SeekFrom, Write},
    path::Path,
};

const HEADER: u64 = 92;
pub struct Wav {
    file: File,
    pub bytes: u64,
    rate: u32,
    channels: u16,
    bits: u16,
}
impl Wav {
    pub fn create(path: &Path, rate: u32, channels: u16, bits: u16) -> io::Result<Self> {
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create_new(true)
            .open(path)?;
        let mut wav = Self {
            file,
            bytes: 0,
            rate,
            channels,
            bits,
        };
        wav.checkpoint()?;
        Ok(wav)
    }
    pub fn write(&mut self, samples: &[f32]) -> io::Result<()> {
        let mut bytes = Vec::with_capacity(samples.len() * self.bits as usize / 8);
        for &sample in samples {
            let s = if sample.is_finite() { sample } else { 0.0 };
            match self.bits {
                16 => bytes.extend_from_slice(
                    &((s as f64 * 32768.0).round().clamp(-32768.0, 32767.0) as i16).to_le_bytes(),
                ),
                24 => bytes.extend_from_slice(
                    &((s as f64 * 8388608.0).round().clamp(-8388608.0, 8388607.0) as i32)
                        .to_le_bytes()[..3],
                ),
                _ => bytes.extend_from_slice(&s.to_le_bytes()),
            }
        }
        self.file.seek(SeekFrom::Start(HEADER + self.bytes))?;
        let result = self.file.write_all(&bytes);
        // 磁盘满也可能已写入半块；保留其中完整的采样帧，再由 checkpoint 修复头部。
        let align = self.channels as u64 * self.bits as u64 / 8;
        self.bytes = self.file.stream_position()?.saturating_sub(HEADER) / align * align;
        result
    }
    pub fn checkpoint(&mut self) -> io::Result<()> {
        // RIFF 的 chunk 必须按偶数字节对齐；下次追加会覆盖这个尾部填充。
        if self.bytes % 2 != 0 {
            self.file.seek(SeekFrom::Start(HEADER + self.bytes))?;
            self.file.write_all(&[0])?;
        }
        self.file.set_len(HEADER + self.bytes + self.bytes % 2)?;
        let header = header(self.rate, self.channels, self.bits, self.bytes);
        self.file.seek(SeekFrom::Start(0))?;
        self.file.write_all(&header)?;
        self.file.sync_data()
    }
    // 从物理长度恢复完整采样帧，进程崩溃时无需依赖尚未更新的 data 长度。
    pub fn recover(path: &Path) -> io::Result<u64> {
        let mut file = OpenOptions::new().read(true).write(true).open(path)?;
        let mut h = [0u8; HEADER as usize];
        file.read_exact(&mut h)?;
        if (&h[..4] != b"RIFF" && &h[..4] != b"RF64")
            || &h[8..12] != b"WAVE"
            || &h[48..52] != b"fmt "
            || &h[84..88] != b"data"
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "不是本录音服务创建的 WAV",
            ));
        }
        let rate = u32::from_le_bytes(h[60..64].try_into().unwrap());
        let channels = u16::from_le_bytes(h[58..60].try_into().unwrap());
        let bits = u16::from_le_bytes(h[70..72].try_into().unwrap());
        if !(1..=2).contains(&channels) || ![16, 24, 32].contains(&bits) || rate == 0 {
            return Err(io::ErrorKind::InvalidData.into());
        }
        let align = channels as u64 * bits as u64 / 8;
        let bytes = (file.metadata()?.len() - HEADER) / align * align;
        file.set_len(HEADER + bytes)?;
        Self {
            file,
            bytes,
            rate,
            channels,
            bits,
        }
        .checkpoint()?;
        Ok(bytes)
    }
}
fn header(rate: u32, channels: u16, bits: u16, bytes: u64) -> Vec<u8> {
    let riff_size = bytes + HEADER - 8 + bytes % 2;
    let rf64 = riff_size > u32::MAX as u64;
    let frames = bytes / (channels as u64 * bits as u64 / 8);
    let mut h = Vec::with_capacity(HEADER as usize);
    h.extend_from_slice(if rf64 { b"RF64" } else { b"RIFF" });
    h.extend_from_slice(&(if rf64 { u32::MAX } else { riff_size as u32 }).to_le_bytes());
    h.extend_from_slice(b"WAVE");
    h.extend_from_slice(if rf64 { b"ds64" } else { b"JUNK" });
    h.extend_from_slice(&28u32.to_le_bytes());
    for n in [riff_size, bytes, frames] {
        h.extend_from_slice(&n.to_le_bytes());
    }
    h.extend_from_slice(&0u32.to_le_bytes());
    h.extend_from_slice(b"fmt ");
    h.extend_from_slice(&16u32.to_le_bytes());
    h.extend_from_slice(&(if bits == 32 { 3u16 } else { 1u16 }).to_le_bytes());
    h.extend_from_slice(&channels.to_le_bytes());
    h.extend_from_slice(&rate.to_le_bytes());
    h.extend_from_slice(&(rate * channels as u32 * bits as u32 / 8).to_le_bytes());
    h.extend_from_slice(&(channels * bits / 8).to_le_bytes());
    h.extend_from_slice(&bits.to_le_bytes());
    h.extend_from_slice(b"fact");
    h.extend_from_slice(&4u32.to_le_bytes());
    h.extend_from_slice(&(frames.min(u32::MAX as u64) as u32).to_le_bytes());
    h.extend_from_slice(b"data");
    h.extend_from_slice(&(if rf64 { u32::MAX } else { bytes as u32 }).to_le_bytes());
    h
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn recover_uncheckpointed_audio_and_reject_overwrite() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("测试.wav");
        let mut w = Wav::create(&p, 48000, 2, 24).unwrap();
        w.write(&[0.5, -1.0, 1.0, 0.0]).unwrap();
        drop(w);
        assert!(Wav::create(&p, 48000, 2, 24).is_err());
        assert_eq!(Wav::recover(&p).unwrap(), 12);
        let bytes = std::fs::read(p).unwrap();
        assert_eq!(&bytes[88..92], &12u32.to_le_bytes());
    }
    #[test]
    fn rf64_boundary_keeps_64_bit_sizes() {
        let size = 0x1_0000_0000;
        let h = header(192000, 2, 32, size);
        assert_eq!(h.len(), 92);
        assert_eq!(&h[..4], b"RF64");
        assert_eq!(&h[12..16], b"ds64");
        assert_eq!(u64::from_le_bytes(h[28..36].try_into().unwrap()), size);
        assert_eq!(&header(48000, 1, 16, 12)[..4], b"RIFF");
    }
    #[test]
    fn odd_pcm24_checkpoint_padding_is_not_audio() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("odd.wav");
        let mut w = Wav::create(&p, 44100, 1, 24).unwrap();
        w.write(&[0.5]).unwrap();
        w.checkpoint().unwrap();
        assert_eq!(std::fs::metadata(&p).unwrap().len(), 96);
        w.write(&[0.0]).unwrap();
        w.checkpoint().unwrap();
        drop(w);
        assert_eq!(Wav::recover(&p).unwrap(), 6);
        assert_eq!(std::fs::metadata(&p).unwrap().len(), 98);
    }
}
