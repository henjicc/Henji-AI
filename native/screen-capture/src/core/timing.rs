//! 逐帧时刻表：文件里每个帧序号一条定长记录，写明这一帧用的来源帧是系统什么时刻采到的。
//!
//! 鼠标键盘事件与画面对齐靠它：事件时刻与这里的采集时刻是同一个时钟（Windows 为 QPC，换算成微秒）。
//! 只追加、定长，进程中途被杀时尾部可能多出不完整的一条，读的时候舍去。
//!
//! 版本 1 布局（小端）：
//! - 文件头 64 字节：魔数 "HJFT"、版本 u32、文件头字节数 u32、每条字节数 u32、帧率分子 u32、分母 u32、
//!   网格起点 i64（微秒）、时钟种类 u32（1 = QPC，2 = mach_absolute_time），其余保留为 0。
//! - 记录 16 字节：来源帧采集时刻 i64（微秒）、网格格号 u32、标志 u16、保留 u16。
//!   标志：1 新帧、2 被丢弃、4 强制关键帧、8 空档后的第一帧、16 那段空档是来源丢失（不是用户暂停）。
//!   第 n 条对应文件里 pts = n 的帧；格时刻 = 起点 + 格号 × 帧间隔；相邻两条格号不连续处就是暂停。

use std::{
    fs::File,
    io::{self, BufWriter, Read, Write},
    path::Path,
};

pub const MAGIC: [u8; 4] = *b"HJFT";
pub const VERSION: u32 = 1;
pub const HEADER_BYTES: u32 = 64;
pub const RECORD_BYTES: u32 = 16;

pub const CLOCK_QPC: u32 = 1;
#[cfg_attr(windows, allow(dead_code))]
pub const CLOCK_MACH_ABSOLUTE: u32 = 2;

/// 这张来源帧第一次进文件；没有这一位就是重复上一帧（画面没变）。
pub const FLAG_FRESH: u16 = 1;
/// 这一格被跳过（编码积压）：文件里没有 pts 等于本条序号的帧。
pub const FLAG_DROPPED: u16 = 1 << 1;
/// 强制关键帧（第一帧、继续后的第一帧）。
pub const FLAG_KEYFRAME: u16 = 1 << 2;
/// 空档（暂停或来源丢失）之后的第一帧。
pub const FLAG_AFTER_RESUME: u16 = 1 << 3;
/// 这一帧之前的空档是来源丢失造成的（显示器断开、采集重新接上），不是用户暂停：
/// 这段时间声音与事件并没有停，对齐时不能当暂停扣掉。与 FLAG_AFTER_RESUME 同时出现。
pub const FLAG_AFTER_SOURCE_LOST: u16 = 1 << 4;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Header {
    pub fps_num: u32,
    pub fps_den: u32,
    pub origin_us: i64,
    pub clock: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Record {
    pub source_us: i64,
    pub cell: u32,
    pub flags: u16,
}

impl Header {
    pub fn cell_time(&self, cell: u32) -> i64 {
        self.origin_us + (cell as u128 * 1_000_000 * self.fps_den.max(1) as u128 / self.fps_num.max(1) as u128) as i64
    }
}

pub struct Writer {
    file: BufWriter<File>,
    pub records: u64,
}

impl Writer {
    pub fn create(path: &Path, header: Header) -> io::Result<Self> {
        let mut file = BufWriter::new(File::create(path)?);
        let mut bytes = [0u8; HEADER_BYTES as usize];
        bytes[0..4].copy_from_slice(&MAGIC);
        bytes[4..8].copy_from_slice(&VERSION.to_le_bytes());
        bytes[8..12].copy_from_slice(&HEADER_BYTES.to_le_bytes());
        bytes[12..16].copy_from_slice(&RECORD_BYTES.to_le_bytes());
        bytes[16..20].copy_from_slice(&header.fps_num.to_le_bytes());
        bytes[20..24].copy_from_slice(&header.fps_den.to_le_bytes());
        bytes[24..32].copy_from_slice(&header.origin_us.to_le_bytes());
        bytes[32..36].copy_from_slice(&header.clock.to_le_bytes());
        file.write_all(&bytes)?;
        file.flush()?;
        Ok(Self { file, records: 0 })
    }

    pub fn append(&mut self, record: Record) -> io::Result<()> {
        let mut bytes = [0u8; RECORD_BYTES as usize];
        bytes[0..8].copy_from_slice(&record.source_us.to_le_bytes());
        bytes[8..12].copy_from_slice(&record.cell.to_le_bytes());
        bytes[12..14].copy_from_slice(&record.flags.to_le_bytes());
        self.file.write_all(&bytes)?;
        self.records += 1;
        Ok(())
    }

    /// 交给系统（进程被杀后仍在）；每秒随分片调用一次。
    pub fn flush(&mut self) -> io::Result<()> {
        self.file.flush()
    }
}

fn u32_at(bytes: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap())
}

