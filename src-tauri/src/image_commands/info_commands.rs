use image::ImageReader;
use serde::Serialize;
use std::io::Cursor;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::image_commands::source::{decode_file_url_path, resolve_source_bytes};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageInfoResult {
    pub source: String,
    pub file_name: Option<String>,
    pub extension: String,
    pub width: u32,
    pub height: u32,
    pub file_size_bytes: u64,
    pub created_at: Option<u64>,
    pub modified_at: Option<u64>,
}

fn system_time_to_unix_millis(value: SystemTime) -> Option<u64> {
    value
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|duration| u64::try_from(duration.as_millis()).ok())
}

#[tauri::command]
pub async fn read_image_info(source: String) -> Result<ImageInfoResult, String> {
    let trimmed = source.trim();
    if trimmed.is_empty() {
        return Err("Image source is empty".to_string());
    }

    let (bytes, extension) = resolve_source_bytes(trimmed).await?;
    let (raw_width, raw_height) = ImageReader::new(Cursor::new(&bytes))
        .with_guessed_format()
        .map_err(|e| format!("Failed to guess image format: {}", e))?
        .into_dimensions()
        .map_err(|e| format!("Failed to parse image dimensions: {}", e))?;

    let mut file_name: Option<String> = None;
    let mut created_at: Option<u64> = None;
    let mut modified_at: Option<u64> = None;

    let local_path = if trimmed.starts_with("file://") {
        Some(PathBuf::from(decode_file_url_path(trimmed)))
    } else if trimmed.starts_with("http://")
        || trimmed.starts_with("https://")
        || trimmed.starts_with("data:")
    {
        None
    } else {
        Some(PathBuf::from(trimmed))
    };

    if let Some(path) = local_path {
        if let Some(name) = path.file_name().and_then(|value| value.to_str()) {
            if !name.trim().is_empty() {
                file_name = Some(name.to_string());
            }
        }

        if let Ok(metadata) = std::fs::metadata(&path) {
            created_at = metadata.created().ok().and_then(system_time_to_unix_millis);
            modified_at = metadata.modified().ok().and_then(system_time_to_unix_millis);
        }
    }

    Ok(ImageInfoResult {
        source: trimmed.to_string(),
        file_name,
        extension,
        width: raw_width.max(1),
        height: raw_height.max(1),
        file_size_bytes: bytes.len() as u64,
        created_at,
        modified_at,
    })
}
