pub mod bizyair;
pub mod fal;
pub mod kie;

use crate::ai_runtime::errors::{AiResult, AiRuntimeError};
use crate::ai_runtime::key_store;
use base64::Engine;
use serde_json::{Map, Value};
use std::path::Path;

const IMAGE_FIELD_HINTS: [&str; 12] = [
    "image",
    "images",
    "image_url",
    "image_urls",
    "start_image_url",
    "end_image_url",
    "first_frame_image_url",
    "last_frame_image_url",
    "reference_image_urls",
    "input_urls",
    "reference_images",
    "input_image",
];

const VIDEO_FIELD_HINTS: [&str; 8] = [
    "video",
    "videos",
    "video_url",
    "video_urls",
    "reference_video_urls",
    "uploaded_video_file_paths",
    "uploaded_video_paths",
    "input_video",
];

#[derive(Debug, Clone, Copy)]
enum MediaKind {
    Image,
    Video,
    Unknown,
}

pub async fn preprocess_request_body(provider_id: &str, body: &Value) -> AiResult<Value> {
    let mut next = body.clone();

    let Some(map) = next.as_object_mut() else {
        return Ok(next);
    };

    for (key, value) in map.iter_mut() {
        let media_kind = classify_media_key(key);
        if matches!(media_kind, MediaKind::Unknown) {
            continue;
        }

        preprocess_field_value(provider_id, media_kind, value).await?;
    }

    Ok(next)
}

async fn preprocess_field_value(
    provider_id: &str,
    media_kind: MediaKind,
    value: &mut Value,
) -> AiResult<()> {
    match value {
        Value::String(source) => {
            let next = rewrite_media_source(provider_id, media_kind, source).await?;
            *value = Value::String(next);
            Ok(())
        }
        Value::Array(items) => {
            for item in items.iter_mut() {
                if let Value::String(source) = item {
                    let next = rewrite_media_source(provider_id, media_kind, source).await?;
                    *item = Value::String(next);
                }
            }
            Ok(())
        }
        Value::Object(obj) => preprocess_embedded_urls(provider_id, media_kind, obj).await,
        _ => Ok(()),
    }
}

async fn preprocess_embedded_urls(
    provider_id: &str,
    media_kind: MediaKind,
    obj: &mut Map<String, Value>,
) -> AiResult<()> {
    for key in ["url", "image_url", "video_url", "src"] {
        if let Some(Value::String(source)) = obj.get_mut(key) {
            let next = rewrite_media_source(provider_id, media_kind, source).await?;
            *source = next;
        }
    }
    Ok(())
}

async fn rewrite_media_source(
    provider_id: &str,
    media_kind: MediaKind,
    source: &str,
) -> AiResult<String> {
    let trimmed = source.trim();
    if trimmed.is_empty() {
        return Ok(source.to_string());
    }

    if is_remote_http_url(trimmed) {
        return Ok(source.to_string());
    }

    // Some non-media config fields (e.g. "sequential_image_generation": "disabled")
    // can match media-like key hints; skip values that don't look like real media sources.
    if !trimmed.starts_with("data:") && normalize_local_source(trimmed).is_none() {
        return Ok(source.to_string());
    }

    let prepared = prepare_media_binary(trimmed, media_kind)?;

    match provider_id {
        // Fal accepts data URI payloads directly.
        "fal" => fal::upload_to_fal("", &prepared.bytes, &prepared.filename).await,
        "ppio" => Ok(to_data_uri(&prepared.bytes, &prepared.mime_type)),

        // KIE / ModelScope expect a hosted URL.
        "kie" | "modelscope" => {
            if let Some(kie_key) = key_store::get_provider_api_key("kie")? {
                return kie::upload_to_kie(&kie_key, &prepared.bytes, &prepared.filename).await;
            }

            if let Some(bizyair_key) = key_store::get_provider_api_key("bizyair")? {
                let try_bizyair = bizyair::upload_to_bizyair(
                    &bizyair_key,
                    &prepared.bytes,
                    &prepared.filename,
                )
                .await;
                if try_bizyair.is_ok() {
                    return try_bizyair;
                }
            }

            // As a last fallback, keep backward compatibility by sending data URI.
            Ok(to_data_uri(&prepared.bytes, &prepared.mime_type))
        }

        _ => Ok(to_data_uri(&prepared.bytes, &prepared.mime_type)),
    }
}

#[derive(Debug)]
struct PreparedMediaBinary {
    bytes: Vec<u8>,
    mime_type: String,
    filename: String,
}

fn prepare_media_binary(source: &str, media_kind: MediaKind) -> AiResult<PreparedMediaBinary> {
    if let Some((bytes, mime)) = parse_data_uri(source)? {
        return Ok(PreparedMediaBinary {
            filename: default_filename(media_kind, &mime),
            bytes,
            mime_type: mime,
        });
    }

    let local_path = normalize_local_source(source).ok_or_else(|| {
        AiRuntimeError::new(
            "unsupported_media_source",
            format!("Unsupported media source: {}", source),
        )
    })?;

    let bytes = std::fs::read(&local_path)
        .map_err(|e| AiRuntimeError::new("media_read_failed", e.to_string()))?;

    let mime = infer_mime_from_path(&local_path, media_kind);
    let filename = Path::new(&local_path)
        .file_name()
        .and_then(|s| s.to_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| default_filename(media_kind, &mime));

    Ok(PreparedMediaBinary {
        bytes,
        mime_type: mime,
        filename,
    })
}

