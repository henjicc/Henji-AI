//! Windows 平台层：D3D11 设备（`device`）、FFmpeg D3D11VA 硬件设备（`d3d11va`）、NT 句柄共享纹理池
//! （`shared_texture`）、HLSL 计算着色器格式转换（`convert`）与合成测试画面流（`test_stream`）。
//! 对外只经 `platform::VideoPlatform` / `FrameOutput` 接口暴露。

mod convert;
mod d3d11va;
mod device;
mod shared_texture;
mod test_stream;

use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};

use ffmpeg_sys_next as ff;
use serde_json::Value;
use windows::Win32::Graphics::Direct3D11::{ID3D11Query, D3D11_ASYNC_GETDATA_DONOTFLUSH, D3D11_QUERY_DESC, D3D11_QUERY_EVENT};

use super::{FrameOutput, HardwareDevice, TestStream, VideoPlatform, WriteStats};
use crate::convert::{ColorInfo, WritePath};
use crate::streams::{StreamControl, StreamResources, TestStreamOptions};
use crate::test_pattern::SharedFormat;
use convert::Converter;
use device::GpuDevice;
use shared_texture::{ClientProcess, SharedSlot};

pub use shared_texture::{process_memory, process_usage};

pub struct WindowsPlatform {
    gpu: Arc<GpuDevice>,
    client: RwLock<Option<Arc<ClientProcess>>>,
}

impl WindowsPlatform {
    pub fn create() -> Result<Self, String> {
        Ok(Self { gpu: Arc::new(device::create_device()?), client: RwLock::new(None) })
    }

    fn client(&self) -> Result<Arc<ClientProcess>, String> {
        self.client.read().unwrap().clone().ok_or_else(|| "尚未登记客户端进程，无法共享纹理".to_string())
    }
}

impl VideoPlatform for WindowsPlatform {
    fn summary(&self) -> Value {
        self.gpu.summary.clone()
    }

    fn register_client(&self, pid: u32) -> Result<(), String> {
        if self.client.read().unwrap().as_ref().is_some_and(|client| client.pid == pid) {
            return Ok(());
        }
        let client = ClientProcess::open(pid)?;
        *self.client.write().unwrap() = Some(Arc::new(client));
        Ok(())
    }

    fn client_ready(&self) -> bool {
        self.client.read().unwrap().is_some()
    }

    fn close_client_handle(&self, handle: u64) -> Result<(), String> {
        self.client()?.close_remote(handle)
    }

    fn local_memory(&self) -> Option<(u64, u64)> {
        self.gpu.local_memory()
    }

    fn device_lost(&self) -> Option<String> {
        self.gpu.removed_reason()
    }

    fn hardware_device(&self) -> Result<HardwareDevice, String> {
        let device = self.gpu.hw_device.get_or_init(|| d3d11va::create(&self.gpu)).as_ref().map_err(Clone::clone)?;
        Ok(HardwareDevice { device_type: ff::AVHWDeviceType::AV_HWDEVICE_TYPE_D3D11VA, reference: device.new_reference() })
    }

    fn has_decoder_profile(&self, name: &str) -> bool {
        self.gpu.has_decoder_profile(name)
    }

    fn create_frame_output(&self, format: SharedFormat, pool: (u32, u32), visible: (u32, u32), count: u32) -> Result<Box<dyn FrameOutput>, String> {
        let client = self.client()?;
        let slots = shared_texture::create_pool(&self.gpu.device, &client, format, pool.0, pool.1, count, true)?;
        Ok(Box::new(WindowsFrameOutput { converter: Converter::new(self.gpu.clone(), pool, visible), pool: PoolResources { gpu: self.gpu.clone(), client, slots }, queries: std::array::from_fn(|_| None), marks: std::collections::VecDeque::new() }))
    }

    fn start_test_stream(&self, options: &TestStreamOptions, control: Arc<StreamControl>) -> Result<TestStream, String> {
        test_stream::start(self.gpu.clone(), self.client()?, options, control)
    }
}

/// 会话结束后交回的纹理池（`stop_stream` 时远程关闭句柄）。
struct PoolResources {
    gpu: Arc<GpuDevice>,
    client: Arc<ClientProcess>,
    slots: Vec<SharedSlot>,
}

unsafe impl Send for PoolResources {}

impl StreamResources for PoolResources {
    fn release(self: Box<Self>) -> Vec<String> {
        let errors = shared_texture::release_pool(&self.client, &self.slots);
        let gpu = self.gpu.clone();
        drop(self);
        // D3D11 延迟销毁：释放的纹理要等立即上下文下一次 Flush 才真正归还显存。
        gpu.flush();
        errors
    }
}

