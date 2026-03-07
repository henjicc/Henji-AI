use base64::{engine::general_purpose::STANDARD, Engine};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;

use crate::image_commands::path_utils::{
    ensure_output_path_with_extension, ensure_unique_path, mime_from_extension,
    normalize_extension, persist_image_bytes, resolve_data_root_dir, resolve_debug_dir,
    sanitize_file_stem,
};
use crate::image_commands::perf_log::{source_kind, PerfLog};
use crate::image_commands::source::resolve_source_bytes;

fn resolve_timestamp_millis() -> Result<u128, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .map_err(|e| format!("Failed to resolve current time: {}", e))
}

fn make_output_stem(suggested: Option<&str>, prefix: &str) -> Result<String, String> {
    let stem = sanitize_file_stem(suggested.unwrap_or(""));
    if stem == "storyboard-image" {
        Ok(format!("{}-{}", prefix, resolve_timestamp_millis()?))
    } else {
        Ok(stem)
    }
}

fn resolve_downloads_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let fallback_dir = resolve_data_root_dir(app)?.join("Downloads");

    let download_dir = app.path().download_dir().unwrap_or(fallback_dir);

    std::fs::create_dir_all(&download_dir)
        .map_err(|e| format!("Failed to create downloads dir: {}", e))?;

    Ok(download_dir)
}

fn write_bytes_to_path(path: &PathBuf, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create output dir: {}", e))?;
    }
    std::fs::write(path, bytes).map_err(|e| format!("Failed to write image file: {}", e))
}

#[tauri::command]
pub async fn load_image(file_path: String) -> Result<String, String> {
    let mut perf = PerfLog::begin("load_image", format!("path={}", file_path));
    let bytes = std::fs::read(&file_path).map_err(|e| format!("Failed to read file: {}", e))?;
    perf.stage("read_file", format!("bytes={}", bytes.len()));

    let ext = PathBuf::from(&file_path)
        .extension()
        .and_then(|item| item.to_str())
        .map(normalize_extension)
        .unwrap_or_else(|| "png".to_string());
    let mime = mime_from_extension(&ext);
    perf.stage("resolve_mime", format!("ext={} mime={}", ext, mime));

    let output = format!("data:{};base64,{}", mime, STANDARD.encode(bytes));
    perf.done(format!("output_chars={}", output.len()));
    Ok(output)
}

#[tauri::command]
pub async fn persist_image_source(app: AppHandle, source: String) -> Result<String, String> {
    let trimmed = source.trim();
    if trimmed.is_empty() {
        return Err("Image source is empty".to_string());
    }

    let mut perf = PerfLog::begin(
        "persist_image_source",
        format!("source_kind={}", source_kind(trimmed)),
    );
    let (bytes, extension) = resolve_source_bytes(trimmed).await?;
    perf.stage(
        "resolve_source",
        format!("bytes={} ext={}", bytes.len(), extension),
    );

    let out = persist_image_bytes(&app, &bytes, &extension)?;
    perf.stage("persist", format!("path={}", out));
    perf.done(format!("bytes={} ext={}", bytes.len(), extension));
    Ok(out)
}

#[tauri::command]
pub async fn persist_image_binary(
    app: AppHandle,
    bytes: Vec<u8>,
    extension: Option<String>,
) -> Result<String, String> {
    let resolved_extension = extension
        .as_deref()
        .map(normalize_extension)
        .unwrap_or_else(|| "png".to_string());
    let mut perf = PerfLog::begin(
        "persist_image_binary",
        format!("bytes={} ext={}", bytes.len(), resolved_extension),
    );
    let out = persist_image_bytes(&app, &bytes, &resolved_extension)?;
    perf.stage("persist", format!("path={}", out));
    perf.done(format!("bytes={} ext={}", bytes.len(), resolved_extension));
    Ok(out)
}

#[tauri::command]
pub async fn save_image_source_to_downloads(
    app: AppHandle,
    source: String,
    suggested_file_name: Option<String>,
) -> Result<String, String> {
    let trimmed_source = source.trim();
    if trimmed_source.is_empty() {
        return Err("Image source is empty".to_string());
    }

    let mut perf = PerfLog::begin(
        "save_image_source_to_downloads",
        format!("source_kind={}", source_kind(trimmed_source)),
    );
    let (bytes, extension) = resolve_source_bytes(trimmed_source).await?;
    perf.stage(
        "resolve_source",
        format!("bytes={} ext={}", bytes.len(), extension),
    );

    let downloads_dir = resolve_downloads_dir(&app)?;
    perf.stage(
        "resolve_downloads",
        format!("dir={}", downloads_dir.display()),
    );

    let stem = make_output_stem(suggested_file_name.as_deref(), "storyboard")?;
    let file_name = format!("{}.{}", stem, normalize_extension(&extension));
    let output_path = ensure_unique_path(downloads_dir.join(file_name));

    write_bytes_to_path(&output_path, &bytes)?;
    let output = output_path.to_string_lossy().to_string();
    perf.stage("write_file", format!("path={}", output));
    perf.done(format!("bytes={}", bytes.len()));
    Ok(output)
}

