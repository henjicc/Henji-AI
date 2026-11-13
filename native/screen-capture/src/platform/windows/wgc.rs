//! Windows.Graphics.Capture 采整块显示器。
//!
//! 做法对照 windows-capture 与 Cap 的 scap-direct3d（均为 MIT），按录制的需要取舍：
//! - 自由线程帧池：回调在系统线程池上跑，不需要消息循环，也不会被我们自己的线程卡住；
//! - 帧到达立刻在显卡上转成 NV12 画进自己的纹理，随即把采集帧还给系统——不拿着系统的帧等编码，帧池不会被占满；
//! - 每帧的时刻取 `SystemRelativeTime`（合成器渲染这一帧时的 QPC），不是到达进程的时刻；
//! - 光标不采进画面（由应用另记、事后叠加）。系统不支持关掉光标时直接报不支持，不悄悄把光标烧进去；
//! - 去掉黄色边框、限制最小更新间隔这两个属性只有新系统才有，有就设，没有就照常录（黄框只画在屏幕上，不进画面）。

use super::{
    convert::Converter,
    device::{Display, Gpu},
    encode::{HwContext, HwFrame},
    now_us,
};
use crate::core::health::{Health, Inbox};
use std::sync::{Arc, Mutex};
use windows::core::{h, IInspectable, Interface};
use windows::Foundation::{Metadata::ApiInformation, TimeSpan, TypedEventHandler};
use windows::Graphics::Capture::{Direct3D11CaptureFramePool, GraphicsCaptureItem, GraphicsCaptureSession};
use windows::Graphics::DirectX::{Direct3D11::IDirect3DDevice, DirectXPixelFormat};
use windows::Graphics::SizeInt32;
use windows::Win32::Graphics::Direct3D11::ID3D11Texture2D;
use windows::Win32::Graphics::Dxgi::IDXGIDevice;
use windows::Win32::System::WinRT::Direct3D11::{CreateDirect3D11DeviceFromDXGIDevice, IDirect3DDxgiInterfaceAccess};
use windows::Win32::System::WinRT::Graphics::Capture::IGraphicsCaptureItemInterop;

/// 帧池缓冲数：帧到达即转换归还，留三张足够吸收回调的短暂延迟。
const POOL_BUFFERS: i32 = 3;
const PIXEL_FORMAT: DirectXPixelFormat = DirectXPixelFormat::B8G8R8A8UIntNormalized;

struct Shared {
    gpu: Arc<Gpu>,
    device: IDirect3DDevice,
    hw: Arc<HwContext>,
    converter: Converter,
    inbox: Arc<Inbox<HwFrame>>,
    health: Arc<Health>,
    width: u32,
    height: u32,
    /// 帧池当前的尺寸；也用来让回调一次只跑一个。
    pool_size: Mutex<SizeInt32>,
}

// WinRT 的采集对象与 D3D 设备都是自由线程的。
unsafe impl Send for Shared {}
unsafe impl Sync for Shared {}

impl Shared {
    fn on_frame(&self, pool: &Direct3D11CaptureFramePool) {
        let mut pool_size = self.pool_size.lock().unwrap();
        loop {
            // 没有帧时返回空对象（表现为错误码为成功的 Err）。
            let frame = match pool.TryGetNextFrame() {
                Ok(frame) => frame,
                Err(error) if error.code().is_err() => return self.fail(&error),
                Err(_) => return,
            };
            let arrived = now_us();
            let converted = (|| -> windows::core::Result<(i64, SizeInt32, HwFrame)> {
                let source_us = frame.SystemRelativeTime()?.Duration / 10;
                let content = frame.ContentSize()?;
                let access: IDirect3DDxgiInterfaceAccess = frame.Surface()?.cast()?;
                let texture: ID3D11Texture2D = unsafe { access.GetInterface()? };
                let output = self.hw.frame().map_err(|message| windows::core::Error::new(windows::Win32::Foundation::E_FAIL, message))?;
                output.with_texture(|target| self.converter.convert(&self.gpu, &texture, target, self.width, self.height))?;
                Ok((source_us, content, output))
            })();
            let _ = frame.Close();
            match converted {
                Ok((source_us, content, output)) => {
                    self.inbox.push(&self.health, source_us, arrived, output);
                    Health::raise(&self.health.capture_max_us, (now_us() - arrived).max(0) as u64);
                    // 显示器换了分辨率：帧池按新尺寸重建，输出尺寸不变（转换时等比缩放）。
                    if content.Width != pool_size.Width || content.Height != pool_size.Height {
                        match pool.Recreate(&self.device, PIXEL_FORMAT, POOL_BUFFERS, content) {
                            Ok(()) => *pool_size = content,
                            Err(error) => return self.fail(&error),
                        }
                    }
                }
                Err(error) => return self.fail(&error),
            }
        }
    }

