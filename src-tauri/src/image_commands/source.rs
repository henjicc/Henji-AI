use base64::{engine::general_purpose::STANDARD, Engine};
use std::path::{Path, PathBuf};

use crate::image_commands::path_utils::{extension_from_mime, normalize_extension};

fn extension_from_path_like(value: &str) -> Option<String> {
    let cleaned = value
        .split('#')
        .next()
        .unwrap_or(value)
        .split('?')
        .next()
        .unwrap_or(value);

    Path::new(cleaned)
        .extension()
        .and_then(|item| item.to_str())
        .map(normalize_extension)
}

fn decode_file_url_path(value: &str) -> String {
    let raw = value.trim_start_matches("file://");
    let decoded = urlencoding::decode(raw)
        .map(|result| result.into_owned())
        .unwrap_or_else(|_| raw.to_string());

    if cfg!(target_os = "windows")
        && decoded.starts_with('/')
        && decoded.len() > 2
        && decoded.as_bytes().get(2) == Some(&b':')
    {
        decoded[1..].to_string()
    } else {
        decoded
    }
}

fn parse_data_url(source: &str) -> Result<(Vec<u8>, String), String> {
    let (meta, payload) = source
        .split_once(',')
        .ok_or_else(|| "Invalid data URL format".to_string())?;

    if !meta.starts_with("data:") || !meta.ends_with(";base64") {
        return Err("Only base64 data URL is supported".to_string());
    }

    let mime = meta
        .strip_prefix("data:")
        .and_then(|v| v.strip_suffix(";base64"))
        .unwrap_or("image/png");

    let bytes = STANDARD
        .decode(payload)
        .map_err(|e| format!("Failed to decode data URL: {}", e))?;

    Ok((bytes, extension_from_mime(mime)))
}

fn read_local_file(path: &Path) -> Result<(Vec<u8>, String), String> {
    let bytes =
        std::fs::read(path).map_err(|e| format!("Failed to read local image source: {}", e))?;
    let ext = path
        .extension()
        .and_then(|item| item.to_str())
        .map(normalize_extension)
        .unwrap_or_else(|| "png".to_string());

    Ok((bytes, ext))
}

async fn read_remote_file(source: &str) -> Result<(Vec<u8>, String), String> {
    let response = reqwest::get(source)
        .await
        .map_err(|e| format!("Failed to download remote image: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "Remote image request failed with status {}",
            response.status()
        ));
    }

    let mime_ext = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(extension_from_mime);

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read remote image body: {}", e))?
        .to_vec();

    let ext = mime_ext
        .or_else(|| extension_from_path_like(source))
        .unwrap_or_else(|| "png".to_string());

    Ok((bytes, ext))
}

pub async fn resolve_source_bytes(source: &str) -> Result<(Vec<u8>, String), String> {
    if source.starts_with("data:") {
        return parse_data_url(source);
    }

    if source.starts_with("http://") || source.starts_with("https://") {
        return read_remote_file(source).await;
    }

    if source.starts_with("file://") {
        let file_path = decode_file_url_path(source);
        return read_local_file(&PathBuf::from(file_path));
    }

    read_local_file(&PathBuf::from(source))
}
