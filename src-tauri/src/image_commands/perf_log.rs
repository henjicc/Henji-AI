use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Instant;

static TRACE_ID: AtomicU64 = AtomicU64::new(1);
const LOG_PREFIX: &str = "[RustImage]";

pub fn source_kind(source: &str) -> &'static str {
    if source.starts_with("data:") {
        return "data-url";
    }
    if source.starts_with("http://") || source.starts_with("https://") {
        return "http";
    }
    if source.starts_with("file://") {
        return "file-url";
    }
    "local-path"
}

pub struct PerfLog {
    command: &'static str,
    id: u64,
    started: Instant,
    stage_started: Instant,
}

impl PerfLog {
    pub fn begin(command: &'static str, detail: impl AsRef<str>) -> Self {
        let id = TRACE_ID.fetch_add(1, Ordering::Relaxed);
        let now = Instant::now();
        println!(
            "{}[{}#{}] start {}",
            LOG_PREFIX,
            command,
            id,
            detail.as_ref()
        );
        Self {
            command,
            id,
            started: now,
            stage_started: now,
        }
    }

    pub fn stage(&mut self, stage: &'static str, detail: impl AsRef<str>) {
        let now = Instant::now();
        let stage_ms = now.duration_since(self.stage_started).as_millis();
        let total_ms = now.duration_since(self.started).as_millis();
        println!(
            "{}[{}#{}] stage={} stage_ms={} total_ms={} {}",
            LOG_PREFIX,
            self.command,
            self.id,
            stage,
            stage_ms,
            total_ms,
            detail.as_ref()
        );
        self.stage_started = now;
    }

    pub fn done(&self, detail: impl AsRef<str>) {
        println!(
            "{}[{}#{}] done total_ms={} {}",
            LOG_PREFIX,
            self.command,
            self.id,
            self.started.elapsed().as_millis(),
            detail.as_ref()
        );
    }
}
