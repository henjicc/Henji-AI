//! 帧流：每个流一个共享纹理池与一个生产线程，按帧率把画面写入空闲槽位并通过控制通道发出 `frame` 事件；
//! 客户端在所有引用释放后发回 `release_frame`，槽位才可复用（背压：无空闲槽位时丢弃该帧并计数）。
//!
//! 1.2 只有合成测试画面一种来源（`start_test_stream`）；1.3 在同一流模型上接入真实解码。
//!
//! 生命周期约束：
//! - 生产线程等 `activate`（启动响应已写出）后才发第一帧，客户端不会收到未登记流的帧；
//! - 流自然结束（帧数用尽或出错）只发 `stream_ended`，纹理与客户端句柄保留到 `stop_stream`：
//!   客户端可能仍有在途帧要按句柄导入，提前远程关闭句柄会让导入失败，甚至导入到被系统复用的句柄值。

use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
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
}

impl SlotTable {
    pub fn new(count: usize) -> Self {
        Self { in_use: Mutex::new(vec![false; count]) }
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
}

pub struct StreamControl {
    pub stop: AtomicBool,
    /// 启动响应已写出，可以开始发帧。
    pub active: AtomicBool,
    pub slots: SlotTable,
    pub counters: StreamCounters,
}

/// 发出一帧时的事件内容（流线程 → 控制通道）。
pub fn frame_event(stream_id: &str, slot: u32, frame_index: u64, timestamp_us: i64) -> Value {
    json!({ "event": "frame", "streamId": stream_id, "slot": slot, "frameIndex": frame_index, "timestampUs": timestamp_us })
}

pub fn counters_value(control: &StreamControl) -> Value {
    let counters = &control.counters;
    let produced = counters.produced.load(Ordering::Relaxed);
    json!({
        "produced": produced,
        "skipped": counters.skipped.load(Ordering::Relaxed),
        "released": counters.released.load(Ordering::Relaxed),
        "duplicateReleases": counters.duplicate_releases.load(Ordering::Relaxed),
        "outstanding": control.slots.outstanding(),
        "renderUsAverage": if produced > 0 { counters.render_us.load(Ordering::Relaxed) as f64 / produced as f64 } else { 0.0 },
    })
}

struct Stream {
    format: SharedFormat,
    width: u32,
    height: u32,
    control: Arc<StreamControl>,
    thread: Option<JoinHandle<Box<dyn StreamResources>>>,
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
        Some(json!({ "streamId": stream_id, "format": stream.format.name(), "width": stream.width, "height": stream.height, "counters": counters_value(&stream.control) }))
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
                .map(|(id, stream)| json!({ "streamId": id, "format": stream.format.name(), "width": stream.width, "height": stream.height, "running": stream.thread.as_ref().is_some_and(|thread| !thread.is_finished()), "counters": counters_value(&stream.control) }))
                .collect(),
        )
    }

    #[cfg(windows)]
    pub fn start_test_stream(&mut self, gpu: &Arc<crate::gpu::GpuDevice>, client: &Arc<crate::shared_texture::ClientProcess>, options: TestStreamOptions) -> Result<Value, ServiceError> {
        options.validate()?;
        if self.streams.contains_key(&options.stream_id) {
            return Err(ServiceError::new("INVALID_REQUEST", format!("流 {} 已存在", options.stream_id)));
        }
        let started = Instant::now();
        let producer = imp::TestProducer::create(gpu.clone(), client.clone(), &options).map_err(|message| ServiceError::new("GPU_FAILED", message))?;
        let control = Arc::new(StreamControl { stop: AtomicBool::new(false), active: AtomicBool::new(false), slots: SlotTable::new(options.pool_size as usize), counters: StreamCounters::default() });
        let handles = producer.remote_handles();
        let layout = producer.layout.describe();
        let thread_control = control.clone();
        let thread_options = options.clone();
        let thread = std::thread::Builder::new()
            .name(format!("stream-{}", options.stream_id))
            .spawn(move || -> Box<dyn StreamResources> { Box::new(producer.run(&thread_options, &thread_control)) })
            .map_err(|error| ServiceError::new("INTERNAL", format!("无法启动流线程：{error}")))?;
        self.streams.insert(options.stream_id.clone(), Stream { format: options.format, width: options.width, height: options.height, control, thread: Some(thread) });
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

#[cfg(windows)]
mod imp {
    use super::*;
    use crate::gpu::GpuDevice;
    use crate::shared_texture::{self, ClientProcess, SharedSlot};
    use crate::test_pattern::{encode, PatternLayout, BIT_COUNT};
    use windows::core::Interface;
    use windows::Win32::Foundation::WAIT_TIMEOUT;
    use windows::Win32::Graphics::Direct3D11::*;

    const KEYED_MUTEX_TIMEOUT_MS: u32 = 500;

    pub struct TestProducer {
        gpu: Arc<GpuDevice>,
        client: Arc<ClientProcess>,
        slots: Vec<SharedSlot>,
        template: ID3D11Texture2D,
        white_block: ID3D11Texture2D,
        query: ID3D11Query,
        pub layout: PatternLayout,
    }

    // 只在自己的线程里使用；COM 接口均为 Send。
    unsafe impl Send for TestProducer {}

    impl StreamResources for TestProducer {
        fn release(self: Box<Self>) -> Vec<String> {
            let errors = shared_texture::release_pool(&self.client, &self.slots);
            let gpu = self.gpu.clone();
            drop(self);
            // D3D11 延迟销毁：释放的纹理要等立即上下文下一次 Flush 才真正归还显存。
            gpu.flush();
            errors
        }
    }

    impl TestProducer {
        pub fn create(gpu: Arc<GpuDevice>, client: Arc<ClientProcess>, options: &TestStreamOptions) -> Result<Self, String> {
            let layout = PatternLayout::new(options.width, options.height);
            let template_planes = encode(options.format, options.width, options.height, |x, y| layout.template_pixel(x, y));
            let block_planes = encode(options.format, layout.block, layout.block, |_, _| [1.0, 1.0, 1.0, 1.0]);
            let (template, white_block, query) = {
                let context = gpu.context.lock().unwrap();
                let template = shared_texture::upload(&gpu.device, &context, options.format, options.width, options.height, &template_planes)?;
                let white_block = shared_texture::upload(&gpu.device, &context, options.format, layout.block, layout.block, &block_planes)?;
                let mut query = None;
                unsafe { gpu.device.CreateQuery(&D3D11_QUERY_DESC { Query: D3D11_QUERY_EVENT, MiscFlags: 0 }, Some(&mut query)) }.map_err(|error| format!("创建同步查询失败：{error}"))?;
                (template, white_block, query.ok_or("CreateQuery 未返回对象")?)
            };
            let slots = shared_texture::create_pool(&gpu.device, &client, options.format, options.width, options.height, options.pool_size, options.keyed_mutex)?;
            Ok(Self { gpu, client, slots, template, white_block, query, layout })
        }

        pub fn remote_handles(&self) -> Vec<u64> {
            self.slots.iter().map(|slot| slot.remote_handle).collect()
        }

        /// 写入一帧：复制模板，再按帧号盖白色位块。等待显卡完成写入后才返回，保证客户端读到完整画面。
        fn render(&self, slot: &SharedSlot, frame_index: u64) -> Result<(), String> {
            if let Some(mutex) = &slot.keyed_mutex {
                // 先等互斥体再取上下文锁，等待期间不阻塞其他流。
                // windows-rs 把 WAIT_TIMEOUT 这类成功码当作 Ok，需直接看 HRESULT。
                let result = unsafe { (Interface::vtable(mutex).AcquireSync)(Interface::as_raw(mutex), 0, KEYED_MUTEX_TIMEOUT_MS) };
                if result.0 == WAIT_TIMEOUT.0 as i32 {
                    return Err("等待键控互斥体超时".into());
                }
                result.ok().map_err(|error| format!("获取键控互斥体失败：{error}"))?;
            }
            let context = self.gpu.context.lock().unwrap();
            unsafe {
                context.CopyResource(&slot.texture, &self.template);
                for bit in 0..BIT_COUNT {
                    if (frame_index >> bit) & 1 == 1 {
                        context.CopySubresourceRegion(&slot.texture, 0, self.layout.bit_x(bit), self.layout.bits_top, 0, &self.white_block, 0, None);
                    }
                }
            }
            if let Some(mutex) = &slot.keyed_mutex {
                unsafe { mutex.ReleaseSync(0) }.map_err(|error| format!("释放键控互斥体失败：{error}"))?;
                unsafe { context.Flush() };
                return Ok(());
            }
            // 无键控互斥体：用事件查询等待本设备写入完成，再通知客户端。
            unsafe {
                context.End(&self.query);
                context.Flush();
            }
            drop(context);
            let deadline = Instant::now() + Duration::from_millis(1000);
            loop {
                let mut done = windows::core::BOOL(0);
                let context = self.gpu.context.lock().unwrap();
                let _ = unsafe { context.GetData(&self.query, Some(&mut done as *mut _ as *mut _), std::mem::size_of::<windows::core::BOOL>() as u32, D3D11_ASYNC_GETDATA_DONOTFLUSH.0 as u32) };
                drop(context);
                if done.as_bool() {
                    return Ok(());
                }
                if Instant::now() > deadline {
                    return Err("等待显卡写入完成超时".into());
                }
                std::thread::yield_now();
            }
        }

        pub fn run(self, options: &TestStreamOptions, control: &StreamControl) -> Self {
            let gate = Instant::now() + Duration::from_secs(5);
            while !control.active.load(Ordering::Acquire) && !control.stop.load(Ordering::Relaxed) && Instant::now() < gate {
                std::thread::sleep(Duration::from_micros(200));
            }
            let period = Duration::from_secs_f64(1.0 / options.fps);
            let started = Instant::now();
            let mut reason = "completed";
            let mut failure: Option<String> = None;
            let mut frame_index: u64 = 0;
            loop {
                if control.stop.load(Ordering::Relaxed) {
                    reason = "stopped";
                    break;
                }
                if options.max_frames.is_some_and(|max| frame_index >= max) {
                    break;
                }
                let due = started + period.mul_f64(frame_index as f64);
                let now = Instant::now();
                if due > now {
                    std::thread::sleep(due - now);
                }
                let timestamp_us = (frame_index as f64 * 1_000_000.0 / options.fps).round() as i64;
                match control.slots.acquire() {
                    None => {
                        control.counters.skipped.fetch_add(1, Ordering::Relaxed);
                    }
                    Some(slot) => {
                        let render_started = Instant::now();
                        if let Err(message) = self.render(&self.slots[slot as usize], frame_index) {
                            control.slots.release(slot);
                            reason = "error";
                            failure = Some(message);
                            break;
                        }
                        control.counters.render_us.fetch_add(render_started.elapsed().as_micros() as u64, Ordering::Relaxed);
                        control.counters.produced.fetch_add(1, Ordering::Relaxed);
                        crate::send(&frame_event(&options.stream_id, slot, frame_index, timestamp_us));
                    }
                }
                frame_index += 1;
            }
            let counters = counters_value(control);
            if let Some(message) = &failure {
                logging::error("stream.failed", message, json!({ "streamId": options.stream_id, "frameIndex": frame_index }));
            }
            logging::info("stream.ended", "帧流已结束", json!({ "streamId": options.stream_id, "reason": reason, "counters": counters }));
            // 主动停止时客户端已不再关心该流，不再发事件。
            if reason != "stopped" {
                crate::send(&json!({ "event": "stream_ended", "streamId": options.stream_id, "reason": reason, "message": failure, "counters": counters }));
            }
            self
        }
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
