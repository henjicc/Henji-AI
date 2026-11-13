//! Windows.Graphics.Capture 采整块显示器。
//!
//! 做法对照 windows-capture 与 Cap 的 scap-direct3d（均为 MIT），按录制的需要取舍：
//! - 自由线程帧池：回调在系统线程池上跑，不需要消息循环，也不会被我们自己的线程卡住；
//! - 帧到达立刻在显卡上转成 NV12 画进自己的纹理，随即把采集帧还给系统——不拿着系统的帧等编码，帧池不会被占满；
//! - 每帧的时刻取 `SystemRelativeTime`（这一帧上屏的 QPC 时刻），不是到达进程的时刻；
//! - 光标不采进画面（由应用另记、事后叠加）。系统不支持关掉光标时直接报不支持，不悄悄把光标烧进去；
//! - 去掉黄色边框、限制最小更新间隔这两个属性只有新系统才有，有就设，没有就照常录（黄框只画在屏幕上，不进画面）。
//!
//! 来源出状况时（对照 OBS、WebRTC、Cap 的处理）：
//! - 单帧取不到或转换失败（显存一时紧张、接口偶发出错）：只丢这一张并计数；连着失败满一秒才当成来源丢了去重新接上；
//! - 显示器换分辨率：帧池按新尺寸重建，输出尺寸不变，转换时等比缩放留黑边；
//! - 显示器断开（采集项的 Closed 事件）：往收件箱报 `SOURCE_LOST`，核心每秒调 `reacquire`，
//!   按设备名（不是会变的显示器句柄）重新找到它后新建采集项接着采；
//! - 显卡设备被移除：系统的采集组件在这之后可能直接终止进程（Cap 的源码注释），所以一发现就报
//!   `DEVICE_REMOVED` 让核心收尾，不再把这个设备交回给采集接口。

use super::{
    convert::Converter,
    device::{find_display, Display, Gpu},
    encode::{HwContext, HwFrame},
    now_us, preview,
};
use crate::core::health::{Health, Inbox};
use crate::platform::Notify;
use serde_json::Value;
use std::sync::{
    atomic::{AtomicI64, Ordering},
    Arc, Mutex,
};
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
const SOURCE_LOST: &str = "SOURCE_LOST|正在录的显示器已断开，接回后继续";
const DEVICE_REMOVED: &str = "DEVICE_REMOVED|显卡设备已重置或被移除，已录部分保留";
/// 连着多久没有一帧成功才升级处理。
const ESCALATE_AFTER_US: i64 = 1_000_000;

/// 连续失败是从什么时刻开始的；0 表示上一帧是成功的。
#[derive(Default)]
struct FailureStreak(AtomicI64);

impl FailureStreak {
    fn succeeded(&self) {
        self.0.store(0, Ordering::Relaxed);
    }

    /// 记一次失败。连着失败满 `ESCALATE_AFTER_US` 时返回 true 并重新计时（升级之后还在失败，就再过这么久再升级一次）。
    fn failed(&self, now: i64) -> bool {
        let since = match self.0.compare_exchange(0, now, Ordering::Relaxed, Ordering::Relaxed) {
            Ok(_) => now,
            Err(since) => since,
        };
        if now - since < ESCALATE_AFTER_US {
            return false;
        }
        self.0.store(0, Ordering::Relaxed);
        true
    }
}

struct Shared {
    gpu: Arc<Gpu>,
    device: IDirect3DDevice,
    hw: Arc<HwContext>,
    converter: Converter,
    inbox: Arc<Inbox<Arc<HwFrame>>>,
    health: Arc<Health>,
    width: u32,
    height: u32,
    proxy: Option<(u32, u32)>,
    fps: u32,
    display_name: String,
    /// 帧池当前的尺寸；也用来让回调一次只跑一个。
    pool_size: Mutex<SizeInt32>,
    failing: FailureStreak,
    preview: Mutex<Option<preview::Preview>>,
}

// WinRT 的采集对象与 D3D 设备都是自由线程的。
unsafe impl Send for Shared {}
unsafe impl Sync for Shared {}

impl Shared {
    fn note_size(&self, size: SizeInt32) {
        self.health.source_size.store((size.Width.max(0) as u64) << 32 | size.Height.max(0) as u64, Ordering::Relaxed);
    }

