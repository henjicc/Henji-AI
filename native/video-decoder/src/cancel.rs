//! 按请求 ID 登记的取消标志：`cancel` 命令按目标请求 ID 置位，持有者结束（离开作用域）时自动出表。
//! 用于探测（独立线程）与单帧取帧（解码会话线程）；没登记或已结束的请求答复 `cancelled: false`。

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

pub type CancelMap = Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>;

#[derive(Debug)]
pub struct CancelToken {
    id: String,
    flag: Arc<AtomicBool>,
    table: CancelMap,
}

impl CancelToken {
    pub fn register(table: &CancelMap, id: &str) -> Self {
        let flag = Arc::new(AtomicBool::new(false));
        table.lock().unwrap().insert(id.to_string(), flag.clone());
        Self { id: id.to_string(), flag, table: table.clone() }
    }

    pub fn is_cancelled(&self) -> bool {
        self.flag.load(Ordering::Relaxed)
    }

    /// 交给 FFmpeg 中断回调等只认标志的地方。
    pub fn flag(&self) -> &AtomicBool {
        &self.flag
    }
}

impl Drop for CancelToken {
    fn drop(&mut self) {
        self.table.lock().unwrap().remove(&self.id);
    }
}

/// 置位 `id` 的取消标志；返回该请求是否仍在进行。
pub fn cancel(table: &CancelMap, id: &str) -> bool {
    table.lock().unwrap().get(id).map(|flag| flag.store(true, Ordering::Relaxed)).is_some()
}

pub fn cancel_all(table: &CancelMap) {
    for flag in table.lock().unwrap().values() {
        flag.store(true, Ordering::Relaxed);
    }
}
