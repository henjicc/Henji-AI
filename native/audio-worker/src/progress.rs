//! 单次命令处理整条声音（修复、去爆音、插件）时向主进程报进度；主进程据此续期无进展超时，
//! 所以长素材只要还在推进就不会被判超时。短命令在第一秒内就结束，不产生进度行。
use serde_json::json;
use std::{
    io::Write,
    sync::Mutex,
    time::{Duration, Instant},
};

struct Current {
    id: String,
    last: Instant,
}
static CURRENT: Mutex<Option<Current>> = Mutex::new(None);
const INTERVAL: Duration = Duration::from_secs(1);

pub fn begin(id: &str) {
    *CURRENT.lock().unwrap_or_else(|e| e.into_inner()) = Some(Current {
        id: id.into(),
        last: Instant::now(),
    });
}

pub fn end() {
    *CURRENT.lock().unwrap_or_else(|e| e.into_inner()) = None;
}

/// 没有可报的进度但仍在推进（例如把大文件刷到磁盘）时续期。
pub fn alive() {
    emit(json!({}));
}

pub fn report(done: u64, total: u64) {
    emit(json!({"done":done,"total":total}));
}

fn emit(fields: serde_json::Value) {
    let mut current = CURRENT.lock().unwrap_or_else(|e| e.into_inner());
    let Some(current) = current.as_mut() else {
        return;
    };
    if current.last.elapsed() < INTERVAL {
        return;
    }
    current.last = Instant::now();
    // 与最终回执同一个 stdout，持锁写完整行，不会与回执交叉。
    let mut output = std::io::stdout().lock();
    let mut message = json!({"version":1,"id":current.id,"event":"progress"});
    if let (Some(message), Some(fields)) = (message.as_object_mut(), fields.as_object()) {
        message.extend(fields.clone());
    }
    let _ = serde_json::to_writer(&mut output, &message);
    let _ = output.write_all(b"\n");
    let _ = output.flush();
}