    fn on_frame(&self, pool: &Direct3D11CaptureFramePool) {
        let mut pool_size = self.pool_size.lock().unwrap();
        loop {
            // 没有帧时返回空对象（表现为错误码为成功的 Err）。
            let frame = match pool.TryGetNextFrame() {
                Ok(frame) => frame,
                Err(error) if error.code().is_err() => return self.frame_failed(),
                Err(_) => return,
            };
            let arrived = now_us();
            let content = frame.ContentSize().unwrap_or(*pool_size);
            if content.Width != pool_size.Width || content.Height != pool_size.Height {
                // 显示器换了分辨率：这一帧的缓冲还是旧尺寸、内容已是新尺寸，画出来是错的，不用它；
                // 帧池按新尺寸重建，从下一帧起用（输出尺寸不变，转换时等比缩放）。
                let _ = frame.Close();
                // 设备已经没了就不能再重建帧池：系统的采集组件会在别的线程上直接终止进程。
                if self.gpu.removed() {
                    return self.inbox.fail(DEVICE_REMOVED.into());
                }
                match pool.Recreate(&self.device, PIXEL_FORMAT, POOL_BUFFERS, content) {
                    Ok(()) => {
                        *pool_size = content;
                        self.note_size(content);
                    }
                    // 设备还在、帧池建不起来：当成来源丢了，由核心重新接上。
                    Err(_) => return self.inbox.fail(SOURCE_LOST.into()),
                }
                continue;
            }
            let injected = self.health.inject_frame_failures.try_update(Ordering::Relaxed, Ordering::Relaxed, |left| left.checked_sub(1)).is_ok();
            let converted = if injected {
                Err(windows::core::Error::from(windows::Win32::Foundation::E_FAIL))
            } else {
                (|| -> windows::core::Result<(i64, HwFrame)> {
                    let source_us = frame.SystemRelativeTime()?.Duration / 10;
                    let access: IDirect3DDxgiInterfaceAccess = frame.Surface()?.cast()?;
                    let texture: ID3D11Texture2D = unsafe { access.GetInterface()? };
                    let output = self.hw.frame().map_err(|message| windows::core::Error::new(windows::Win32::Foundation::E_FAIL, message))?;
                    output.with_textures(|main, proxy| {
                        self.converter.convert(&self.gpu, &texture, main, self.width, self.height)?;
                        match (proxy, self.proxy) {
                            (Some(proxy), Some((width, height))) => self.converter.convert(&self.gpu, &texture, proxy, width, height),
                            _ => Ok(()),
                        }
                    })?;
                    // 预览是顺带的：出错只停预览，不影响录制。
                    let mut preview = self.preview.lock().unwrap();
                    if preview.as_mut().is_some_and(|preview| preview.offer(&self.gpu, &self.converter, &texture, source_us).is_err()) {
                        *preview = None;
                    }
                    Ok((source_us, output))
                })()
            };
            let _ = frame.Close();
            match converted {
                Ok((source_us, output)) => {
                    self.failing.succeeded();
                    self.inbox.push(&self.health, source_us, arrived, Arc::new(output));
                    Health::raise(&self.health.capture_max_us, (now_us() - arrived).max(0) as u64);
                }
                Err(_) => self.frame_failed(),
            }
        }
    }

    /// 一帧没取到或没转成（显存一时紧张、系统接口偶发出错）：只丢这一张并计数，网格会重复上一帧。
    /// 连着失败满一秒才升级：设备没了就收尾，否则当成来源丢了，由核心把采集重新接上。
    fn frame_failed(&self) {
        if self.gpu.removed() {
            return self.inbox.fail(DEVICE_REMOVED.into());
        }
        self.health.capture_failed.fetch_add(1, Ordering::Relaxed);
        if self.failing.failed(now_us()) {
            self.inbox.fail("SOURCE_LOST|画面采集连续出错，正在重新接上".into());
        }
    }
}

/// 正在跑的一次系统采集；放下即停。
struct Running {
    session: GraphicsCaptureSession,
    pool: Direct3D11CaptureFramePool,
    item: GraphicsCaptureItem,
    frame_token: i64,
    closed_token: i64,
}