    fn fail(&self, error: &windows::core::Error) {
        self.inbox.fail(if self.gpu.removed() {
            "DEVICE_REMOVED|显卡设备已重置或被移除，已录部分保留".to_string()
        } else {
            format!("CAPTURE_FAILED|画面采集出错，已录部分保留：{error}")
        });
    }
}

pub struct Capture {
    session: GraphicsCaptureSession,
    pool: Direct3D11CaptureFramePool,
    item: GraphicsCaptureItem,
    frame_token: i64,
    closed_token: i64,
    pub gpu: Arc<Gpu>,
}

unsafe impl Send for Capture {}

pub fn supported() -> bool {
    GraphicsCaptureSession::IsSupported().unwrap_or(false)
}

fn has_session_property(name: &windows::core::HSTRING) -> bool {
    ApiInformation::IsPropertyPresent(h!("Windows.Graphics.Capture.GraphicsCaptureSession"), name).unwrap_or(false)
}

#[allow(clippy::too_many_arguments)]
pub fn start(gpu: Arc<Gpu>, display: &Display, hw: Arc<HwContext>, converter: Converter, width: u32, height: u32, fps: u32, inbox: Arc<Inbox<HwFrame>>, health: Arc<Health>) -> Result<Capture, String> {
    let failed = |error: windows::core::Error| format!("CAPTURE_FAILED|无法开始采集显示器：{error}");
    if !supported() {
        return Err("CAPTURE_UNSUPPORTED|此系统不支持新的录屏方式（需要 Windows 10 2004 或更新），请用现有录法".into());
    }
    unsafe {
        let dxgi: IDXGIDevice = gpu.device.cast().map_err(failed)?;
        let device: IDirect3DDevice = CreateDirect3D11DeviceFromDXGIDevice(&dxgi).and_then(|inspectable: IInspectable| inspectable.cast()).map_err(failed)?;
        let interop = windows::core::factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>().map_err(failed)?;
        let item: GraphicsCaptureItem = interop.CreateForMonitor(display.handle).map_err(|error| format!("SOURCE_MISSING|无法采集这块显示器：{error}"))?;
        let size = item.Size().map_err(failed)?;
        let pool = Direct3D11CaptureFramePool::CreateFreeThreaded(&device, PIXEL_FORMAT, POOL_BUFFERS, size).map_err(failed)?;
        let session = pool.CreateCaptureSession(&item).map_err(failed)?;
        if !has_session_property(h!("IsCursorCaptureEnabled")) || session.SetIsCursorCaptureEnabled(false).is_err() {
            return Err("CAPTURE_UNSUPPORTED|此系统无法在采集时去掉光标（需要 Windows 10 2004 或更新），请用现有录法".into());
        }
        if has_session_property(h!("IsBorderRequired")) {
            let _ = session.SetIsBorderRequired(false);
        }
        if has_session_property(h!("MinUpdateInterval")) {
            // 设成正好一帧会少帧（60Hz 屏只拿到约 45 帧）；留一成余量，多出的帧由网格取舍。
            let _ = session.SetMinUpdateInterval(TimeSpan { Duration: 9_000_000 / fps.max(1) as i64 });
        }
        let shared = Arc::new(Shared { gpu: gpu.clone(), device, hw, converter, inbox: inbox.clone(), health, width, height, pool_size: Mutex::new(size) });
        let frame_token = pool
            .FrameArrived(&TypedEventHandler::<Direct3D11CaptureFramePool, IInspectable>::new(move |pool, _| {
                if let Some(pool) = pool.as_ref() {
                    shared.on_frame(pool);
                }
                Ok(())
            }))
            .map_err(failed)?;
        let closed_token = item
            .Closed(&TypedEventHandler::<GraphicsCaptureItem, IInspectable>::new(move |_, _| {
                inbox.fail("SOURCE_LOST|正在录的显示器已断开，已录部分保留".into());
                Ok(())
            }))
            .map_err(failed)?;
        session.StartCapture().map_err(failed)?;
        Ok(Capture { session, pool, item, frame_token, closed_token, gpu })
    }
}

impl Drop for Capture {
    fn drop(&mut self) {
        let _ = self.pool.RemoveFrameArrived(self.frame_token);
        let _ = self.item.RemoveClosed(self.closed_token);
        let _ = self.session.Close();
        let _ = self.pool.Close();
    }
}
