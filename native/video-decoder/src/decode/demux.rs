//! 解封装：打开本地文件（与 probe 同一安全规则）、读取所选视频流的包、定位、关键帧索引。

use std::ffi::c_int;
use std::ptr;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use ffmpeg_sys_next as ff;

use super::timing::TimeBase;
use crate::probe::{error_text, open_input, FormatContext};
use crate::protocol::ServiceError;

/// 拥有所有权的包。
pub struct Packet(pub *mut ff::AVPacket);

impl Packet {
    pub fn pts(&self) -> Option<i64> {
        let value = unsafe { (*self.0).pts };
        (value != ff::AV_NOPTS_VALUE).then_some(value)
    }

    pub fn dts(&self) -> Option<i64> {
        let value = unsafe { (*self.0).dts };
        (value != ff::AV_NOPTS_VALUE).then_some(value)
    }

    /// 呈现时间，缺失时用解码时间。
    pub fn timestamp(&self) -> Option<i64> {
        self.pts().or(self.dts())
    }

    pub fn is_key(&self) -> bool {
        unsafe { (*self.0).flags & ff::AV_PKT_FLAG_KEY as c_int != 0 }
    }
}

impl Drop for Packet {
    fn drop(&mut self) {
        unsafe { ff::av_packet_free(&mut self.0) };
    }
}

pub struct Input {
    context: FormatContext,
    pub stream_index: c_int,
    pub time_base: TimeBase,
    /// 中断回调指向这里：会话停止时置位，阻塞 I/O 尽快返回。
    _interrupt: Arc<AtomicBool>,
}

// 只在会话线程里使用。
unsafe impl Send for Input {}

impl Input {
    pub fn open(path: &str, stream_index: Option<i32>, interrupt: Arc<AtomicBool>) -> Result<Self, ServiceError> {
        let context = open_input(path, &interrupt)?;
        let index = match stream_index {
            Some(index) => index,
            None => unsafe { ff::av_find_best_stream(context.0, ff::AVMediaType::AVMEDIA_TYPE_VIDEO, -1, -1, ptr::null_mut(), 0) },
        };
        let count = unsafe { (*context.0).nb_streams } as c_int;
        if index < 0 || index >= count {
            return Err(ServiceError::new("UNSUPPORTED_FORMAT", "文件没有可解码的视频流"));
        }
        let streams = unsafe { std::slice::from_raw_parts((*context.0).streams, count as usize) };
        for (position, stream) in streams.iter().enumerate() {
            let stream = unsafe { &mut **stream };
            let parameters = unsafe { &*stream.codecpar };
            if position as c_int == index {
                if parameters.codec_type != ff::AVMediaType::AVMEDIA_TYPE_VIDEO {
                    return Err(ServiceError::new("UNSUPPORTED_FORMAT", "所选流不是视频流"));
                }
            } else {
                // 其余流不读，减少 I/O 与解析。
                stream.discard = ff::AVDiscard::AVDISCARD_ALL;
            }
        }
        let base = unsafe { (*streams[index as usize]).time_base };
        let time_base = TimeBase { num: base.num, den: base.den };
        if !time_base.is_valid() {
            return Err(ServiceError::new("UNSUPPORTED_FORMAT", "视频流时间基无效"));
        }
        Ok(Self { context, stream_index: index, time_base, _interrupt: interrupt })
    }

    pub fn stream(&self) -> &ff::AVStream {
        unsafe { &**(*self.context.0).streams.add(self.stream_index as usize) }
    }

    pub fn parameters(&self) -> &ff::AVCodecParameters {
        unsafe { &*self.stream().codecpar }
    }

    pub fn format_name(&self) -> Option<String> {
        crate::ffmpeg_info::c_text(unsafe { (*(*self.context.0).iformat).name })
    }

    /// 读取所选流的下一个包；文件结束返回 None。
    pub fn read(&mut self) -> Result<Option<Packet>, ServiceError> {
        loop {
            let packet = Packet(unsafe { ff::av_packet_alloc() });
            if packet.0.is_null() {
                return Err(ServiceError::new("INTERNAL", "无法分配包"));
            }
            let result = unsafe { ff::av_read_frame(self.context.0, packet.0) };
            if result == ff::AVERROR_EOF {
                return Ok(None);
            }
            if result < 0 {
                if result == ff::AVERROR_EXIT {
                    return Err(ServiceError::new("CANCELLED", "解码已停止"));
                }
                return Err(ServiceError::new("DECODE_FAILED", format!("读取文件失败：{}", error_text(result))));
            }
            if unsafe { (*packet.0).stream_index } == self.stream_index {
                return Ok(Some(packet));
            }
        }
    }

    /// 定位到 `ticks` 之前（含）的关键帧附近。失败时（如早于起点）回到开头。
    pub fn seek(&mut self, ticks: i64) -> Result<(), ServiceError> {
        let result = unsafe { ff::av_seek_frame(self.context.0, self.stream_index, ticks, ff::AVSEEK_FLAG_BACKWARD as c_int) };
        if result >= 0 {
            return Ok(());
        }
        self.seek_start()
    }

    /// 回到流的开头（第一个关键帧）。
    pub fn seek_start(&mut self) -> Result<(), ServiceError> {
        let stream = self.stream();
        let start = if stream.start_time != ff::AV_NOPTS_VALUE {
            stream.start_time
        } else if self.has_index() {
            self.first_index_timestamp()
        } else {
            0
        };
        let result = unsafe { ff::avformat_seek_file(self.context.0, self.stream_index, i64::MIN, start, start, 0) };
        if result >= 0 {
            return Ok(());
        }
        let result = unsafe { ff::av_seek_frame(self.context.0, self.stream_index, start, ff::AVSEEK_FLAG_BACKWARD as c_int | ff::AVSEEK_FLAG_ANY as c_int) };
        if result >= 0 {
            Ok(())
        } else {
            Err(ServiceError::new("DECODE_FAILED", format!("无法定位：{}", error_text(result))))
        }
    }

    fn first_index_timestamp(&self) -> i64 {
        let stream = self.stream() as *const ff::AVStream as *mut ff::AVStream;
        unsafe { (*ff::avformat_index_get_entry(stream, 0)).timestamp }
    }

    /// 容器索引中时间 ≤ `ticks` 的最后一个关键帧时间（解码时间刻度）。没有索引返回 None。
    pub fn key_before(&self, ticks: i64) -> Option<i64> {
        let stream = self.stream() as *const ff::AVStream as *mut ff::AVStream;
        let count = unsafe { ff::avformat_index_get_entries_count(stream) };
        if count <= 0 {
            return None;
        }
        let entry = |index: c_int| unsafe { &*ff::avformat_index_get_entry(stream, index) };
        // 二分找最后一个时间 ≤ ticks 的条目，再向前找关键帧。
        let (mut low, mut high) = (0, count);
        while low < high {
            let middle = (low + high) / 2;
            if entry(middle).timestamp <= ticks {
                low = middle + 1;
            } else {
                high = middle;
            }
        }
        let mut index = low - 1;
        while index >= 0 {
            let item = entry(index);
            if item.flags() & ff::AVINDEX_KEYFRAME != 0 {
                return Some(item.timestamp);
            }
            index -= 1;
        }
        Some(i64::MIN)
    }

    pub fn has_index(&self) -> bool {
        unsafe { ff::avformat_index_get_entries_count(self.stream()) > 0 }
    }
}