fn classify_media_key(key: &str) -> MediaKind {
    let normalized = key.to_lowercase();

    if IMAGE_FIELD_HINTS.iter().any(|hint| normalized.contains(hint)) {
        return MediaKind::Image;
    }

    if VIDEO_FIELD_HINTS.iter().any(|hint| normalized.contains(hint)) {
        return MediaKind::Video;
    }

    MediaKind::Unknown
}

fn parse_data_uri(input: &str) -> AiResult<Option<(Vec<u8>, String)>> {
    if !input.starts_with("data:") {
        return Ok(None);
    }

    let Some((header, payload)) = input.split_once(',') else {
        return Err(AiRuntimeError::new("invalid_data_uri", "Invalid data URI format"));
    };

    let mime = header
        .strip_prefix("data:")
        .and_then(|rest| rest.split(';').next())
        .filter(|v| !v.trim().is_empty())
        .unwrap_or("application/octet-stream")
        .to_string();

    let bytes = if header.contains(";base64") {
        base64::engine::general_purpose::STANDARD
            .decode(payload)
            .map_err(|e| AiRuntimeError::new("invalid_data_uri", e.to_string()))?
    } else {
        urlencoding::decode(payload)
            .map_err(|e| AiRuntimeError::new("invalid_data_uri", e.to_string()))?
            .as_bytes()
            .to_vec()
    };

    Ok(Some((bytes, mime)))
}

fn normalize_local_source(source: &str) -> Option<String> {
    if source.starts_with("http://asset.localhost/") {
        let encoded = source.trim_start_matches("http://asset.localhost/");
        let decoded = urlencoding::decode(encoded).ok()?.to_string();
        return Some(strip_windows_drive_prefix(decoded));
    }

    if source.starts_with("http://tauri.localhost/") {
        let encoded = source.trim_start_matches("http://tauri.localhost/");
        let decoded = urlencoding::decode(encoded).ok()?.to_string();
        return Some(strip_windows_drive_prefix(decoded));
    }

    if is_local_path(source) {
        return Some(source.to_string());
    }

    None
}

fn strip_windows_drive_prefix(path: String) -> String {
    let chars: Vec<char> = path.chars().collect();
    if chars.len() >= 3 && chars[0] == '/' && chars[2] == ':' {
        return path[1..].to_string();
    }
    path
}

fn is_remote_http_url(value: &str) -> bool {
    (value.starts_with("http://") || value.starts_with("https://"))
        && !value.starts_with("http://asset.localhost/")
        && !value.starts_with("http://tauri.localhost/")
}

fn is_local_path(value: &str) -> bool {
    if value.starts_with("\\\\") || value.starts_with('/') || value.starts_with("~/") {
        return true;
    }

    let bytes = value.as_bytes();
    bytes.len() >= 3 && bytes[1] == b':' && (bytes[2] == b'\\' || bytes[2] == b'/')
}

fn to_data_uri(bytes: &[u8], mime_type: &str) -> String {
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    format!("data:{};base64,{}", mime_type, encoded)
}

fn infer_mime_from_path(path: &str, media_kind: MediaKind) -> String {
    let ext = Path::new(path)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();

    match ext.as_str() {
        "png" => "image/png".to_string(),
        "jpg" | "jpeg" => "image/jpeg".to_string(),
        "webp" => "image/webp".to_string(),
        "gif" => "image/gif".to_string(),
        "bmp" => "image/bmp".to_string(),
        "mp4" => "video/mp4".to_string(),
        "webm" => "video/webm".to_string(),
        "mov" => "video/quicktime".to_string(),
        "mp3" => "audio/mpeg".to_string(),
        "wav" => "audio/wav".to_string(),
        _ => match media_kind {
            MediaKind::Image => "image/jpeg".to_string(),
            MediaKind::Video => "video/mp4".to_string(),
            MediaKind::Unknown => "application/octet-stream".to_string(),
        },
    }
}

fn default_filename(media_kind: MediaKind, mime_type: &str) -> String {
    let ext = if mime_type.contains("png") {
        "png"
    } else if mime_type.contains("jpeg") || mime_type.contains("jpg") {
        "jpg"
    } else if mime_type.contains("webp") {
        "webp"
    } else if mime_type.contains("mp4") {
        "mp4"
    } else if mime_type.contains("webm") {
        "webm"
    } else {
        "bin"
    };

    let prefix = match media_kind {
        MediaKind::Image => "image",
        MediaKind::Video => "video",
        MediaKind::Unknown => "file",
    };

    format!("{}_{}.{}", prefix, chrono_like_timestamp_ms(), ext)
}

fn chrono_like_timestamp_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}
