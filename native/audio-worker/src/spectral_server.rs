use crate::pyramid::{self, BuildRequest, DeriveRequest, TileRequest};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io::{self, BufRead, Write},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Condvar, Mutex,
    },
    time::{Duration, Instant},
};

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum Command {
    SpectralTile(TileRequest),
    SpectralBuild(BuildRequest),
    SpectralDerive(DeriveRequest),
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
/// 排队或给即时块让路期间的心跳间隔：主进程按“无进展超时”计时，等待本身不能被当成卡住。
const HEARTBEAT: Duration = Duration::from_secs(5);
fn alive(id: &str) {
    send(json!({"version":1,"id":id,"event":"alive"}));
}

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
    /// 拿闸前、等待中、拿到后都检查取消；已取消返回 None，调用方直接回执“已取消”。等待期间定时发心跳。
    fn enter(&self, cancelled: &AtomicBool, beat: impl Fn()) -> Option<GateGuard<'_>> {
        if cancelled.load(Ordering::Relaxed) {
            return None;
        }
        let mut busy = self.busy.lock().unwrap_or_else(|e| e.into_inner());
        while *busy && !cancelled.load(Ordering::Relaxed) {
            let (next, waited) = self
                .changed
                .wait_timeout(busy, HEARTBEAT)
                .unwrap_or_else(|e| e.into_inner());
            busy = next;
            if waited.timed_out() {
                beat();
            }
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
            // 认不出的命令（主进程比这个可执行文件新）也带着原请求 ID 回错误，主进程立刻知道失败，不必等超时。
            let request = match serde_json::from_str::<Value>(&line)
                .map_err(|error| ("unknown".to_string(), error.to_string()))
                .and_then(|value| {
                    let id = value.get("id").and_then(Value::as_str).unwrap_or("unknown").to_string();
                    serde_json::from_value::<Request>(value).map_err(|error| (id, error.to_string()))
                }) {
                Ok(request) => request,
                Err((id, error)) => {
                    reply(&id, Err(error));
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
                // 能力表：主进程据此决定要不要发派生命令（旧可执行文件没有这一项，主进程直接整段计算）。
                reply(
                    &id,
                    Ok(json!({"worker":"henji-audio-worker","protocolVersion":1,
                        "capabilities":{"spectralDerive":{"groupLevel":pyramid::SIDECAR_LEVEL}}})),
                );
                continue;
            }
            let cancelled = Arc::new(AtomicBool::new(false));
            {
                let mut jobs = active.lock().unwrap();
                // 请求数不设上限：主进程只为可见范围发请求，放弃时会发取消。
                if jobs.contains_key(&id) {
                    reply(&id, Err("频谱请求 ID 重复".into()));
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
                        let Some(_guard) = foreground.enter(&cancelled, || alive(&id)) else { return Err(CANCELLED.into()) };
                        if let Command::SpectralTile(request) = command { return pyramid::tile(request, &cancelled).map_err(|e| e.to_string()); }
                    } else {
                        let Some(_guard) = background.enter(&cancelled, || alive(&id)) else { return Err(CANCELLED.into()) };
                        // 整段计算与派生都给可见块让路；让路或埋头计算期间定时发心跳，主进程按无进展计时。
                        let last_alive = Mutex::new(Instant::now());
                        let yield_to_tiles = || {
                            let mut pending = priority.0.lock().unwrap();
                            while *pending > 0 && !cancelled.load(Ordering::Relaxed) {
                                let (next, waited) = priority.1.wait_timeout(pending, HEARTBEAT).unwrap();
                                pending = next;
                                if waited.timed_out() { alive(&id); }
                            }
                            drop(pending);
                            let mut last = last_alive.lock().unwrap_or_else(|e| e.into_inner());
                            if last.elapsed() >= Duration::from_secs(1) { *last = Instant::now(); alive(&id); }
                        };
                        if let Command::SpectralBuild(request) = command {
                            return pyramid::build(request, &cancelled, yield_to_tiles, |progress| send(json!({"version":1,"id":id,"event":"progress","progress":progress}))).map_err(|e| e.to_string());
                        }
                        if let Command::SpectralDerive(request) = command {
                            return pyramid::derive(request, &cancelled, yield_to_tiles).map_err(|e| e.to_string());
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
        let _held = gate.enter(&AtomicBool::new(false), || {}).unwrap();
        // 闸被占着，已取消的请求也不排队。
        assert!(gate.enter(&AtomicBool::new(true), || {}).is_none());
    }

    #[test]
    fn queued_request_wakes_and_exits_when_cancelled() {
        let gate = Arc::new(Gate::default());
        let held = gate.enter(&AtomicBool::new(false), || {}).unwrap();
        let cancelled = Arc::new(AtomicBool::new(false));
        let (tx, rx) = mpsc::channel();
        let (g, c) = (gate.clone(), cancelled.clone());
        let waiter = thread::spawn(move || tx.send(g.enter(&c, || {}).is_some()).unwrap());
        assert!(rx.recv_timeout(Duration::from_millis(100)).is_err(), "闸被占用时应排队");
        cancelled.store(true, Ordering::Relaxed);
        gate.wake();
        // 前面的块仍在算（held 未释放），排队者也要立即退出。
        assert_eq!(rx.recv_timeout(Duration::from_secs(2)), Ok(false));
        waiter.join().unwrap();
        drop(held);
        assert!(gate.enter(&AtomicBool::new(false), || {}).is_some());
    }

    #[test]
    fn queued_request_runs_after_release_and_rechecks_cancel() {
        let gate = Arc::new(Gate::default());
        let held = gate.enter(&AtomicBool::new(false), || {}).unwrap();
        let (tx, rx) = mpsc::channel();
        let g = gate.clone();
        let waiter = thread::spawn(move || tx.send(g.enter(&AtomicBool::new(false), || {}).is_some()).unwrap());
        assert!(rx.recv_timeout(Duration::from_millis(50)).is_err());
        drop(held);
        assert_eq!(rx.recv_timeout(Duration::from_secs(2)), Ok(true));
        waiter.join().unwrap();
    }
}
