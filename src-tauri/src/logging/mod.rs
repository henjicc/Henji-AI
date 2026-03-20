use chrono::Local;
use once_cell::sync::OnceCell;
use serde::Deserialize;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime};
use tauri::Manager;
use tracing_appender::non_blocking::{NonBlocking, WorkerGuard};
use tracing_subscriber::EnvFilter;

const LOG_DIR_NAME: &str = "logs";
const LOG_FILE_PREFIX: &str = "henji";
const MAX_FILE_SIZE_BYTES: u64 = 10 * 1024 * 1024;
const RETENTION_DAYS: u64 = 7;

static LOG_GUARD: OnceCell<WorkerGuard> = OnceCell::new();

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrontendLogEventDto {
    pub timestamp: String,
    pub level: String,
    pub domain: String,
    pub event: String,
    pub message: String,
    #[serde(default)]
    pub request_id: Option<String>,
    #[serde(default)]
    pub task_id: Option<String>,
    #[serde(default)]
    pub model_id: Option<String>,
    #[serde(default)]
    pub provider_id: Option<String>,
    #[serde(default)]
    pub context: Option<serde_json::Value>,
    #[serde(default)]
    pub error: Option<serde_json::Value>,
}

#[derive(Debug)]
struct WriterState {
    dir: PathBuf,
    current_date: String,
    file: File,
    file_size: u64,
}

#[derive(Debug)]
struct SizeRotatingWriter {
    state: Mutex<WriterState>,
}

impl SizeRotatingWriter {
    fn new(dir: PathBuf) -> io::Result<Self> {
        fs::create_dir_all(&dir)?;

        let current_date = current_date_key();
        let active_path = active_log_path(&dir, &current_date);
        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&active_path)?;
        let file_size = file.metadata().map(|meta| meta.len()).unwrap_or(0);

        let writer = Self {
            state: Mutex::new(WriterState {
                dir,
                current_date,
                file,
                file_size,
            }),
        };

        writer.cleanup_expired_logs().ok();
        Ok(writer)
    }

    fn cleanup_expired_logs(&self) -> io::Result<()> {
        let state = self
            .state
            .lock()
            .map_err(|_| io::Error::new(io::ErrorKind::Other, "log state poisoned"))?;
        cleanup_expired_logs_in_dir(&state.dir)
    }

    fn rotate_if_needed(state: &mut WriterState, incoming_size: usize) -> io::Result<()> {
        let today = current_date_key();
        if state.current_date != today {
            state.current_date = today;
            state.file = open_active_file(&state.dir, &state.current_date)?;
            state.file_size = state.file.metadata().map(|meta| meta.len()).unwrap_or(0);
        }

        if state.file_size + incoming_size as u64 <= MAX_FILE_SIZE_BYTES {
            return Ok(());
        }

        state.file.flush()?;
        let source_path = active_log_path(&state.dir, &state.current_date);
        let rotated_path = rotated_log_path(&state.dir, &state.current_date);

        if source_path.exists() {
            fs::rename(&source_path, &rotated_path)?;
        }

        state.file = open_active_file(&state.dir, &state.current_date)?;
        state.file_size = 0;

        cleanup_expired_logs_in_dir(&state.dir)
    }
}

impl Write for SizeRotatingWriter {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| io::Error::new(io::ErrorKind::Other, "log state poisoned"))?;

        Self::rotate_if_needed(&mut state, buf.len())?;

        let bytes_written = state.file.write(buf)?;
        state.file_size = state.file_size.saturating_add(bytes_written as u64);

        Ok(bytes_written)
    }

    fn flush(&mut self) -> io::Result<()> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| io::Error::new(io::ErrorKind::Other, "log state poisoned"))?;
        state.file.flush()
    }
}

fn current_date_key() -> String {
    Local::now().format("%Y-%m-%d").to_string()
}

fn active_log_path(dir: &Path, date: &str) -> PathBuf {
    dir.join(format!("{}-{}.log", LOG_FILE_PREFIX, date))
}

fn rotated_log_path(dir: &Path, date: &str) -> PathBuf {
    let time_key = Local::now().format("%H%M%S");
    let millis = Local::now().timestamp_millis();
    dir.join(format!(
        "{}-{}-{}-{}.log",
        LOG_FILE_PREFIX, date, time_key, millis
    ))
}

fn open_active_file(dir: &Path, date: &str) -> io::Result<File> {
    let path = active_log_path(dir, date);
    OpenOptions::new().create(true).append(true).open(path)
}