#[tauri::command]
pub async fn save_image_source_to_path(
    source: String,
    target_path: String,
) -> Result<String, String> {
    let trimmed_source = source.trim();
    if trimmed_source.is_empty() {
        return Err("Image source is empty".to_string());
    }

    let trimmed_target = target_path.trim();
    if trimmed_target.is_empty() {
        return Err("Target path is empty".to_string());
    }

    let mut perf = PerfLog::begin(
        "save_image_source_to_path",
        format!(
            "source_kind={} target={}",
            source_kind(trimmed_source),
            trimmed_target
        ),
    );
    let (bytes, extension) = resolve_source_bytes(trimmed_source).await?;
    perf.stage(
        "resolve_source",
        format!("bytes={} ext={}", bytes.len(), extension),
    );

    let output_path = ensure_output_path_with_extension(&PathBuf::from(trimmed_target), &extension);
    write_bytes_to_path(&output_path, &bytes)?;

    let output = output_path.to_string_lossy().to_string();
    perf.stage("write_file", format!("path={}", output));
    perf.done(format!("bytes={}", bytes.len()));
    Ok(output)
}

#[tauri::command]
pub async fn save_image_source_to_directory(
    source: String,
    target_dir: String,
    suggested_file_name: Option<String>,
) -> Result<String, String> {
    let trimmed_source = source.trim();
    if trimmed_source.is_empty() {
        return Err("Image source is empty".to_string());
    }

    let trimmed_dir = target_dir.trim();
    if trimmed_dir.is_empty() {
        return Err("Target directory is empty".to_string());
    }

    let mut perf = PerfLog::begin(
        "save_image_source_to_directory",
        format!(
            "source_kind={} target_dir={}",
            source_kind(trimmed_source),
            trimmed_dir
        ),
    );
    let (bytes, extension) = resolve_source_bytes(trimmed_source).await?;
    perf.stage(
        "resolve_source",
        format!("bytes={} ext={}", bytes.len(), extension),
    );

    let target_dir_path = PathBuf::from(trimmed_dir);
    std::fs::create_dir_all(&target_dir_path)
        .map_err(|e| format!("Failed to create target dir: {}", e))?;
    perf.stage("ensure_dir", format!("dir={}", target_dir_path.display()));

    let stem = make_output_stem(suggested_file_name.as_deref(), "storyboard")?;
    let file_name = format!("{}.{}", stem, normalize_extension(&extension));
    let output_path = ensure_unique_path(target_dir_path.join(file_name));

    write_bytes_to_path(&output_path, &bytes)?;
    let output = output_path.to_string_lossy().to_string();
    perf.stage("write_file", format!("path={}", output));
    perf.done(format!("bytes={}", bytes.len()));
    Ok(output)
}

#[tauri::command]
pub async fn save_image_source_to_app_debug_dir(
    app: AppHandle,
    source: String,
    category: Option<String>,
    suggested_file_name: Option<String>,
) -> Result<String, String> {
    let trimmed_source = source.trim();
    if trimmed_source.is_empty() {
        return Err("Image source is empty".to_string());
    }

    let mut perf = PerfLog::begin(
        "save_image_source_to_app_debug_dir",
        format!(
            "source_kind={} category={}",
            source_kind(trimmed_source),
            category.as_deref().unwrap_or("grid")
        ),
    );
    let (bytes, extension) = resolve_source_bytes(trimmed_source).await?;
    perf.stage(
        "resolve_source",
        format!("bytes={} ext={}", bytes.len(), extension),
    );

    let debug_dir = resolve_debug_dir(&app, category.as_deref().unwrap_or("grid"))?;
    perf.stage("resolve_debug_dir", format!("dir={}", debug_dir.display()));

    let stem = make_output_stem(suggested_file_name.as_deref(), "debug")?;
    let file_name = format!("{}.{}", stem, normalize_extension(&extension));
    let output_path = ensure_unique_path(debug_dir.join(file_name));

    write_bytes_to_path(&output_path, &bytes)?;
    let output = output_path.to_string_lossy().to_string();
    perf.stage("write_file", format!("path={}", output));
    perf.done(format!("bytes={}", bytes.len()));
    Ok(output)
}

#[tauri::command]
pub async fn copy_image_source_to_clipboard(app: AppHandle, source: String) -> Result<(), String> {
    let trimmed_source = source.trim();
    if trimmed_source.is_empty() {
        return Err("Image source is empty".to_string());
    }

    let mut perf = PerfLog::begin(
        "copy_image_source_to_clipboard",
        format!("source_kind={}", source_kind(trimmed_source)),
    );
    let (bytes, extension) = resolve_source_bytes(trimmed_source).await?;
    perf.stage(
        "resolve_source",
        format!("bytes={} ext={}", bytes.len(), extension),
    );

    let decoded = image::load_from_memory(&bytes)
        .map_err(|e| format!("Failed to decode image source: {}", e))?
        .to_rgba8();
    perf.stage(
        "decode_image",
        format!("size={}x{}", decoded.width(), decoded.height()),
    );

    let (width, height) = decoded.dimensions();
    let raw = decoded.into_raw();
    let image = tauri::image::Image::new(&raw, width, height);

    app.clipboard()
        .write_image(&image)
        .map_err(|e| format!("Failed to write image to clipboard: {}", e))?;
    perf.stage("clipboard_write", format!("size={}x{}", width, height));

    // Ensure source gets persisted for a stable local file path if needed by caller flows.
    if let Ok(path) = persist_image_bytes(&app, &bytes, &extension) {
        perf.stage("persist_for_stability", format!("path={}", path));
    }
    perf.done(format!("size={}x{}", width, height));

    Ok(())
}
