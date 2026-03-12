use crate::ai_runtime::errors::{AiResult, AiRuntimeError};
use reqwest::header::CONTENT_TYPE;
use std::path::PathBuf;
use tauri::Manager;

pub async fn save_media_from_url(app: &tauri::AppHandle, url: &str) -> AiResult<Option<String>> {
    if url.trim().is_empty() {
        return Ok(None);
    }

    let response = reqwest::Client::new()
        .get(url)
        .send()
        .await
        .map_err(|e| AiRuntimeError::new("media_download_failed", e.to_string()))?;

    if !response.status().is_success() {
        return Err(AiRuntimeError::new(
            "media_download_failed",
            format!("HTTP {} while downloading media", response.status()),
        ));
    }

    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_string();

    let bytes = response
        .bytes()
        .await
        .map_err(|e| AiRuntimeError::new("media_download_failed", e.to_string()))?;

    let file_name = build_file_name(url, &bytes, &content_type);
    let file_path = ensure_media_dir(app)?.join(file_name);

    std::fs::write(&file_path, &bytes)?;
    Ok(Some(file_path.to_string_lossy().to_string()))
}

fn ensure_media_dir(app: &tauri::AppHandle) -> AiResult<PathBuf> {
    let base_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| AiRuntimeError::new("path_error", e.to_string()))?;

    let media_dir = base_dir.join("Henji-AI").join("Media");
    std::fs::create_dir_all(&media_dir)?;
    Ok(media_dir)
}

fn build_file_name(url: &str, bytes: &[u8], content_type: &str) -> String {
    let digest_hex = format!("{:x}", md5::compute(bytes));
    let ext = infer_extension(url, content_type);
    format!("ai_{}.{}", &digest_hex[..16], ext)
}

fn infer_extension(url: &str, content_type: &str) -> String {
    let lower = url.to_lowercase();
    for ext in ["png", "jpg", "jpeg", "webp", "gif", "mp4", "webm", "mp3", "wav"] {
        if lower.contains(&format!(".{}", ext)) {
            return ext.to_string();
        }
    }

    if content_type.contains("image/png") {
        return "png".to_string();
    }
    if content_type.contains("image/jpeg") {
        return "jpg".to_string();
    }
    if content_type.contains("image/webp") {
        return "webp".to_string();
    }
    if content_type.contains("video/mp4") {
        return "mp4".to_string();
    }
    if content_type.contains("video/webm") {
        return "webm".to_string();
    }
    if content_type.contains("audio/mpeg") {
        return "mp3".to_string();
    }

    "bin".to_string()
}