fn cleanup_expired_logs_in_dir(dir: &Path) -> io::Result<()> {
    let now = SystemTime::now();
    let retention = Duration::from_secs(RETENTION_DAYS * 24 * 60 * 60);

    for entry in fs::read_dir(dir)? {
        let entry = match entry {
            Ok(item) => item,
            Err(_) => continue,
        };

        let path = entry.path();
        let file_name = match path.file_name().and_then(|value| value.to_str()) {
            Some(name) => name,
            None => continue,
        };

        if !file_name.starts_with(LOG_FILE_PREFIX) || !file_name.ends_with(".log") {
            continue;
        }

        let modified = match entry.metadata().and_then(|meta| meta.modified()) {
            Ok(value) => value,
            Err(_) => continue,
        };

        let age = now
            .duration_since(modified)
            .unwrap_or_else(|_| Duration::from_secs(0));

        if age > retention {
            let _ = fs::remove_file(path);
        }
    }

    Ok(())
}

fn build_env_filter() -> EnvFilter {
    let default_level = if cfg!(debug_assertions) { "debug" } else { "info" };
    EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new(default_level))
}

fn build_non_blocking_writer(log_dir: PathBuf) -> io::Result<(NonBlocking, WorkerGuard)> {
    let writer = SizeRotatingWriter::new(log_dir)?;
    Ok(tracing_appender::non_blocking(writer))
}

pub fn init(app: &tauri::AppHandle) -> Result<(), String> {
    if LOG_GUARD.get().is_some() {
        return Ok(());
    }

    let app_local_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("resolve app local data dir failed: {}", error))?;

    let log_dir = app_local_dir.join("Henji-AI").join(LOG_DIR_NAME);
    let (file_writer, guard) =
        build_non_blocking_writer(log_dir).map_err(|error| format!("init log writer failed: {}", error))?;

    let subscriber = tracing_subscriber::fmt()
        .with_env_filter(build_env_filter())
        .with_writer(file_writer)
        .with_ansi(false)
        .with_target(true)
        .finish();

    tracing::subscriber::set_global_default(subscriber)
        .map_err(|error| format!("set global tracing subscriber failed: {}", error))?;

    let _ = LOG_GUARD.set(guard);
    tracing::info!(target: "logging", "logging subsystem initialized");
    Ok(())
}

#[tauri::command]
pub fn log_frontend_events(events: Vec<FrontendLogEventDto>) -> Result<(), String> {
    events.into_iter().for_each(emit_frontend_event);

    Ok(())
}

fn emit_frontend_event(event: FrontendLogEventDto) {
    let FrontendLogEventDto {
        timestamp,
        level,
        domain,
        event: event_name,
        message,
        request_id,
        task_id,
        model_id,
        provider_id,
        context,
        error,
    } = event;

    let context = context
        .map(|value| value.to_string())
        .unwrap_or_else(|| "null".to_string());
    let error = error
        .map(|value| value.to_string())
        .unwrap_or_else(|| "null".to_string());

    match level.as_str() {
        "trace" => tracing::trace!(
            target: "frontend",
            timestamp = %timestamp,
            frontend_level = "trace",
            domain = %domain,
            event = %event_name,
            message = %message,
            request_id = %request_id.unwrap_or_default(),
            task_id = %task_id.unwrap_or_default(),
            model_id = %model_id.unwrap_or_default(),
            provider_id = %provider_id.unwrap_or_default(),
            context = %context,
            error = %error,
            "frontend_event"
        ),
        "debug" => tracing::debug!(
            target: "frontend",
            timestamp = %timestamp,
            frontend_level = "debug",
            domain = %domain,
            event = %event_name,
            message = %message,
            request_id = %request_id.unwrap_or_default(),
            task_id = %task_id.unwrap_or_default(),
            model_id = %model_id.unwrap_or_default(),
            provider_id = %provider_id.unwrap_or_default(),
            context = %context,
            error = %error,
            "frontend_event"
        ),
        "warn" => tracing::warn!(
            target: "frontend",
            timestamp = %timestamp,
            frontend_level = "warn",
            domain = %domain,
            event = %event_name,
            message = %message,
            request_id = %request_id.unwrap_or_default(),
            task_id = %task_id.unwrap_or_default(),
            model_id = %model_id.unwrap_or_default(),
            provider_id = %provider_id.unwrap_or_default(),
            context = %context,
            error = %error,
            "frontend_event"
        ),
        "error" => tracing::error!(
            target: "frontend",
            timestamp = %timestamp,
            frontend_level = "error",
            domain = %domain,
            event = %event_name,
            message = %message,
            request_id = %request_id.unwrap_or_default(),
            task_id = %task_id.unwrap_or_default(),
            model_id = %model_id.unwrap_or_default(),
            provider_id = %provider_id.unwrap_or_default(),
            context = %context,
            error = %error,
            "frontend_event"
        ),
        _ => tracing::info!(
            target: "frontend",
            timestamp = %timestamp,
            frontend_level = "info",
            domain = %domain,
            event = %event_name,
            message = %message,
            request_id = %request_id.unwrap_or_default(),
            task_id = %task_id.unwrap_or_default(),
            model_id = %model_id.unwrap_or_default(),
            provider_id = %provider_id.unwrap_or_default(),
            context = %context,
            error = %error,
            "frontend_event"
        ),
    }
}