/// 读整张表；尾部不完整的记录舍去。文件头或版本不认识时报错，不猜。
pub fn read(path: &Path) -> io::Result<(Header, Vec<Record>)> {
    let mut bytes = Vec::new();
    File::open(path)?.read_to_end(&mut bytes)?;
    let invalid = |message: &str| io::Error::new(io::ErrorKind::InvalidData, message.to_string());
    if bytes.len() < HEADER_BYTES as usize || bytes[0..4] != MAGIC {
        return Err(invalid("不是逐帧时刻表"));
    }
    let version = u32_at(&bytes, 4);
    if version != VERSION {
        return Err(invalid(&format!("逐帧时刻表版本 {version} 不受支持")));
    }
    let (header_bytes, record_bytes) = (u32_at(&bytes, 8) as usize, u32_at(&bytes, 12) as usize);
    if header_bytes < HEADER_BYTES as usize || record_bytes < RECORD_BYTES as usize || bytes.len() < header_bytes {
        return Err(invalid("逐帧时刻表文件头损坏"));
    }
    let header = Header {
        fps_num: u32_at(&bytes, 16),
        fps_den: u32_at(&bytes, 20),
        origin_us: i64::from_le_bytes(bytes[24..32].try_into().unwrap()),
        clock: u32_at(&bytes, 32),
    };
    let records = bytes[header_bytes..]
        .chunks_exact(record_bytes)
        .map(|chunk| Record {
            source_us: i64::from_le_bytes(chunk[0..8].try_into().unwrap()),
            cell: u32_at(chunk, 8),
            flags: u16::from_le_bytes(chunk[12..14].try_into().unwrap()),
        })
        .collect();
    Ok((header, records))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::OpenOptions;

    #[test]
    fn round_trips_and_ignores_a_torn_tail() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("screen.frames");
        let header = Header { fps_num: 60, fps_den: 1, origin_us: 123_456_789_012, clock: CLOCK_QPC };
        let mut writer = Writer::create(&path, header).unwrap();
        let records = [
            Record { source_us: 123_456_789_000, cell: 0, flags: FLAG_FRESH | FLAG_KEYFRAME },
            Record { source_us: 123_456_789_000, cell: 1, flags: 0 },
            Record { source_us: 123_456_900_000, cell: 122, flags: FLAG_FRESH | FLAG_KEYFRAME | FLAG_AFTER_RESUME },
        ];
        for record in records {
            writer.append(record).unwrap();
        }
        writer.flush().unwrap();
        drop(writer);
        // 进程在写一条记录的中途被杀。
        OpenOptions::new().append(true).open(&path).unwrap().write_all(&[1, 2, 3, 4, 5]).unwrap();
        let (read_header, read_records) = read(&path).unwrap();
        assert_eq!(read_header, header);
        assert_eq!(read_records, records);
        assert_eq!(read_header.cell_time(120), header.origin_us + 2_000_000);
    }

    #[test]
    fn rejects_unknown_files() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("other");
        std::fs::write(&path, vec![0u8; 80]).unwrap();
        assert!(read(&path).is_err());
    }
}
