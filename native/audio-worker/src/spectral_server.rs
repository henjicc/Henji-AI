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
const CANCELLED: &str = "频谱计算已取消";

/// 同类计算串行执行的闸门。与 Mutex 不同，排队者在取消时会被唤醒并立即退出，
/// 不必等前面的块算完才回执“已取消”（主进程取消宽限只有 2 秒，超时会结束整个频谱进程）。
#[derive(Default)]
struct Gate {
    busy: Mutex<bool>,
    changed: Condvar,
}
struct GateGuard<'a>(&'a Gate);
impl Drop for GateGuard<'_> {
    fn drop(&mut self) {
        *self.0.busy.lock().unwrap_or_else(|e| e.into_inner()) = false;
        self.0.changed.notify_all();
    }
}
impl Gate {
    /// 拿闸前、等待中、拿到后都检查取消；已取消返回 None，调用方直接回执“已取消”。
    fn enter(&self, cancelled: &AtomicBool) -> Option<GateGuard<'_>> {
        if cancelled.load(Ordering::Relaxed) {
            return None;
        }
        let mut busy = self.busy.lock().unwrap_or_else(|e| e.into_inner());
        while *busy && !cancelled.load(Ordering::Relaxed) {
            busy = self.changed.wait(busy).unwrap_or_else(|e| e.into_inner());
        }
        if cancelled.load(Ordering::Relaxed) {
            return None;
        }
        *busy = true;
        Some(GateGuard(self))
    }
    /// 取消令牌置位后调用，唤醒排队者重新检查。
    fn wake(&self) {
        let _busy = self.busy.lock().unwrap_or_else(|e| e.into_inner());
        self.changed.notify_all();
    }
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
    let foreground = Arc::new(Gate::default());
    let background = Arc::new(Gate::default());
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
                foreground.wake();
                background.wake();
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
                        let Some(_guard) = foreground.enter(&cancelled) else { return Err(CANCELLED.into()) };
                        if let Command::SpectralTile(request) = command { return pyramid::tile(request, &cancelled).map_err(|e| e.to_string()); }
                    } else {
                        let Some(_guard) = background.enter(&cancelled) else { return Err(CANCELLED.into()) };
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::{sync::mpsc, thread, time::Duration};

    #[test]
    fn already_cancelled_request_skips_gate_immediately() {
        let gate = Gate::default();
        let _held = gate.enter(&AtomicBool::new(false)).unwrap();
        // 闸被占着，已取消的请求也不排队。
        assert!(gate.enter(&AtomicBool::new(true)).is_none());
    }

    #[test]
    fn queued_request_wakes_and_exits_when_cancelled() {
        let gate = Arc::new(Gate::default());
        let held = gate.enter(&AtomicBool::new(false)).unwrap();
        let cancelled = Arc::new(AtomicBool::new(false));
        let (tx, rx) = mpsc::channel();
        let (g, c) = (gate.clone(), cancelled.clone());
        let waiter = thread::spawn(move || tx.send(g.enter(&c).is_some()).unwrap());
        assert!(rx.recv_timeout(Duration::from_millis(100)).is_err(), "闸被占用时应排队");
        cancelled.store(true, Ordering::Relaxed);
        gate.wake();
        // 前面的块仍在算（held 未释放），排队者也要立即退出。
        assert_eq!(rx.recv_timeout(Duration::from_secs(2)), Ok(false));
        waiter.join().unwrap();
        drop(held);
        assert!(gate.enter(&AtomicBool::new(false)).is_some());
    }

    #[test]
    fn queued_request_runs_after_release_and_rechecks_cancel() {
        let gate = Arc::new(Gate::default());
        let held = gate.enter(&AtomicBool::new(false)).unwrap();
        let (tx, rx) = mpsc::channel();
        let g = gate.clone();
        let waiter = thread::spawn(move || tx.send(g.enter(&AtomicBool::new(false)).is_some()).unwrap());
        assert!(rx.recv_timeout(Duration::from_millis(50)).is_err());
        drop(held);
        assert_eq!(rx.recv_timeout(Duration::from_secs(2)), Ok(true));
        waiter.join().unwrap();
    }
}