impl Drop for Running {
    fn drop(&mut self) {
        let _ = self.pool.RemoveFrameArrived(self.frame_token);
        let _ = self.item.RemoveClosed(self.closed_token);
        let _ = self.session.Close();
        let _ = self.pool.Close();
    }
}

pub struct Capture {
    shared: Arc<Shared>,
    running: Mutex<Option<Running>>,
    pub gpu: Arc<Gpu>,
}

unsafe impl Send for Capture {}

pub fn supported() -> bool {
    GraphicsCaptureSession::IsSupported().unwrap_or(false)
}

fn has_session_property(name: &windows::core::HSTRING) -> bool {
    ApiInformation::IsPropertyPresent(h!("Windows.Graphics.Capture.GraphicsCaptureSession"), name).unwrap_or(false)
}

fn run(shared: &Arc<Shared>, display: &Display) -> Result<Running, String> {
    let failed = |error: windows::core::Error| format!("CAPTURE_FAILED|无法开始采集显示器：{error}");
    unsafe {
        let interop = windows::core::factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>().map_err(failed)?;
        let item: GraphicsCaptureItem = interop.CreateForMonitor(display.handle).map_err(|error| format!("SOURCE_MISSING|无法采集这块显示器：{error}"))?;
        let size = item.Size().map_err(failed)?;
        let pool = Direct3D11CaptureFramePool::CreateFreeThreaded(&shared.device, PIXEL_FORMAT, POOL_BUFFERS, size).map_err(failed)?;
        let session = pool.CreateCaptureSession(&item).map_err(failed)?;
        // 标定用：让系统把光标合成进画面，量“光标位置进画面”比帧的上屏时刻早多少（selftest 的 flash --cursor）。
        let calibrating = std::env::var("HENJI_SCREEN_CAPTURE_CALIBRATE_CURSOR").is_ok_and(|value| value == "1");
        if !has_session_property(h!("IsCursorCaptureEnabled")) || session.SetIsCursorCaptureEnabled(calibrating).is_err() {
            return Err("CAPTURE_UNSUPPORTED|此系统无法在采集时去掉光标（需要 Windows 10 2004 或更新），请用现有录法".into());
        }
        if has_session_property(h!("IsBorderRequired")) {
            let _ = session.SetIsBorderRequired(false);
        }
        if has_session_property(h!("MinUpdateInterval")) {
            // 设成正好一帧会少帧（60Hz 屏只拿到约 45 帧）；留一成余量，多出的帧由网格取舍。
            let _ = session.SetMinUpdateInterval(TimeSpan { Duration: 9_000_000 / shared.fps.max(1) as i64 });
        }
        *shared.pool_size.lock().unwrap() = size;
        shared.note_size(size);
        let frames = shared.clone();
        let frame_token = pool
            .FrameArrived(&TypedEventHandler::<Direct3D11CaptureFramePool, IInspectable>::new(move |pool, _| {
                if let Some(pool) = pool.as_ref() {
                    frames.on_frame(pool);
                }
                Ok(())
            }))
            .map_err(failed)?;
        let inbox = shared.inbox.clone();
        let closed_token = item
            .Closed(&TypedEventHandler::<GraphicsCaptureItem, IInspectable>::new(move |_, _| {
                inbox.fail(SOURCE_LOST.into());
                Ok(())
            }))
            .map_err(failed)?;
        session.StartCapture().map_err(failed)?;
        Ok(Running { session, pool, item, frame_token, closed_token })
    }
}

#[allow(clippy::too_many_arguments)]
pub fn start(
    gpu: Arc<Gpu>,
    display: &Display,
    hw: Arc<HwContext>,
    converter: Converter,
    size: (u32, u32),
    proxy: Option<(u32, u32)>,
    fps: u32,
    inbox: Arc<Inbox<Arc<HwFrame>>>,
    health: Arc<Health>,
) -> Result<Capture, String> {
    let failed = |error: windows::core::Error| format!("CAPTURE_FAILED|无法开始采集显示器：{error}");
    if !supported() {
        return Err("CAPTURE_UNSUPPORTED|此系统不支持新的录屏方式（需要 Windows 10 2004 或更新），请用现有录法".into());
    }
    let device: IDirect3DDevice = unsafe {
        let dxgi: IDXGIDevice = gpu.device.cast().map_err(failed)?;
        CreateDirect3D11DeviceFromDXGIDevice(&dxgi).and_then(|inspectable: IInspectable| inspectable.cast()).map_err(failed)?
    };
    let shared = Arc::new(Shared {
        gpu: gpu.clone(),
        device,
        hw,
        converter,
        inbox,
        health,
        width: size.0,
        height: size.1,
        proxy,
        fps,
        display_name: display.device_name.clone(),
        pool_size: Mutex::new(SizeInt32::default()),
        failing: FailureStreak::default(),
        preview: Mutex::new(None),
    });
    let running = run(&shared, display)?;
    Ok(Capture { shared, running: Mutex::new(Some(running)), gpu })
}

