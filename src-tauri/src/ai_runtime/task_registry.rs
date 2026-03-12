use once_cell::sync::Lazy;
use std::collections::HashSet;
use std::sync::Mutex;

static CANCELLED_TASKS: Lazy<Mutex<HashSet<String>>> = Lazy::new(|| Mutex::new(HashSet::new()));

pub fn cancel_task(task_id: &str) {
    if let Ok(mut guard) = CANCELLED_TASKS.lock() {
        guard.insert(task_id.to_string());
    }
}

pub fn is_cancelled(task_id: &str) -> bool {
    if let Ok(guard) = CANCELLED_TASKS.lock() {
        guard.contains(task_id)
    } else {
        false
    }
}

pub fn clear_cancel_flag(task_id: &str) {
    if let Ok(mut guard) = CANCELLED_TASKS.lock() {
        guard.remove(task_id);
    }
}
