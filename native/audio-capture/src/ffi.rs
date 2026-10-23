use serde_json::{json, Value};
use std::ffi::{c_char, c_int, c_long, c_ulong, c_void, CStr};

#[repr(C)]
pub struct Options {
    pub device: c_int,
    pub first: c_int,
    pub channels: c_int,
    pub rate: c_int,
    pub format: c_int,
    pub frames: c_int,
    pub latency: f64,
    pub exclusive: c_int,
}
#[repr(C)]
#[derive(Default)]
pub struct Device {
    pub api: c_int,
    pub inputs: c_int,
    pub outputs: c_int,
    pub rate: f64,
    pub low_in: f64,
    pub high_in: f64,
    pub low_out: f64,
    pub high_out: f64,
    pub name: *const c_char,
}
pub type Sink = extern "C" fn(*mut c_void, *const f32, c_int, f64, f64, c_ulong, c_ulong);
extern "C" {
    pub fn hc_clock() -> f64;
    pub fn hc_init() -> c_int;
    pub fn hc_last_error() -> *const c_char;
    pub fn hc_terminate();
    pub fn hc_count() -> c_int;
    pub fn hc_default() -> c_int;
    pub fn hc_hosts() -> c_int;
    pub fn hc_host(index: c_int, kind: *mut c_int, device: *mut c_int) -> *const c_char;
    pub fn hc_device(index: c_int, out: *mut Device) -> c_int;
    pub fn hc_asio() -> c_int;
    pub fn hc_panel(device: c_int) -> c_int;
    pub fn hc_buffers(
        device: c_int,
        min: *mut c_long,
        max: *mut c_long,
        preferred: *mut c_long,
        granularity: *mut c_long,
    ) -> c_int;
    pub fn hc_probe(options: *mut Options) -> c_int;
    pub fn hc_open(
        options: *mut Options,
        sink: Sink,
        user: *mut c_void,
        error: *mut c_int,
        rate: *mut f64,
        latency: *mut f64,
    ) -> *mut c_void;
    pub fn hc_start(capture: *mut c_void) -> c_int;
    pub fn hc_stop(capture: *mut c_void) -> c_int;
    pub fn hc_active(capture: *mut c_void) -> c_int;
    pub fn hc_close(capture: *mut c_void);
}
pub fn clock() -> f64 {
    unsafe { hc_clock() }
}
pub fn name(api: i32) -> &'static str {
    match api {
        1 => "DirectSound",
        2 => "MME",
        3 => "ASIO",
        5 => "CoreAudio",
        11 => "WDM-KS",
        13 => "WASAPI",
        _ => "Unknown",
    }
}
pub fn string(p: *const c_char) -> String {
    if p.is_null() {
        String::new()
    } else {
        unsafe { CStr::from_ptr(p).to_string_lossy().into_owned() }
    }
}
pub fn device(index: i32) -> Result<Device, String> {
    let mut d = Device::default();
    check(unsafe { hc_device(index, &mut d) }, false)?;
    Ok(d)
}
pub fn check(code: i32, exclusive: bool) -> Result<(), String> {
    if code == 0 {
        return Ok(());
    }
    // 原始驱动信息只交给宿主统一日志，不作为正式界面的错误文案。
    eprintln!(
        "portaudio error={code}, host={}",
        string(unsafe { hc_last_error() })
    );
    let (kind, text) = match code {
        -9996 => (
            "DEVICE_UNAVAILABLE",
            "设备当前无法打开，请检查连接、占用情况或重新选择设备",
        ),
        -9998 | -9997 | -9994 | -9993 | -9984 => (
            "FORMAT_UNSUPPORTED",
            "设备不支持所选通道、采样率或位深，请重新探测格式",
        ),
        -9985 if exclusive => (
            "EXCLUSIVE_FAILED",
            "无法独占设备，请关闭其他音频软件或改用共享模式",
        ),
        -9985 => (
            "DEVICE_BUSY",
            "设备不可用或被占用，请关闭其他音频软件后重试",
        ),
        _ if exclusive => (
            "EXCLUSIVE_FAILED",
            "独占录音失败，请检查设备格式或改用共享模式",
        ),
        _ => (
            "DEVICE_ERROR",
            "音频驱动返回错误，请检查设备与系统麦克风权限后重试",
        ),
    };
    Err(format!("{kind}|{text}"))
}
pub fn enumerate() -> Result<Value, String> {
    let count = unsafe { hc_count() };
    if count < 0 {
        check(count, false)?;
    }
    let mut devices = Vec::new();
    let mut hosts = Vec::new();
    for i in 0..unsafe { hc_hosts() } {
        let (mut kind, mut default) = (0, -1);
        let label = string(unsafe { hc_host(i, &mut kind, &mut default) });
        hosts.push(json!({"id":name(kind),"name":label,"defaultInputDevice":default}));
    }
    for i in 0..count {
        let d = device(i)?;
        let (mut min, mut max, mut preferred, mut granularity) = (0, 0, 0, 0);
        let buffers = if d.api == 3
            && unsafe { hc_buffers(i, &mut min, &mut max, &mut preferred, &mut granularity) } == 0
        {
            json!({"min":min,"max":max,"preferred":preferred,"granularity":granularity})
        } else {
            Value::Null
        };
        devices.push(json!({"index":i,"hostApi":name(d.api),"name":string(d.name),"maxInputChannels":d.inputs,"maxOutputChannels":d.outputs,"defaultSampleRate":d.rate,
            "defaultLowInputLatency":d.low_in,"defaultHighInputLatency":d.high_in,"defaultLowOutputLatency":d.low_out,"defaultHighOutputLatency":d.high_out,"asioBuffers":buffers}));
    }
    Ok(
        json!({"hostApis":hosts,"devices":devices,"defaultInputDevice":unsafe{hc_default()},"asioCompiled":unsafe{hc_asio()} != 0}),
    )
}
