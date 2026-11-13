//! Windows 系统声：默认输出设备（eRender/eConsole，与 Chromium 的 loopback 相同）的 WASAPI 共享模式回环。
//! 采集的是整个系统混音，与原来界面里的采集一致，不按窗口或应用过滤。
use crate::system_audio::{Shared, Timeline, CHANNELS, IDLE_AFTER_US, IDLE_LAG_US};
use serde_json::json;
use std::{
    sync::{atomic::Ordering, mpsc, Arc},
    thread,
    time::{Duration, Instant},
};
use windows::{
    core::GUID,
    Win32::{
        Devices::FunctionDiscovery::PKEY_Device_FriendlyName,
        Media::Audio::*,
        System::Com::{
            CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize,
            StructuredStorage::{PropVariantClear, PropVariantToStringAlloc},
            CLSCTX_ALL, COINIT_MULTITHREADED, STGM_READ,
        },
    },
};

/// 共享模式缓冲 2 秒：采集线程偶尔被系统耽搁也不会让引擎丢包。
const BUFFER_HNS: i64 = 20_000_000;
/// 多久核对一次默认输出设备有没有换。
const DEVICE_CHECK: Duration = Duration::from_millis(200);
const RETRY: Duration = Duration::from_secs(1);
const KSDATAFORMAT_SUBTYPE_IEEE_FLOAT: GUID =
    GUID::from_u128(0x00000003_0000_0010_8000_00aa00389b71);
const WAVE_FORMAT_IEEE_FLOAT: u16 = 3;
const WAVE_FORMAT_EXTENSIBLE: u16 = 0xfffe;

struct Endpoint {
    client: IAudioClient,
    capture: IAudioCaptureClient,
    channels: usize,
    id: String,
    name: String,
    /// 开始后的第一个包总带“数据不连续”标记，不算缺口。
    fresh: bool,
    opened: Instant,
}
impl Drop for Endpoint {
    fn drop(&mut self) {
        unsafe {
            let _ = self.client.Stop();
        }
    }
}

unsafe fn default_device(enumerator: &IMMDeviceEnumerator) -> Option<(IMMDevice, String)> {
    let device = enumerator.GetDefaultAudioEndpoint(eRender, eConsole).ok()?;
    let raw = device.GetId().ok()?;
    let id = raw.to_string().unwrap_or_default();
    CoTaskMemFree(Some(raw.0 as _));
    Some((device, id))
}
unsafe fn friendly_name(device: &IMMDevice) -> String {
    let Ok(store) = device.OpenPropertyStore(STGM_READ) else {
        return String::new();
    };
    let Ok(mut value) = store.GetValue(&PKEY_Device_FriendlyName) else {
        return String::new();
    };
    let name = PropVariantToStringAlloc(&value)
        .map(|text| {
            let name = text.to_string().unwrap_or_default();
            CoTaskMemFree(Some(text.0 as _));
            name
        })
        .unwrap_or_default();
    let _ = PropVariantClear(&mut value);
    name
}
fn reason(error: &windows::core::Error) -> String {
    let code = error.code();
    if code == AUDCLNT_E_DEVICE_IN_USE {
        "输出设备被其他程序独占".into()
    } else if code == AUDCLNT_E_DEVICE_INVALIDATED {
        "输出设备已移除或格式已改变".into()
    } else if code == AUDCLNT_E_SERVICE_NOT_RUNNING {
        "Windows 音频服务没有运行".into()
    } else {
        format!("输出设备打开失败（0x{:08x}）", code.0 as u32)
    }
}