impl Capture {
    /// 显示器回来了没有：按设备名找，找到就新建采集项接着采。
    pub fn reacquire(&mut self) -> Result<bool, String> {
        if self.gpu.removed() {
            return Err(DEVICE_REMOVED.into());
        }
        let Ok(display) = find_display(Some(&self.shared.display_name), None) else { return Ok(false) };
        let mut running = self.running.lock().unwrap();
        // 先放下旧的采集，再开新的。
        *running = None;
        match run(&self.shared, &display) {
            Ok(started) => {
                *running = Some(started);
                Ok(true)
            }
            // 刚接回的显示器可能还没准备好：下一轮再试。
            Err(_) => Ok(false),
        }
    }

    pub fn simulate_source_lost(&self) {
        let stopped = self.running.lock().unwrap().take();
        drop(stopped);
        self.shared.inbox.fail(SOURCE_LOST.into());
    }

    /// 把帧池换成一半大小：下一张来源帧的内容尺寸与帧池对不上，走的就是显示器换分辨率时的那条路（丢掉这一帧、按内容尺寸重建帧池）。
    pub fn simulate_resize(&self) {
        let running = self.running.lock().unwrap();
        let Some(running) = running.as_ref() else { return };
        // 占着回调也要用的这把锁换：回调要么在换之前跑完，要么在换之后看到新的尺寸。
        let mut pool_size = self.shared.pool_size.lock().unwrap();
        let half = SizeInt32 { Width: (pool_size.Width / 2).max(2), Height: (pool_size.Height / 2).max(2) };
        if running.pool.Recreate(&self.shared.device, PIXEL_FORMAT, POOL_BUFFERS, half).is_ok() {
            *pool_size = half;
            self.shared.note_size(half);
        }
    }

    pub fn start_preview(&self, request: &Value, notify: Notify) -> Result<Value, String> {
        let size = *self.shared.pool_size.lock().unwrap();
        let (created, description) = preview::Preview::create(&self.gpu, request, (size.Width.max(2) as u32, size.Height.max(2) as u32), notify)?;
        // 已经开着预览时再开（界面重载后重新要）：旧的先从锁里换出来，出了锁再放下，
        // 放下显卡对象要等设备的锁，不能同时占着回调也要用的这把锁。
        let previous = self.shared.preview.lock().unwrap().replace(created);
        drop(previous);
        Ok(description)
    }

    pub fn stop_preview(&self) {
        // 先从锁里取出来再放下：放下显卡对象要等设备的锁，不能同时占着回调也要用的这把锁。
        let taken = self.shared.preview.lock().unwrap().take();
        drop(taken);
    }
}

impl Drop for Capture {
    fn drop(&mut self) {
        let stopped = self.running.lock().unwrap().take();
        drop(stopped);
        self.stop_preview();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 锁屏、显存一时紧张这类情况下取帧会连着失败：零星的不升级，连着满一秒才升级，升级后重新计时。
    #[test]
    fn frame_failures_escalate_only_after_a_full_second_without_a_good_frame() {
        let streak = FailureStreak::default();
        let start = 5_000_000;
        assert!(!streak.failed(start));
        assert!(!streak.failed(start + 600_000));
        // 中间成功过一张：重新计时。
        streak.succeeded();
        assert!(!streak.failed(start + 900_000));
        assert!(!streak.failed(start + 1_800_000));
        assert!(streak.failed(start + 1_900_000));
        // 升级之后还在失败：再过一秒才再升级一次，不是每一张都升级。
        assert!(!streak.failed(start + 1_950_000));
        assert!(!streak.failed(start + 2_900_000));
        assert!(streak.failed(start + 2_950_000));
    }
}
