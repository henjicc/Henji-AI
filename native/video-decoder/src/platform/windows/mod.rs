//! Windows 平台层：D3D11 设备（`device`）、FFmpeg D3D11VA 硬件设备（`d3d11va`）、NT 句柄共享纹理池
//! （`shared_texture`）、HLSL 计算着色器格式转换（`convert`）与合成测试画面流（`test_stream`）。
//! 对外只经 `platform::VideoPlatform` / `FrameOutput` 接口暴露。

mod convert;
mod d3d11va;
mod device;
mod shared_texture;
mod test_stream;

use std::sync::{Arc, RwLock};

use ffmpeg_sys_next as ff;
use serde_json::Value;

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
        Ok(Box::new(WindowsFrameOutput { converter: Converter::new(self.gpu.clone(), pool, visible), pool: PoolResources { gpu: self.gpu.clone(), client, slots } }))
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
}

impl FrameOutput for WindowsFrameOutput {
    fn remote_handles(&self) -> Vec<u64> {
        self.pool.slots.iter().map(|slot| slot.remote_handle).collect()
    }

    unsafe fn write(&mut self, frame: *const ff::AVFrame, slot: u32, path: WritePath, color: &ColorInfo, premultiplied: bool) -> Result<WriteStats, String> {
        let target = self.pool.slots.get(slot as usize).ok_or_else(|| format!("槽位 {slot} 不存在"))?;
        unsafe { self.converter.write(frame, target, path, color, premultiplied) }
    }

    fn cpu_fallback_used(&self) -> bool {
        self.converter.fallback_used
    }

    fn into_resources(self: Box<Self>) -> Box<dyn StreamResources> {
        let WindowsFrameOutput { converter, pool } = *self;
        drop(converter);
        Box::new(pool)
    }
}
