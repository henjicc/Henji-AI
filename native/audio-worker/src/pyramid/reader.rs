use super::{Audio, Result};

/// 从当前位置顺序读取交错样本；Audio 自身按块解码（含 RF64），这里只保留流式读取的接口。
pub struct Stream {
    audio: Audio,
}
impl Stream {
    pub fn new(audio: Audio) -> Result<Self> {
        Ok(Self { audio })
    }
    pub fn append(&mut self, count: usize, output: &mut Vec<f32>) -> Result<()> {
        self.audio.append(count, output)
    }
}
