//! 封装与写盘：单文件分片 MP4，独立线程。
//!
//! 分片 MP4 只追加不回改：每个关键帧起一个新分片，上一个分片在那一刻整体写出。进程此后任何时候被杀，
//! 文件都能读到最后一个完整分片。队列有界，磁盘慢时编码线程在这里等，由网格丢格并计数。

use super::encode::av_error;
use crate::core::health::Health;
use ffmpeg_sys_next as ff;
use std::{
    ffi::CString,
    path::Path,
    ptr,
    sync::{atomic::Ordering, mpsc, Arc, Mutex},
    thread,
};

/// 等写盘的包数上限（60 帧每秒时约四秒）。
const QUEUE_PACKETS: usize = 240;

struct Packet(*mut ff::AVPacket);
unsafe impl Send for Packet {}

enum Message {
    Packet(Packet),
    Flush(mpsc::Sender<()>),
    Finish(mpsc::Sender<()>),
}

struct Output {
    context: *mut ff::AVFormatContext,
    encoder_time_base: ff::AVRational,
    packets: u64,
    position: i64,
    closed: bool,
}
unsafe impl Send for Output {}

impl Output {
    unsafe fn position(&self) -> i64 {
        // 相对当前位置移动 0 字节（whence = 1）就是取当前写到哪了。
        unsafe { ff::avio_seek((*self.context).pb, 0, 1) }
    }

    /// 文件变长说明有分片落盘了：frames 是到这一刻为止读得回来的帧数。
    fn settle(&mut self, health: &Health, frames: u64) {
        let position = unsafe { self.position() };
        if position > self.position {
            self.position = position;
            health.bytes_written.store(position as u64, Ordering::Relaxed);
            health.durable_frames.store(frames, Ordering::Relaxed);
        }
    }

    fn close(&mut self) -> i32 {
        if self.closed {
            return 0;
        }
        self.closed = true;
        unsafe {
            let result = ff::av_write_trailer(self.context);
            let closed = ff::avio_closep(&mut (*self.context).pb);
            if result < 0 {
                result
            } else {
                closed
            }
        }
    }
}

impl Drop for Output {
    fn drop(&mut self) {
        self.close();
        unsafe { ff::avformat_free_context(self.context) };
    }
}

fn write_error(code: i32) -> String {
    // 28 是 ENOSPC。
    if code == ff::AVERROR(28) {
        "DISK_FULL|磁盘空间不足，已录部分保留，请释放空间".into()
    } else {
        format!("FILE_ERROR|录屏文件写入失败，已录部分保留：{}", av_error(code))
    }
}

pub struct Mux {
    sender: mpsc::SyncSender<Message>,
    failure: Arc<Mutex<Option<String>>>,
    health: Arc<Health>,
    thread: Option<thread::JoinHandle<()>>,
}