struct WindowsFrameOutput {
    converter: Converter,
    pool: PoolResources,
    /// `settle` / `pace` 用的事件查询（首次需要时创建）：下标 0 给 `settle`，其余给 `pace` 轮流使用。
    queries: [Option<ID3D11Query>; 1 + PACE_LAG + 1],
    /// `pace` 已标记、尚未等过的查询下标（最老的在前）；`settle` 等完全部工作后清空。
    marks: std::collections::VecDeque<usize>,
}

/// `pace` 允许落后的交出标记数：交出第 N 帧前等第 N−1 帧的交出点（3.8）。实测放宽到 N−2 时拖动最大间隔由 22–27ms
/// 回到 30–39ms，首帧也没有变快，故只落后一帧。
const PACE_LAG: usize = 1;

// 只在会话线程里使用；查询对象不跨线程共享（同 `Converter`）。
unsafe impl Send for WindowsFrameOutput {}

impl WindowsFrameOutput {
    fn query(&mut self, index: usize) -> Result<ID3D11Query, String> {
        if let Some(query) = &self.queries[index] {
            return Ok(query.clone());
        }
        let mut query = None;
        unsafe { self.pool.gpu.device.CreateQuery(&D3D11_QUERY_DESC { Query: D3D11_QUERY_EVENT, MiscFlags: 0 }, Some(&mut query)) }.map_err(|error| format!("创建同步查询失败：{error}"))?;
        let query = query.ok_or("CreateQuery 未返回对象")?;
        self.queries[index] = Some(query.clone());
        Ok(query)
    }

    /// 在立即上下文末尾放事件查询并提交：显卡执行到它时，此前提交到本设备的工作（解码、写入共享纹理）都已完成。
    fn mark(&self, query: &ID3D11Query) {
        let context = self.pool.gpu.lock();
        unsafe {
            context.End(query);
            context.Flush();
        }
    }

    /// 轮询到显卡执行过 `query`。
    fn wait(&self, query: &ID3D11Query, started: Instant, timeout: Duration) -> Result<(), String> {
        let deadline = started + timeout;
        loop {
            let mut done = windows::core::BOOL(0);
            {
                // 立即上下文不是线程安全的：每次查询都取锁，等待期间不占锁，其他会话照常提交。
                let context = self.pool.gpu.lock();
                let _ = unsafe { context.GetData(query, Some(&mut done as *mut _ as *mut _), std::mem::size_of::<windows::core::BOOL>() as u32, D3D11_ASYNC_GETDATA_DONOTFLUSH.0 as u32) };
            }
            if done.as_bool() {
                return Ok(());
            }
            if Instant::now() > deadline {
                return Err("等待显卡完成超时".into());
            }
            // 先让出时间片；超过 1ms 的等待（解码器刚建立、长 GOP 定位）改为短睡眠，不空转占满一个核。
            if started.elapsed() < Duration::from_millis(1) {
                std::thread::yield_now();
            } else {
                std::thread::sleep(Duration::from_micros(250));
            }
        }
    }
}

impl FrameOutput for WindowsFrameOutput {
    fn remote_handles(&self) -> Vec<u64> {
        self.pool.slots.iter().map(|slot| slot.remote_handle).collect()
    }

    unsafe fn write(&mut self, frame: *const ff::AVFrame, slot: u32, path: WritePath, color: &ColorInfo, premultiplied: bool) -> Result<WriteStats, String> {
        let target = self.pool.slots.get(slot as usize).ok_or_else(|| format!("槽位 {slot} 不存在"))?;
        unsafe { self.converter.write(frame, target, path, color, premultiplied) }
    }

    fn settle(&mut self, timeout: Duration) -> Result<u64, String> {
        let started = Instant::now();
        let query = self.query(0)?;
        self.mark(&query);
        self.wait(&query, started, timeout)?;
        self.marks.clear();
        Ok(started.elapsed().as_micros() as u64)
    }

    fn pace(&mut self, timeout: Duration) -> Result<u64, String> {
        let started = Instant::now();
        while self.marks.len() >= PACE_LAG {
            let oldest = self.marks.pop_front().expect("长度已检查");
            let query = self.query(oldest)?;
            self.wait(&query, started, timeout)?;
        }
        // 下标 1..=PACE_LAG+1 轮流使用，跳过仍在等待的标记。
        let next = (1..=PACE_LAG + 1).find(|index| !self.marks.contains(index)).expect("标记数少于可用查询数");
        let query = self.query(next)?;
        self.mark(&query);
        self.marks.push_back(next);
        Ok(started.elapsed().as_micros() as u64)
    }

    fn cpu_fallback_used(&self) -> bool {
        self.converter.fallback_used
    }

    fn into_resources(self: Box<Self>) -> Box<dyn StreamResources> {
        let WindowsFrameOutput { converter, pool, queries, .. } = *self;
        drop(queries);
        drop(converter);
        Box::new(pool)
    }
}
