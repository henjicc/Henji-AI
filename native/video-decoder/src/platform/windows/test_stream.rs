//! 合成测试画面流（1.2 纹理通道验证，Windows 平台层）：每流一个纹理池与生产线程，按帧率复制模板并盖帧号。
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde_json::json;

use super::device::GpuDevice;
use super::shared_texture::{self, ClientProcess, SharedSlot};
use crate::logging;
use crate::platform::TestStream;
use crate::streams::{counters_value, frame_event, StreamControl, StreamResources, TestStreamOptions};
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
            let context = gpu.lock();
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
        let context = self.gpu.lock();
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
            let context = self.gpu.lock();
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

/// 创建纹理池与模板并启动生产线程。
pub fn start(gpu: Arc<GpuDevice>, client: Arc<ClientProcess>, options: &TestStreamOptions, control: Arc<StreamControl>) -> Result<TestStream, String> {
    let producer = TestProducer::create(gpu, client, options)?;
    let handles = producer.remote_handles();
    let layout = producer.layout.describe();
    let thread_options = options.clone();
    let thread = std::thread::Builder::new()
        .name(format!("stream-{}", options.stream_id))
        .spawn(move || -> Box<dyn StreamResources> { Box::new(producer.run(&thread_options, &control)) })
        .map_err(|error| format!("无法启动流线程：{error}"))?;
    Ok(TestStream { thread, handles, layout })
}