/// 打开默认输出设备的回环。`rate` 为空时用设备混音格式的采样率（整次采集的格式由第一台设备定）；
/// 之后换的设备由系统转换到同一格式，文件格式全程不变。
unsafe fn open(
    enumerator: &IMMDeviceEnumerator,
    rate: Option<u32>,
) -> Result<(Endpoint, u32), String> {
    let (device, id) = default_device(enumerator).ok_or("没有可用的声音输出设备")?;
    let name = friendly_name(&device);
    let activate = || -> Result<IAudioClient, String> {
        device
            .Activate::<IAudioClient>(CLSCTX_ALL, None)
            .map_err(|e| reason(&e))
    };
    let client = activate()?;
    let mix = client.GetMixFormat().map_err(|e| reason(&e))?;
    let mix_rate = (*mix).nSamplesPerSec;
    let mix_channels = (*mix).nChannels as usize;
    let mix_float = (*mix).wBitsPerSample == 32
        && match (*mix).wFormatTag {
            WAVE_FORMAT_IEEE_FLOAT => true,
            WAVE_FORMAT_EXTENSIBLE => {
                let extensible = mix as *const WAVEFORMATEXTENSIBLE;
                std::ptr::addr_of!((*extensible).SubFormat).read_unaligned()
                    == KSDATAFORMAT_SUBTYPE_IEEE_FLOAT
            }
            _ => false,
        };
    let rate = rate.unwrap_or(mix_rate);
    let wanted = WAVEFORMATEX {
        wFormatTag: WAVE_FORMAT_IEEE_FLOAT,
        nChannels: CHANNELS as u16,
        nSamplesPerSec: rate,
        nAvgBytesPerSec: rate * CHANNELS as u32 * 4,
        nBlockAlign: CHANNELS as u16 * 4,
        wBitsPerSample: 32,
        cbSize: 0,
    };
    let converted = client.Initialize(
        AUDCLNT_SHAREMODE_SHARED,
        AUDCLNT_STREAMFLAGS_LOOPBACK
            | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM
            | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY,
        BUFFER_HNS,
        0,
        &wanted,
        None,
    );
    let initialized = match converted {
        Ok(()) => Ok((client, CHANNELS)),
        // 系统转换不可用时退回设备混音格式；采样率不同就没法接进同一条轨道，按不可用处理。
        Err(error) if mix_float && mix_rate == rate => activate().and_then(|fallback| {
            fallback
                .Initialize(
                    AUDCLNT_SHAREMODE_SHARED,
                    AUDCLNT_STREAMFLAGS_LOOPBACK,
                    BUFFER_HNS,
                    0,
                    mix,
                    None,
                )
                .map(|_| (fallback, mix_channels))
                .map_err(|_| reason(&error))
        }),
        Err(error) => Err(reason(&error)),
    };
    CoTaskMemFree(Some(mix as _));
    let (client, channels) = initialized?;
    let capture = client
        .GetService::<IAudioCaptureClient>()
        .map_err(|e| reason(&e))?;
    client.Start().map_err(|e| reason(&e))?;
    Ok((
        Endpoint {
            client,
            capture,
            channels,
            id,
            name,
            fresh: true,
            opened: Instant::now(),
        },
        rate,
    ))
}

/// 读空设备里已有的数据包，按时间戳放上时间轴后入队。
unsafe fn drain(
    endpoint: &mut Endpoint,
    shared: &Shared,
    timeline: &mut Timeline,
    stereo: &mut Vec<f32>,
) -> windows::core::Result<()> {
    loop {
        if endpoint.capture.GetNextPacketSize()? == 0 {
            return Ok(());
        }
        let (mut data, mut frames, mut flags, mut qpc) = (std::ptr::null_mut(), 0u32, 0u32, 0u64);
        endpoint
            .capture
            .GetBuffer(&mut data, &mut frames, &mut flags, None, Some(&mut qpc))?;
        let count = frames as usize;
        if flags & AUDCLNT_BUFFERFLAGS_DATA_DISCONTINUITY.0 as u32 != 0 && !endpoint.fresh {
            shared.discontinuities.fetch_add(1, Ordering::Relaxed);
        }
        endpoint.fresh = false;
        // QPC 位置以 100 ns 为单位，与 hc_clock 同一个计数器。
        let timestamp = (flags & AUDCLNT_BUFFERFLAGS_TIMESTAMP_ERROR.0 as u32 == 0 && qpc != 0)
            .then(|| qpc as f64 / 10.0);
        let placed = timeline.place(timestamp, count);
        if placed.fill > 0 {
            shared
                .silence_frames
                .fetch_add(placed.fill, Ordering::Relaxed);
            shared.push_silence(placed.fill, placed.fill_mono_us);
        }
        if placed.skip > 0 {
            shared
                .trimmed_frames
                .fetch_add(placed.skip as u64, Ordering::Relaxed);
        }
        let kept = count - placed.skip;
        if kept > 0 {
            if flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32 != 0 || data.is_null() {
                shared.push_silence(kept as u64, placed.mono_us);
            } else {
                let input =
                    std::slice::from_raw_parts(data as *const f32, count * endpoint.channels);
                stereo.clear();
                for frame in placed.skip..count {
                    let source = &input[frame * endpoint.channels..(frame + 1) * endpoint.channels];
                    // 只在系统转换不可用、退回混音格式时才会遇到非双声道：取前两个声道（左、右）。
                    let (left, right) = (source[0], *source.get(1).unwrap_or(&source[0]));
                    stereo.extend_from_slice(&[left, right]);
                }
                shared.push_samples(stereo, placed.mono_us);
            }
        }
        endpoint.capture.ReleaseBuffer(frames)?;
    }
}

pub struct Started {
    pub handle: thread::JoinHandle<()>,
    go: mpsc::Sender<Arc<Shared>>,
}
impl Started {
    pub fn begin(&self, shared: Arc<Shared>) {
        let _ = self.go.send(shared);
    }
}

/// 在采集线程里先打开一次设备：开始时没有可用的输出设备就直接报错，与原来界面采集一致。
pub fn spawn(
    id: String,
    events: mpsc::Sender<crate::segments::Reliable>,
) -> Result<(Started, u32, String), String> {
    let (ready, ready_rx) = mpsc::channel::<Result<(u32, String), String>>();
    let (go, go_rx) = mpsc::channel::<Arc<Shared>>();
    let handle = thread::spawn(move || run(id, events, ready, go_rx));
    match ready_rx.recv_timeout(Duration::from_secs(10)) {
        Ok(Ok((rate, name))) => Ok((Started { handle, go }, rate, name)),
        Ok(Err(error)) => {
            let _ = handle.join();
            Err(format!("DEVICE_UNAVAILABLE|无法录制系统声音：{error}"))
        }
        Err(_) => Err("DEVICE_UNAVAILABLE|无法录制系统声音：打开输出设备超时".into()),
    }
}

