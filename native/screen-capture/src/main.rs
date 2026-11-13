//! 画面采集进程。不带参数运行时是服务：标准输入收指令，标准输出发应答与事件（协议见 README.md）。
//! 带子命令运行时是开发工具：`record` 直接录一段，`inspect` 读一次录制的旁路文件做统计，`sources` 列出显示器。

// 还没有平台层的系统上，共用核心里只有平台层才调用的部分没人用。
#![cfg_attr(not(windows), allow(dead_code))]

mod core;
mod dev;
mod platform;

use core::{
    protocol::{self, failure, CaptureConfig, Events},
    session::Session,
};
use platform::{Native, Platform};
use serde_json::{json, Value};
use std::{
    io::{self, BufRead},
    sync::{atomic::Ordering, mpsc},
    thread,
    time::{Duration, Instant},
};

/// 标准输入关闭后等文件收尾的上限（磁盘一直不动也不无限等）；与录音进程一致。
const EXIT_WAIT: Duration = Duration::from_secs(100);

enum Reply {
    Now(Value),
    /// 会话线程收尾后自己应答。
    Later,
}

fn command(request: &Value, session: &mut Option<Session>, events: &Events) -> Result<Reply, String> {
    let kind = request["type"].as_str().ok_or("INVALID_ARGUMENT|缺少指令类型")?;
    let now = |value: Value| Ok(Reply::Now(value));
    let prepare = |session: &mut Option<Session>| -> Result<(), String> {
        if session.as_ref().is_some_and(|session| !session.is_ended()) {
            return Err("SESSION_ACTIVE|已有一次录制在进行，请先停止".into());
        }
        *session = Some(Session::prepare::<Native>(CaptureConfig::parse(request)?, events.clone())?);
        Ok(())
    };
    if matches!(kind, "hello" | "clock" | "sources" | "closeClientHandles" | "prepare") || (kind == "start" && session.as_ref().is_none_or(Session::is_ended) && !request["source"].is_null()) {
        return match kind {
            "hello" => protocol::hello(request, Native::now_us(), Native::NAME).map(Reply::Now),
            "clock" => now(json!({"nativeMonoUs": Native::now_us()})),
            "sources" => Native::sources().map(Reply::Now),
            // 不属于哪一次录制：录制结束、甚至上一个采集进程退出后，主进程还要关它手里的预览句柄。
            "closeClientHandles" => {
                let pid = request["clientPid"].as_u64().ok_or("INVALID_ARGUMENT|缺少 clientPid")? as u32;
                let handles = request["handles"].as_array().ok_or("INVALID_ARGUMENT|缺少 handles")?.iter().map(|value| value.as_str().and_then(|text| text.parse::<u64>().ok()).ok_or("INVALID_ARGUMENT|句柄值不对")).collect::<Result<Vec<_>, _>>()?;
                Native::close_client_handles(pid, &handles).map(Reply::Now)
            }
            "prepare" => {
                prepare(session)?;
                now(session.as_ref().unwrap().info.clone())
            }
            // 带着完整参数的 start：一步完成准备与开始。
            _ => {
                prepare(session)?;
                session.as_ref().unwrap().command("start", request).map(|_| Reply::Later)
            }
        };
    }
    let id = request["sessionId"].as_str().unwrap_or_default();
    let active = session.as_ref().filter(|session| session.id == id).ok_or("SESSION_MISSING|没有这次录制")?;
    match kind {
        "status" => now(active.status()),
        _ => active.command(kind, request).map(|_| Reply::Later),
    }
}

fn service() {
    let (events, streamer) = protocol::spawn_streamer();
    let (lines, incoming) = mpsc::sync_channel::<String>(32);
    thread::spawn(move || {
        for line in io::stdin().lock().lines() {
            match line {
                Ok(text) if text.len() <= 65536 => {
                    if lines.send(text).is_err() {
                        break;
                    }
                }
                _ => break,
            }
        }
    });
    let mut session: Option<Session> = None;
    loop {
        match incoming.recv_timeout(Duration::from_millis(100)) {
            Ok(line) => match serde_json::from_str::<Value>(&line) {
                Ok(request) => {
                    let id = request["id"].clone();
                    match command(&request, &mut session, &events) {
                        Ok(Reply::Now(result)) => events.send(json!({"id": id, "ok": true, "result": result})),
                        Ok(Reply::Later) => {}
                        Err(error) => events.send(json!({"id": id, "ok": false, "error": failure(&error)})),
                    }
                }
                Err(error) => events.send(json!({"id": null, "ok": false, "error": failure(&format!("INVALID_ARGUMENT|{error}"))})),
            },
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }
        if protocol::OUTPUT_BROKEN.load(Ordering::Acquire) {
            break;
        }
    }
    // 主进程没了（标准输入关闭或读端关闭）：把正在录的文件收尾后退出。
    if let Some(mut active) = session.take() {
        let _ = active.command("stop", &Value::Null);
        let deadline = Instant::now() + EXIT_WAIT;
        while !active.is_ended() && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(20));
        }
        if !active.is_ended() {
            // 磁盘一直不动：不再等，直接退出（已落盘的分片读得回来）。
            return;
        }
        active.join();
    }
    drop(events);
    let _ = streamer.join();
}

fn main() {
    let arguments: Vec<String> = std::env::args().skip(1).collect();
    let code = match arguments.first().map(String::as_str) {
        None => {
            service();
            0
        }
        Some("record") => dev::record(&arguments[1..]),
        Some("inspect") => dev::inspect(&arguments[1..]),
        Some("preview-read") => dev::preview_read(),
        Some("sources") => match Native::sources() {
            Ok(sources) => {
                println!("{}", serde_json::to_string_pretty(&sources).unwrap());
                0
            }
            Err(error) => {
                eprintln!("{error}");
                1
            }
        },
        Some(_) => {
            eprintln!("用法：henji-screen-capture [record|inspect|sources|preview-read]；不带参数时作为服务运行（协议见 README.md）");
            2
        }
    };
    std::process::exit(code);
}
