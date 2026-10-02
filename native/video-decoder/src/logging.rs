//! 结构化日志：stderr 每行一个 JSON（level、event、message、context），由主进程客户端转入
//! 现有结构化日志（createMainLogger）。服务不写任何日志文件。

use serde_json::{json, Value};
use std::ffi::{c_char, c_int, c_void, CStr};
use std::io::Write;

use ffmpeg_sys_next as ff;

pub fn emit(level: &str, event: &str, message: &str, context: Value) {
    let line = json!({ "level": level, "event": event, "message": message, "context": context });
    let mut stderr = std::io::stderr().lock();
    let _ = writeln!(stderr, "{line}");
    let _ = stderr.flush();
}

pub fn info(event: &str, message: &str, context: Value) {
    emit("info", event, message, context);
}

pub fn warn(event: &str, message: &str, context: Value) {
    emit("warn", event, message, context);
}

pub fn error(event: &str, message: &str, context: Value) {
    emit("error", event, message, context);
}

/// FFmpeg 内部日志默认直接写 stderr 原文，会破坏一行一 JSON 的约定；改为格式化后走 `emit`。
/// 只保留错误级别，探测时大量的告警不进入日志。
unsafe extern "C" fn ffmpeg_log_callback(avcl: *mut c_void, level: c_int, fmt: *const c_char, args: ff::va_list) {
    if level > ff::AV_LOG_ERROR {
        return;
    }
    let mut buffer = [0 as c_char; 1024];
    let mut print_prefix: c_int = 1;
    let written = unsafe { ff::av_log_format_line2(avcl, level, fmt, args, buffer.as_mut_ptr(), buffer.len() as c_int, &mut print_prefix) };
    if written <= 0 {
        return;
    }
    let text = unsafe { CStr::from_ptr(buffer.as_ptr()) }.to_string_lossy().trim().to_string();
    if !text.is_empty() && FFMPEG_LOG_LIMIT.admit() {
        emit("warn", "ffmpeg.log", &text, json!({ "ffmpegLevel": level }));
    }
}

/// FFmpeg 日志限频：开放 GOP 定位等场景下解码器会连续报参考帧缺失，每 10 秒最多转发 20 条，
/// 窗口结束时报告被略去的条数。
struct LogLimit {
    state: std::sync::Mutex<(std::time::Instant, u32)>,
}

const FFMPEG_LOG_WINDOW: std::time::Duration = std::time::Duration::from_secs(10);
const FFMPEG_LOG_PER_WINDOW: u32 = 20;

impl LogLimit {
    fn admit(&self) -> bool {
        let mut state = self.state.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let now = std::time::Instant::now();
        if now.duration_since(state.0) >= FFMPEG_LOG_WINDOW {
            if state.1 > FFMPEG_LOG_PER_WINDOW {
                emit("warn", "ffmpeg.log_suppressed", "FFmpeg 日志过多，已略去部分", json!({ "suppressed": state.1 - FFMPEG_LOG_PER_WINDOW }));
            }
            *state = (now, 0);
        }
        state.1 += 1;
        state.1 <= FFMPEG_LOG_PER_WINDOW
    }
}

static FFMPEG_LOG_LIMIT: std::sync::LazyLock<LogLimit> = std::sync::LazyLock::new(|| LogLimit { state: std::sync::Mutex::new((std::time::Instant::now(), 0)) });

pub fn install_ffmpeg_log_bridge() {
    unsafe {
        ff::av_log_set_level(ff::AV_LOG_ERROR);
        ff::av_log_set_callback(Some(ffmpeg_log_callback));
    }
}
