//! 画面采集进程。不带参数运行时是服务：标准输入收指令，标准输出发应答与事件（协议见 README.md）。
//! 带子命令运行时是开发工具：`record` 直接录一段，`inspect` 读一次录制的旁路文件做统计，`sources` 列出显示器。

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
    let at_us = request["atUs"].as_i64();
    let now = |value: Value| Ok(Reply::Now(value));
    let prepare = |session: &mut Option<Session>| -> Result<(), String> {
        if session.as_ref().is_some_and(|session| !session.is_ended()) {
            return Err("SESSION_ACTIVE|已有一次录制在进行，请先停止".into());
        }
        *session = Some(Session::prepare::<Native>(CaptureConfig::parse(request)?, events.clone())?);
        Ok(())
    };
    if matches!(kind, "hello" | "clock" | "sources" | "prepare") || (kind == "start" && session.as_ref().is_none_or(Session::is_ended) && !request["source"].is_null()) {
        return match kind {
            "hello" => protocol::hello(request, Native::now_us(), Native::NAME).map(Reply::Now),
            "clock" => now(json!({"nativeMonoUs": Native::now_us()})),
            "sources" => Native::sources().map(Reply::Now),
            "prepare" => {
                prepare(session)?;
                now(session.as_ref().unwrap().info.clone())
            }
            // 带着完整参数的 start：一步完成准备与开始。
            _ => {
                prepare(session)?;
                session.as_ref().unwrap().start(at_us).map(Reply::Now)
            }
        };
    }
    let id = request["sessionId"].as_str().unwrap_or_default();
    let active = session.as_ref().filter(|session| session.id == id).ok_or("SESSION_MISSING|没有这次录制")?;
    match kind {
        "start" => active.start(at_us).map(Reply::Now),
        "pause" => active.pause(at_us).map(Reply::Now),
        "resume" => active.resume(at_us).map(Reply::Now),
        "status" => now(active.status()),
        "stop" => active.stop(at_us, request["id"].clone()).map(|_| Reply::Later),
        "cancel" => active.cancel(request["id"].clone()).map(|_| Reply::Later),
        _ => Err("INVALID_ARGUMENT|未知指令".into()),
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
        let _ = active.stop(None, Value::Null);
        let deadline = Instant::now() + EXIT_WAIT;
        while !active.is_ended() && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(20));
        }
        if active.is_ended() {
            active.join();
        }
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
            eprintln!("用法：henji-screen-capture [record|inspect|sources]；不带参数时作为服务运行（协议见 README.md）");
            2
        }
    };
    std::process::exit(code);
}
