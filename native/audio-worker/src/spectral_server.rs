use crate::pyramid::{self, BuildRequest, TileRequest};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io::{self, BufRead, Write},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Condvar, Mutex,
    },
};

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum Command {
    SpectralTile(TileRequest),
    SpectralBuild(BuildRequest),
    Cancel { request_id: String },
    Ping,
}
#[derive(Deserialize)]
struct Request {
    version: u32,
    id: String,
    #[serde(flatten)]
    command: Command,
}
fn send(value: Value) {
    // 持有 stdout 锁到整行完成，多个请求的进度与回执不会交叉。
    let mut output = io::stdout().lock();
    let _ = serde_json::to_writer(&mut output, &value);
    let _ = output.write_all(b"\n");
    let _ = output.flush();
}
fn reply(id: &str, result: Result<Value, String>) {
    send(match result {
        Ok(result) => json!({"version":1,"id":id,"ok":true,"result":result}),
        Err(error) => json!({"version":1,"id":id,"ok":false,"error":error}),
    });
}

pub fn run() -> Result<(), Box<dyn std::error::Error>> {
    let active = Arc::new(Mutex::new(HashMap::<String, Arc<AtomicBool>>::new()));
    let priority = Arc::new((Mutex::new(0_usize), Condvar::new()));
    let foreground = Arc::new(Mutex::new(()));
    let background = Arc::new(Mutex::new(()));
    // 所有计算共享同一 Rayon 池，避免每请求起一组线程抢占 CPU。
    std::thread::scope(|scope| -> Result<(), Box<dyn std::error::Error>> {
        for line in io::stdin().lock().lines() {
            let line = line?;
            if line.trim().is_empty() {
                continue;
            }
            let request = match serde_json::from_str::<Request>(&line) {
                Ok(request) => request,
                Err(error) => {
                    reply("unknown", Err(error.to_string()));
                    continue;
                }
            };
            let Request {
                version,
                id,
                command,
            } = request;
            if version != 1 {
                reply(&id, Err("不支持的协议版本".into()));
                continue;
            }
            if let Command::Cancel { request_id } = command {
                if let Some(token) = active.lock().unwrap().get(&request_id) {
                    token.store(true, Ordering::Relaxed);
                }
                priority.1.notify_all();
                reply(&id, Ok(json!({"cancelled":request_id})));
                continue;
            }
            if matches!(command, Command::Ping) {
                reply(
                    &id,
                    Ok(json!({"worker":"henji-audio-worker","protocolVersion":1})),
                );
                continue;
            }
            let cancelled = Arc::new(AtomicBool::new(false));
            {
                let mut jobs = active.lock().unwrap();
                if jobs.len() >= 64 || jobs.contains_key(&id) {
                    reply(&id, Err("频谱请求队列已满或请求 ID 重复".into()));
                    continue;
                }
                jobs.insert(id.clone(), cancelled.clone());
            }
            let immediate = matches!(command, Command::SpectralTile(_));
            if immediate {
                *priority.0.lock().unwrap() += 1;
            }
            let (active, priority, foreground, background) = (
                active.clone(),
                priority.clone(),
                foreground.clone(),
                background.clone(),
            );
            scope.spawn(move || {
                let result = std::panic::catch_unwind(|| {
                    if immediate {
                        let _guard = foreground.lock().unwrap();
                        if let Command::SpectralTile(request) = command { return pyramid::tile(request, &cancelled).map_err(|e| e.to_string()); }
                    } else {
                        let _guard = background.lock().unwrap();
                        if let Command::SpectralBuild(request) = command {
                            return pyramid::build(request, &cancelled, || {
                                let mut pending = priority.0.lock().unwrap();
                                while *pending > 0 && !cancelled.load(Ordering::Relaxed) { pending = priority.1.wait(pending).unwrap(); }
                            }, |progress| send(json!({"version":1,"id":id,"event":"progress","progress":progress}))).map_err(|e| e.to_string());
                        }
                    }
                    Err("不支持的频谱命令".into())
                }).unwrap_or_else(|_| Err("频谱计算线程异常".into()));
                if immediate { *priority.0.lock().unwrap() -= 1; priority.1.notify_all(); }
                active.lock().unwrap().remove(&id);
                reply(&id, result);
            });
        }
        // EOF 等待已收下的请求回执；主进程退出使用 kill，仍兼容单次 stdin 关闭。
        Ok(())
    })
}
