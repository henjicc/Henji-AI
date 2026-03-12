use crate::ai_runtime::errors::{AiResult, AiRuntimeError};
use tokio::time::{sleep, Duration};

pub async fn wait_interval_ms(interval_ms: u64) {
    sleep(Duration::from_millis(interval_ms)).await;
}

pub fn timeout_error(max_attempts: u32) -> AiRuntimeError {
    AiRuntimeError::new(
        "polling_timeout",
        format!("Task polling timeout after {} attempts", max_attempts),
    )
}

pub fn cancelled_error(task_id: &str) -> AiRuntimeError {
    AiRuntimeError::new("task_cancelled", format!("Task cancelled: {}", task_id))
}

pub fn require_url(url: Option<String>) -> AiResult<String> {
    match url {
        Some(value) if !value.trim().is_empty() => Ok(value),
        _ => Err(AiRuntimeError::new("empty_result", "Provider response has no media URL")),
    }
}