impl Mux {
    /// 建文件并写好文件头（之后进程被杀也能认出这是个视频文件），再起写盘线程。
    pub fn spawn(path: &Path, encoder: *const ff::AVCodecContext, health: Arc<Health>) -> Result<Self, String> {
        let file_error = |code: i32| format!("FILE_ERROR|无法创建录屏文件：{}", av_error(code));
        let c_path = CString::new(path.to_string_lossy().as_bytes()).map_err(|_| "INVALID_ARGUMENT|录屏文件路径不合法".to_string())?;
        let mut output = unsafe {
            let mut context = ptr::null_mut();
            let result = ff::avformat_alloc_output_context2(&mut context, ptr::null(), c"mp4".as_ptr(), c_path.as_ptr());
            if result < 0 {
                return Err(file_error(result));
            }
            let output = Output { context, encoder_time_base: (*encoder).time_base, packets: 0, position: 0, closed: true };
            let stream = ff::avformat_new_stream(context, ptr::null());
            if stream.is_null() {
                return Err("FILE_ERROR|无法创建视频轨".into());
            }
            let result = ff::avcodec_parameters_from_context((*stream).codecpar, encoder);
            if result < 0 {
                return Err(file_error(result));
            }
            (*stream).time_base = (*encoder).time_base;
            (*stream).avg_frame_rate = (*encoder).framerate;
            (*stream).r_frame_rate = (*encoder).framerate;
            let result = ff::avio_open(&mut (*context).pb, c_path.as_ptr(), ff::AVIO_FLAG_WRITE);
            if result < 0 {
                return Err(file_error(result));
            }
            let mut output = output;
            // 分片一写出就交给系统，不在 FFmpeg 的缓冲里停留。
            (*context).flush_packets = 1;
            let mut options = ptr::null_mut();
            ff::av_dict_set(&mut options, c"movflags".as_ptr(), c"frag_keyframe+empty_moov+default_base_moof".as_ptr(), 0);
            let result = ff::avformat_write_header(context, &mut options);
            ff::av_dict_free(&mut options);
            if result < 0 {
                // 文件头没写成：不能再写结尾，只关文件。
                ff::avio_closep(&mut (*context).pb);
                return Err(write_error(result));
            }
            output.closed = false;
            ff::avio_flush((*context).pb);
            output.position = output.position();
            output
        };
        let (sender, receiver) = mpsc::sync_channel::<Message>(QUEUE_PACKETS);
        let failure = Arc::new(Mutex::new(None::<String>));
        let (thread_failure, thread_health, file) = (failure.clone(), health.clone(), path.to_path_buf());
        let thread = thread::Builder::new()
            .name("capture-mux".into())
            .spawn(move || {
                let health = thread_health;
                let fail = |code: i32| {
                    thread_failure.lock().unwrap().get_or_insert(write_error(code));
                };
                for message in receiver {
                    match message {
                        Message::Packet(Packet(mut packet)) => unsafe {
                            health.write_queue.fetch_sub(1, Ordering::Relaxed);
                            // 出过错之后只收包、放掉，不再写：编码线程下一次写入时会看到错误并收尾。
                            if thread_failure.lock().unwrap().is_none() {
                                let stream = *(*output.context).streams;
                                ff::av_packet_rescale_ts(packet, output.encoder_time_base, (*stream).time_base);
                                (*packet).stream_index = 0;
                                let started = std::time::Instant::now();
                                let result = ff::av_write_frame(output.context, packet);
                                Health::raise(&health.write_max_us, started.elapsed().as_micros() as u64);
                                if result < 0 {
                                    fail(result);
                                } else {
                                    // 这一包（关键帧）触发了上一个分片落盘：它之前的包都读得回来了。
                                    output.settle(&health, output.packets);
                                    output.packets += 1;
                                }
                            }
                            ff::av_packet_free(&mut packet);
                        },
                        Message::Flush(done) => {
                            if thread_failure.lock().unwrap().is_none() {
                                let result = unsafe { ff::av_write_frame(output.context, ptr::null_mut()) };
                                if result < 0 {
                                    fail(result);
                                } else {
                                    unsafe { ff::avio_flush((*output.context).pb) };
                                    output.settle(&health, output.packets);
                                }
                            }
                            let _ = done.send(());
                        }
                        Message::Finish(done) => {
                            let result = output.close();
                            if result < 0 {
                                fail(result);
                            } else if thread_failure.lock().unwrap().is_none() {
                                health.durable_frames.store(output.packets, Ordering::Relaxed);
                                if let Ok(metadata) = std::fs::metadata(&file) {
                                    health.bytes_written.store(metadata.len(), Ordering::Relaxed);
                                }
                            }
                            let _ = done.send(());
                        }
                    }
                }
            })
            .map_err(|error| format!("CAPTURE_FAILED|无法启动写盘线程：{error}"))?;
        Ok(Self { sender, failure, health, thread: Some(thread) })
    }

    pub fn check(&self) -> Result<(), String> {
        match self.failure.lock().unwrap().as_ref() {
            Some(error) => Err(error.clone()),
            None => Ok(()),
        }
    }

    /// 队列满时在这里等磁盘。
    pub fn write(&self, packet: *mut ff::AVPacket) -> Result<(), String> {
        let queued = self.health.write_queue.fetch_add(1, Ordering::Relaxed) + 1;
        Health::raise(&self.health.write_queue_max, queued);
        self.sender.send(Message::Packet(Packet(packet))).map_err(|_| "FILE_ERROR|写盘线程已退出".to_string())?;
        self.check()
    }

    fn round_trip(&self, message: impl FnOnce(mpsc::Sender<()>) -> Message) -> Result<(), String> {
        let (done, wait) = mpsc::channel();
        self.sender.send(message(done)).map_err(|_| "FILE_ERROR|写盘线程已退出".to_string())?;
        let _ = wait.recv();
        self.check()
    }

    /// 把已写的包立刻落成一个完整分片，落盘后返回。
    pub fn flush(&self) -> Result<(), String> {
        self.round_trip(Message::Flush)
    }

    /// 写完队列里的包和结尾，关文件。
    pub fn finish(&self) -> Result<(), String> {
        self.round_trip(Message::Finish)
    }
}

impl Drop for Mux {
    fn drop(&mut self) {
        // 放下发送端，线程处理完队列后退出并关文件。
        let (sender, _) = mpsc::sync_channel(1);
        drop(std::mem::replace(&mut self.sender, sender));
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}
