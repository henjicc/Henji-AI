//! 帧流：每个流一个共享纹理池与一个生产线程，按帧率把画面写入空闲槽位并通过控制通道发出 `frame` 事件；
//! 客户端在所有引用释放后发回 `release_frame`，槽位才可复用（背压：无空闲槽位时丢弃该帧并计数）。
//!
//! 两种来源：合成测试画面（1.2，`start_test_stream`，按帧率生产，无空闲槽位时丢帧）与真实解码会话
//! （1.3，`open_decoder`，见 `decode/`：按请求生产，无空闲槽位时阻塞等待，不丢帧）。
//!
//! 生命周期约束：
//! - 生产线程等 `activate`（启动响应已写出）后才发第一帧，客户端不会收到未登记流的帧；
//! - 流自然结束（帧数用尽或出错）只发 `stream_ended`，纹理与客户端句柄保留到 `stop_stream`：
//!   客户端可能仍有在途帧要按句柄导入，提前远程关闭句柄会让导入失败，甚至导入到被系统复用的句柄值。

use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::Sender;
use std::sync::{Arc, Condvar, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use crate::logging;
use crate::protocol::ServiceError;
use crate::test_pattern::SharedFormat;

pub const DEFAULT_POOL_SIZE: u32 = 6;
pub const MAX_POOL_SIZE: u32 = 16;
pub const MAX_DIMENSION: u32 = 8192;

#[derive(Debug, Clone, PartialEq)]
pub struct TestStreamOptions {
    pub stream_id: String,
    pub format: SharedFormat,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub pool_size: u32,
    pub max_frames: Option<u64>,
    pub keyed_mutex: bool,
}

impl TestStreamOptions {
    pub fn validate(&self) -> Result<(), ServiceError> {
        let invalid = |message: String| Err(ServiceError::new("INVALID_REQUEST", message));
        if self.stream_id.is_empty() || self.stream_id.len() > 128 {
            return invalid("streamId 无效".into());
        }
        if self.width == 0 || self.height == 0 || self.width > MAX_DIMENSION || self.height > MAX_DIMENSION {
            return invalid(format!("尺寸 {}x{} 超出范围", self.width, self.height));
        }
        let align = self.format.alignment();
        if self.width % align != 0 || self.height % align != 0 {
            return invalid(format!("{} 要求宽高为 {align} 的倍数", self.format.name()));
        }
        if self.width < 640 || self.height < 360 {
            return invalid("测试画面至少 640x360".into());
        }
        if !(self.fps > 0.0 && self.fps <= 240.0) {
            return invalid(format!("帧率 {} 超出范围", self.fps));
        }
        if self.pool_size < 2 || self.pool_size > MAX_POOL_SIZE {
            return invalid(format!("纹理池大小 {} 超出范围（2–{MAX_POOL_SIZE}）", self.pool_size));
        }
        Ok(())
    }
}

/// 槽位占用表与计数，控制线程与生产线程共享。
pub struct SlotTable {
    in_use: Mutex<Vec<bool>>,
    freed: Condvar,
}

impl SlotTable {
    pub fn new(count: usize) -> Self {
        Self { in_use: Mutex::new(vec![false; count]), freed: Condvar::new() }
    }

    /// 解码会话在确定池大小后设置（打开前无槽位）。
    pub fn resize(&self, count: usize) {
        *self.in_use.lock().unwrap() = vec![false; count];
    }

    /// 没有空闲槽位时最多等待 `timeout`，有槽位被释放即返回。
    pub fn wait_freed(&self, timeout: Duration) {
        let in_use = self.in_use.lock().unwrap();
        if in_use.iter().all(|used| *used) {
            let _ = self.freed.wait_timeout(in_use, timeout);
        }
    }

    /// 取一个空闲槽位并标记占用。
    pub fn acquire(&self) -> Option<u32> {
        let mut in_use = self.in_use.lock().unwrap();
        let index = in_use.iter().position(|used| !used)?;
        in_use[index] = true;
        Some(index as u32)
    }

    /// 归还槽位。返回 false 表示槽位不存在或本来就空闲（重复释放）。
    pub fn release(&self, slot: u32) -> bool {
        let mut in_use = self.in_use.lock().unwrap();
        match in_use.get_mut(slot as usize) {
            Some(used) if *used => {
                *used = false;
                self.freed.notify_all();
                true
            }
            _ => false,
        }
    }

    pub fn outstanding(&self) -> usize {
        self.in_use.lock().unwrap().iter().filter(|used| **used).count()
    }
}

#[derive(Default)]
pub struct StreamCounters {
    pub produced: AtomicU64,
    pub skipped: AtomicU64,
    pub released: AtomicU64,
    pub duplicate_releases: AtomicU64,
    /// 每帧写入（含同步等待）的累计微秒，用于平均耗时统计。
    pub render_us: AtomicU64,
    // 以下为解码会话计数（测试画面流恒为 0）。
    pub decoded: AtomicU64,
    pub discarded: AtomicU64,
    pub missing: AtomicU64,
    pub seeks: AtomicU64,
    /// 播放计划中的剪辑点/跳转（开新段、不 flush）。
    pub cuts: AtomicU64,
    /// 其中预先接续的剪辑点（3.6）：上一段所需的包送完后立即送入下一段，解码器流水不排空、不丢弃预解的帧。
    pub prefed_cuts: AtomicU64,
    /// 单帧定位时的 flush。
    pub flushes: AtomicU64,
    /// 解码器排空到文件末尾后再定位所需的 flush。
    pub eof_flushes: AtomicU64,
    pub decode_errors: AtomicU64,
    /// 送包（含软解线程排队）累计微秒。
    pub decode_us: AtomicU64,
    /// CPU 侧复制到上传缓冲/中转纹理的累计微秒。
    pub upload_us: AtomicU64,
    /// 其中等待映射上传缓冲的累计微秒。
    pub map_us: AtomicU64,
    /// 等待空闲槽位的累计微秒（背压）。
    pub wait_us: AtomicU64,
}

pub struct StreamControl {
    /// 停止标志；解码会话把它交给 FFmpeg 中断回调，阻塞 I/O 尽快返回。
    pub stop: Arc<AtomicBool>,
    /// 启动响应已写出，可以开始发帧。
    pub active: AtomicBool,
    /// 解码会话打开失败（线程已响应错误并退出），由主线程回收。
    pub open_failed: AtomicBool,
    pub slots: SlotTable,
    pub counters: StreamCounters,
    /// 输出格式与池纹理尺寸（解码会话打开后才确定）。
    info: Mutex<Option<(SharedFormat, u32, u32)>>,
}

impl StreamControl {
    pub fn new(pool_size: usize) -> Self {
        Self { stop: Arc::new(AtomicBool::new(false)), active: AtomicBool::new(false), open_failed: AtomicBool::new(false), slots: SlotTable::new(pool_size), counters: StreamCounters::default(), info: Mutex::new(None) }
    }

    pub fn set_info(&self, format: SharedFormat, width: u32, height: u32) {
        *self.info.lock().unwrap() = Some((format, width, height));
    }

    pub fn info(&self) -> Option<(SharedFormat, u32, u32)> {
        *self.info.lock().unwrap()
    }
}

/// 发出一帧时的事件内容（流线程 → 控制通道）。
pub fn frame_event(stream_id: &str, slot: u32, frame_index: u64, timestamp_us: i64) -> Value {
    json!({ "event": "frame", "streamId": stream_id, "slot": slot, "frameIndex": frame_index, "timestampUs": timestamp_us })
}

pub fn counters_value(control: &StreamControl) -> Value {
    let counters = &control.counters;
    let produced = counters.produced.load(Ordering::Relaxed);
    let load = |value: &AtomicU64| value.load(Ordering::Relaxed);
    let average = |value: &AtomicU64| if produced > 0 { load(value) as f64 / produced as f64 } else { 0.0 };
    json!({
        "produced": produced,
        "skipped": load(&counters.skipped),
        "released": load(&counters.released),
        "duplicateReleases": load(&counters.duplicate_releases),
        "outstanding": control.slots.outstanding(),
        "renderUsAverage": average(&counters.render_us),
        "decoded": load(&counters.decoded),
        "discarded": load(&counters.discarded),
        "missing": load(&counters.missing),
        "seeks": load(&counters.seeks),
        "cuts": load(&counters.cuts),
        "prefedCuts": load(&counters.prefed_cuts),
        "flushes": load(&counters.flushes),
        "eofFlushes": load(&counters.eof_flushes),
        "decodeErrors": load(&counters.decode_errors),
        "decodeUsTotal": load(&counters.decode_us),
        "uploadUsAverage": average(&counters.upload_us),
        "mapUsAverage": average(&counters.map_us),
        "waitUsTotal": load(&counters.wait_us),
    })
}

struct Stream {
    control: Arc<StreamControl>,
    thread: Option<JoinHandle<Box<dyn StreamResources>>>,
    /// 解码会话的命令通道（测试画面流为 None）。
    commands: Option<Sender<crate::decode::SessionCommand>>,
}

impl Stream {
    fn describe(&self) -> (Value, u32, u32) {
        match self.control.info() {
            Some((format, width, height)) => (json!(format.name()), width, height),
            None => (Value::Null, 0, 0),
        }
    }
}

/// 生产线程结束后交回的资源：在 `stop_stream` 时才释放（远程关闭客户端句柄）。
pub trait StreamResources: Send {
    /// 远程关闭客户端句柄并释放纹理，返回关闭失败的说明。
    fn release(self: Box<Self>) -> Vec<String>;
}

pub struct StreamManager {
    streams: HashMap<String, Stream>,
}

impl Default for StreamManager {
    fn default() -> Self {
        Self::new()
    }
}

impl StreamManager {
    pub fn new() -> Self {
        Self { streams: HashMap::new() }
    }

    /// 启动响应写出后调用，生产线程开始发帧。
    pub fn activate(&self, stream_id: &str) {
        if let Some(stream) = self.streams.get(stream_id) {
            stream.control.active.store(true, Ordering::Release);
        }
    }

    pub fn release_frame(&self, stream_id: &str, slot: u32) {
        let Some(stream) = self.streams.get(stream_id) else {
            // 流已停止后迟到的释放：槽位随流一起回收，忽略。
            return;
        };
        if stream.control.slots.release(slot) {
            stream.control.counters.released.fetch_add(1, Ordering::Relaxed);
        } else {
            stream.control.counters.duplicate_releases.fetch_add(1, Ordering::Relaxed);
            logging::warn("stream.release_unexpected", "释放了未占用的槽位", json!({ "streamId": stream_id, "slot": slot }));
        }
    }

    /// 停止并回收流（等待生产线程退出、远程关闭句柄）。返回停止前的计数。
    pub fn stop(&mut self, stream_id: &str) -> Option<Value> {
        let mut stream = self.streams.remove(stream_id)?;
        stream.control.stop.store(true, Ordering::Relaxed);
        // 关闭命令通道：解码会话线程立即醒来退出。
        stream.commands.take();
        if let Some(thread) = stream.thread.take() {
            match thread.join() {
                Ok(resources) => {
                    let errors = resources.release();
                    if !errors.is_empty() {
                        logging::warn("stream.handle_close_failed", "关闭客户端纹理句柄失败", json!({ "streamId": stream_id, "errors": errors }));
                    }
                }
                Err(_) => logging::error("stream.thread_panicked", "帧流线程异常结束", json!({ "streamId": stream_id })),
            }
        }
        let (format, width, height) = stream.describe();
        Some(json!({ "streamId": stream_id, "format": format, "width": width, "height": height, "counters": counters_value(&stream.control) }))
    }

    /// 回收打开失败的解码会话（线程已响应错误并退出）。
    pub fn reap(&mut self) {
        let failed: Vec<String> = self
            .streams
            .iter()
            .filter(|(_, stream)| stream.control.open_failed.load(Ordering::Acquire) && stream.thread.as_ref().is_none_or(|thread| thread.is_finished()))
            .map(|(id, _)| id.clone())
            .collect();
        for id in failed {
            self.stop(&id);
        }
    }

    pub fn is_decoder(&self, stream_id: &str) -> bool {
        self.streams.get(stream_id).is_some_and(|stream| stream.commands.is_some() && !stream.control.open_failed.load(Ordering::Acquire))
    }

    /// 把命令交给解码会话线程。
    pub fn dispatch(&self, stream_id: &str, command: crate::decode::SessionCommand) -> Result<(), ServiceError> {
        let sender = self.streams.get(stream_id).and_then(|stream| stream.commands.as_ref()).ok_or_else(|| ServiceError::new("INVALID_REQUEST", format!("解码会话 {stream_id} 不存在")))?;
        sender.send(command).map_err(|_| ServiceError::new("INVALID_REQUEST", format!("解码会话 {stream_id} 已结束")))
    }

    /// 解码会话数（含正在打开的）。
    pub fn decoder_count(&self) -> usize {
        self.streams.values().filter(|stream| stream.commands.is_some() && !stream.control.open_failed.load(Ordering::Acquire)).count()
    }

    /// 启动解码会话：会话线程打开文件后自行响应 `request_id`。会话数、显存与硬解名额按预算（3.1）。
    pub fn start_decoder(&mut self, request_id: String, platform: &Arc<dyn crate::platform::VideoPlatform>, options: crate::decode::DecodeOptions, budget: &crate::budget::Budget) -> Result<(), ServiceError> {
        options.validate()?;
        if self.streams.contains_key(&options.stream_id) {
            return Err(ServiceError::new("INVALID_REQUEST", format!("流 {} 已存在", options.stream_id)));
        }
        budget.admit_session(self.decoder_count())?;
        let control = Arc::new(StreamControl::new(0));
        let (sender, receiver) = std::sync::mpsc::channel();
        let stream_id = options.stream_id.clone();
        let thread = crate::decode::spawn(request_id, platform.clone(), options, control.clone(), receiver, budget.clone()).map_err(|error| ServiceError::new("INTERNAL", format!("无法启动解码线程：{error}")))?;
        control.active.store(true, Ordering::Release);
        self.streams.insert(stream_id, Stream { control, thread: Some(thread), commands: Some(sender) });
        Ok(())
    }

    pub fn stop_all(&mut self) {
        let ids: Vec<String> = self.streams.keys().cloned().collect();
        for id in ids {
            self.stop(&id);
        }
    }

    pub fn stats(&self) -> Value {
        Value::Array(
            self.streams
                .iter()
                .map(|(id, stream)| {
                    let (format, width, height) = stream.describe();
                    json!({ "streamId": id, "kind": if stream.commands.is_some() { "decoder" } else { "test" }, "format": format, "width": width, "height": height, "running": stream.thread.as_ref().is_some_and(|thread| !thread.is_finished()), "counters": counters_value(&stream.control) })
                })
                .collect(),
        )
    }

    pub fn start_test_stream(&mut self, platform: &Arc<dyn crate::platform::VideoPlatform>, options: TestStreamOptions) -> Result<Value, ServiceError> {
        options.validate()?;
        if self.streams.contains_key(&options.stream_id) {
            return Err(ServiceError::new("INVALID_REQUEST", format!("流 {} 已存在", options.stream_id)));
        }
        let started = Instant::now();
        let control = Arc::new(StreamControl::new(options.pool_size as usize));
        control.set_info(options.format, options.width, options.height);
        let crate::platform::TestStream { thread, handles, layout } = platform.start_test_stream(&options, control.clone()).map_err(|message| ServiceError::new("GPU_FAILED", message))?;
        self.streams.insert(options.stream_id.clone(), Stream { control, thread: Some(thread), commands: None });
        let setup_ms = started.elapsed().as_secs_f64() * 1000.0;
        logging::info(
            "stream.started",
            "测试帧流已启动",
            json!({ "streamId": options.stream_id, "format": options.format.name(), "width": options.width, "height": options.height, "fps": options.fps, "poolSize": options.pool_size, "keyedMutex": options.keyed_mutex, "setupMs": setup_ms }),
        );
        Ok(json!({
            "streamId": options.stream_id,
            "format": options.format.name(),
            "codedSize": { "width": options.width, "height": options.height },
            "visibleRect": { "x": 0, "y": 0, "width": options.width, "height": options.height },
            "colorSpace": options.format.test_color_space(),
            "fps": options.fps,
            "keyedMutex": options.keyed_mutex,
            "slots": handles.iter().enumerate().map(|(slot, handle)| json!({ "slot": slot, "handle": handle.to_string() })).collect::<Vec<_>>(),
            "pattern": layout,
            "setupMs": setup_ms,
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn options() -> TestStreamOptions {
        TestStreamOptions { stream_id: "s1".into(), format: SharedFormat::Nv12, width: 3840, height: 2160, fps: 60.0, pool_size: 6, max_frames: None, keyed_mutex: true }
    }

    #[test]
    fn validates_options() {
        assert!(options().validate().is_ok());
        assert!(TestStreamOptions { width: 3841, ..options() }.validate().is_err(), "nv12 奇数宽度");
        assert!(TestStreamOptions { width: 3841, format: SharedFormat::Rgba, ..options() }.validate().is_ok());
        assert!(TestStreamOptions { fps: 0.0, ..options() }.validate().is_err());
        assert!(TestStreamOptions { pool_size: 1, ..options() }.validate().is_err());
        assert!(TestStreamOptions { pool_size: 17, ..options() }.validate().is_err());
        assert!(TestStreamOptions { width: 9000, ..options() }.validate().is_err());
        assert!(TestStreamOptions { stream_id: String::new(), ..options() }.validate().is_err());
    }

    #[test]
    fn slot_table_backpressure_and_duplicate_release() {
        let table = SlotTable::new(2);
        assert_eq!(table.acquire(), Some(0));
        assert_eq!(table.acquire(), Some(1));
        assert_eq!(table.acquire(), None, "池满时不分配");
        assert_eq!(table.outstanding(), 2);
        assert!(table.release(1));
        assert!(!table.release(1), "重复释放");
        assert!(!table.release(7), "越界释放");
        assert_eq!(table.acquire(), Some(1));
    }

    #[test]
    fn decode_pool_waits_for_release_instead_of_dropping() {
        let table = std::sync::Arc::new(SlotTable::new(0));
        table.resize(1);
        assert_eq!(table.acquire(), Some(0));
        let waiter = {
            let table = table.clone();
            std::thread::spawn(move || {
                let started = Instant::now();
                loop {
                    if let Some(slot) = table.acquire() {
                        return (slot, started.elapsed());
                    }
                    table.wait_freed(Duration::from_millis(500));
                }
            })
        };
        std::thread::sleep(Duration::from_millis(30));
        assert!(table.release(0));
        let (slot, waited) = waiter.join().unwrap();
        assert_eq!(slot, 0);
        assert!(waited >= Duration::from_millis(20) && waited < Duration::from_millis(400), "释放后应立即唤醒：{waited:?}");
    }

    #[test]
    fn decoder_counters_are_reported() {
        let control = StreamControl::new(2);
        control.counters.cuts.fetch_add(3, Ordering::Relaxed);
        control.counters.eof_flushes.fetch_add(1, Ordering::Relaxed);
        let value = counters_value(&control);
        assert_eq!(value["cuts"], 3);
        assert_eq!(value["eofFlushes"], 1);
        assert_eq!(value["flushes"], 0);
        assert_eq!(control.info(), None);
        control.set_info(SharedFormat::Rgbaf16, 3840, 2160);
        assert_eq!(control.info(), Some((SharedFormat::Rgbaf16, 3840, 2160)));
    }

    #[test]
    fn release_for_unknown_stream_is_ignored() {
        let manager = StreamManager::new();
        manager.release_frame("missing", 0);
        assert_eq!(manager.stats(), json!([]));
    }

    #[test]
    fn frame_event_shape() {
        assert_eq!(frame_event("a", 2, 7, 116_667), json!({ "event": "frame", "streamId": "a", "slot": 2, "frameIndex": 7, "timestampUs": 116_667 }));
    }
}