fn run(
    id: String,
    events: mpsc::Sender<crate::segments::Reliable>,
    ready: mpsc::Sender<Result<(u32, String), String>>,
    go: mpsc::Receiver<Arc<Shared>>,
) {
    unsafe {
        if CoInitializeEx(None, COINIT_MULTITHREADED).is_err() {
            let _ = ready.send(Err("系统音频接口初始化失败".into()));
            return;
        }
        capture(&id, &events, ready, go);
        CoUninitialize();
    }
}

unsafe fn capture(
    id: &str,
    events: &mpsc::Sender<crate::segments::Reliable>,
    ready: mpsc::Sender<Result<(u32, String), String>>,
    go: mpsc::Receiver<Arc<Shared>>,
) {
    let enumerator: IMMDeviceEnumerator =
        match CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) {
            Ok(value) => value,
            Err(error) => {
                let _ = ready.send(Err(reason(&error)));
                return;
            }
        };
    let (first, rate) = match open(&enumerator, None) {
        Ok(value) => value,
        Err(error) => {
            let _ = ready.send(Err(error));
            return;
        }
    };
    let _ = ready.send(Ok((rate, first.name.clone())));
    let Ok(shared) = go.recv() else {
        return;
    };
    let device_event = |state: &str, name: &str, reason: Option<&str>, timeline_us: f64| {
        let _ = events.send(crate::segments::Reliable::Event(json!({"event":"device","sessionId":id,"state":state,"name":name,"reason":reason,"atSeconds":timeline_us / 1_000_000.0})));
    };
    let started = crate::ffi::clock();
    let mut timeline = Timeline::new(rate, started);
    let mut endpoint = Some(first);
    let mut last_name = endpoint.as_ref().unwrap().name.clone();
    let mut unavailable: Option<String> = None;
    let mut checked = Instant::now();
    let mut retry_at = Instant::now();
    let mut stereo = Vec::new();
    device_event("capturing", &last_name, None, 0.0);
    loop {
        let stopping = shared.stop_capture.load(Ordering::Acquire);
        if !stopping && checked.elapsed() >= DEVICE_CHECK {
            checked = Instant::now();
            let current = default_device(&enumerator).map(|(_, id)| id);
            if let Some(open) = &endpoint {
                if current.as_deref() != Some(open.id.as_str()) {
                    // 默认输出设备换了（插拔耳机、手动切换）：跟着换，中间这一下补静音。
                    endpoint = None;
                    retry_at = Instant::now();
                }
            }
        }
        if endpoint.is_none() && !stopping && Instant::now() >= retry_at {
            match open(&enumerator, Some(rate)) {
                Ok((opened, _)) => {
                    if opened.name != last_name || unavailable.is_none() {
                        shared.device_switches.fetch_add(1, Ordering::Relaxed);
                    }
                    last_name = opened.name.clone();
                    unavailable = None;
                    device_event("capturing", &last_name, None, crate::ffi::clock() - started);
                    endpoint = Some(opened);
                }
                Err(error) => {
                    if unavailable.as_deref() != Some(error.as_str()) {
                        device_event(
                            "unavailable",
                            &last_name,
                            Some(&error),
                            crate::ffi::clock() - started,
                        );
                        unavailable = Some(error);
                    }
                    retry_at = Instant::now() + RETRY;
                }
            }
        }
        if let Some(open) = endpoint.as_mut() {
            if let Err(error) = drain(open, &shared, &mut timeline, &mut stereo) {
                let text = reason(&error);
                if unavailable.as_deref() != Some(text.as_str()) {
                    device_event(
                        "unavailable",
                        &last_name,
                        Some(&text),
                        crate::ffi::clock() - started,
                    );
                }
                // 刚打开就读失败的设备每秒才重试一次，不在 5 ms 的循环里反复开关；用了一阵才失效的（换设备、改格式）立刻重开。
                retry_at = if open.opened.elapsed() < RETRY {
                    Instant::now() + RETRY
                } else {
                    Instant::now()
                };
                unavailable = Some(text);
                endpoint = None;
            }
        }
        // 没有数据包（没声音播放、设备不在或被独占）：按时间补静音，时间轴不断。停止时补到此刻。
        let (lag, after) = if stopping {
            (0.0, 0.0)
        } else {
            (IDLE_LAG_US, IDLE_AFTER_US)
        };
        if let Some((frames, mono)) = timeline.idle(crate::ffi::clock(), lag, after) {
            let counter = if endpoint.is_some() {
                &shared.silence_frames
            } else {
                &shared.unavailable_frames
            };
            counter.fetch_add(frames, Ordering::Relaxed);
            shared.push_silence(frames, mono);
        }
        if stopping {
            break;
        }
        thread::sleep(Duration::from_millis(5));
    }
    drop(endpoint);
    shared.settle_lost(timeline.end_us());
}
