pub mod bizyair;
pub mod fal;
pub mod kie;

use crate::ai_runtime::errors::{AiResult, AiRuntimeError};
use crate::ai_runtime::key_store;
use base64::Engine;
use serde_json::{Map, Value};
use std::future::Future;
use std::path::Path;
use std::pin::Pin;

const IMAGE_FIELD_HINTS: [&str; 14] = [
    "image",
    "images",
    "img_url",
    "img_urls",
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

const UPLOAD_PROVIDER_PARAM: &str = "__upload_provider";
const UPLOAD_FALLBACK_PARAM: &str = "__upload_fallback";
const UPLOAD_PROVIDER_PRIORITY: [&str; 3] = ["bizyair", "kie", "fal"];
const PUBLIC_URL_UPLOAD_PROVIDERS: [&str; 2] = ["bizyair", "kie"];

#[derive(Debug, Clone, Copy)]
enum MediaKind {
    Image,
    Video,
    Unknown,
}

#[derive(Debug, Clone)]
pub struct UploadStrategy {
    pub primary_provider: Option<String>,
    pub fallback_enabled: bool,
}

pub fn resolve_upload_strategy(params: &Map<String, Value>) -> UploadStrategy {
    let primary_provider = params
        .get(UPLOAD_PROVIDER_PARAM)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);

    let fallback_enabled = params
        .get(UPLOAD_FALLBACK_PARAM)
        .and_then(Value::as_bool)
        .unwrap_or(true);

    UploadStrategy {
        primary_provider,
        fallback_enabled,
    }
}

pub async fn preprocess_request_body(
    provider_id: &str,
    route: &str,
    body: &Value,
    strategy: &UploadStrategy,
) -> AiResult<Value> {
    let mut next = body.clone();
    preprocess_field_value(provider_id, route, strategy, MediaKind::Unknown, None, &mut next).await?;
    Ok(next)
}

fn preprocess_field_value<'a>(
    provider_id: &'a str,
    route: &'a str,
    strategy: &'a UploadStrategy,
    media_kind: MediaKind,
    field_name: Option<&'a str>,
    value: &'a mut Value,
) -> Pin<Box<dyn Future<Output = AiResult<()>> + Send + 'a>> {
    Box::pin(async move {
        match value {
            Value::String(source) if !matches!(media_kind, MediaKind::Unknown) => {
                let next =
                    rewrite_media_source(provider_id, route, strategy, media_kind, field_name, source)
                        .await?;
                *source = next;
                Ok(())
            }
            Value::Array(items) => {
                for item in items.iter_mut() {
                    preprocess_field_value(provider_id, route, strategy, media_kind, field_name, item)
                        .await?;
                }
                Ok(())
            }
            Value::Object(obj) => {
                for (key, nested_value) in obj.iter_mut() {
                    let next_kind = inherit_media_kind(media_kind, key);
                    preprocess_field_value(
                        provider_id,
                        route,
                        strategy,
                        next_kind,
                        Some(key.as_str()),
                        nested_value,
                    )
                    .await?;
                }
                Ok(())
            }
            _ => Ok(()),
        }
    })
}

fn inherit_media_kind(current: MediaKind, key: &str) -> MediaKind {
    let nested = classify_media_key(key);
    if matches!(nested, MediaKind::Unknown) {
        current
    } else {
        nested
    }
}

async fn rewrite_media_source(
    provider_id: &str,
    route: &str,
    strategy: &UploadStrategy,
    media_kind: MediaKind,
    field_name: Option<&str>,
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
    if requires_public_media_url(provider_id, route, field_name) {
        return upload_for_public_url(&prepared, strategy).await;
    }
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
                let try_bizyair =
                    bizyair::upload_to_bizyair(&bizyair_key, &prepared.bytes, &prepared.filename)
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

async fn upload_for_public_url(prepared: &PreparedMediaBinary, strategy: &UploadStrategy) -> AiResult<String> {
    let providers = build_public_url_upload_candidates(strategy);
    let mut failures: Vec<String> = Vec::new();
    eprintln!(
        "[ai_runtime][upload][public_url] primary={:?} fallback={} candidates={}",
        strategy.primary_provider,
        strategy.fallback_enabled,
        providers.join(",")
    );

    if providers.is_empty() && !strategy.fallback_enabled {
        if let Some(primary) = strategy.primary_provider.as_deref() {
            failures.push(format!("当前首选上传服务 {} 不支持该模型所需的公网 URL 上传", display_upload_provider(primary)));
        }
    }

    for provider in providers {
        match try_upload_with_provider(provider, prepared).await? {
            UploadAttempt::Success(url) => {
                eprintln!(
                    "[ai_runtime][upload][public_url] success provider={} filename={}",
                    provider,
                    prepared.filename
                );
                return Ok(url);
            }
            UploadAttempt::Skipped => {
                eprintln!(
                    "[ai_runtime][upload][public_url] skipped provider={} filename={}",
                    provider,
                    prepared.filename
                );
                failures.push(format!("{} 未配置或不支持当前公网 URL 上传", display_upload_provider(provider)));
            }
            UploadAttempt::Failed(message) => {
                eprintln!(
                    "[ai_runtime][upload][public_url] failed provider={} filename={} error={}",
                    provider,
                    prepared.filename,
                    message
                );
                failures.push(message);
            }
        }
    }

    if failures.is_empty() {
        failures.push("未检测到可用的公网上传服务。".to_string());
    }

    Err(AiRuntimeError::new(
        "public_media_url_required",
        format!(
            "当前 PPIO 模型字段要求公网 HTTP/HTTPS 媒体 URL。请直接传入公网 URL，或先配置 BizyAir / KIE 的 API Key 以启用自动上传。{}",
            failures.join("；")
        ),
    ))
}

enum UploadAttempt {
    Success(String),
    Skipped,
    Failed(String),
}

async fn try_upload_with_provider(provider: &str, prepared: &PreparedMediaBinary) -> AiResult<UploadAttempt> {
    match provider {
        "bizyair" => {
            let Some(api_key) = key_store::get_provider_api_key("bizyair")? else {
                return Ok(UploadAttempt::Skipped);
            };

            match bizyair::upload_to_bizyair(&api_key, &prepared.bytes, &prepared.filename).await {
                Ok(url) => Ok(UploadAttempt::Success(url)),
                Err(err) => Ok(UploadAttempt::Failed(format!("BizyAir 上传失败: {}", err))),
            }
        }
        "kie" => {
            let Some(api_key) = key_store::get_provider_api_key("kie")? else {
                return Ok(UploadAttempt::Skipped);
            };

            match kie::upload_to_kie(&api_key, &prepared.bytes, &prepared.filename).await {
                Ok(url) => Ok(UploadAttempt::Success(url)),
                Err(err) => Ok(UploadAttempt::Failed(format!("KIE 上传失败: {}", err))),
            }
        }
        _ => Ok(UploadAttempt::Skipped),
    }
}

fn build_public_url_upload_candidates(strategy: &UploadStrategy) -> Vec<&'static str> {
    let mut candidates: Vec<&'static str> = Vec::new();

    if let Some(primary) = strategy.primary_provider.as_deref() {
        if let Some(provider) = match_public_url_provider(primary) {
            candidates.push(provider);
        } else if !strategy.fallback_enabled {
            return Vec::new();
        }
    }

    if strategy.fallback_enabled {
        for provider in UPLOAD_PROVIDER_PRIORITY {
            if !PUBLIC_URL_UPLOAD_PROVIDERS.contains(&provider) || candidates.contains(&provider) {
                continue;
            }
            candidates.push(provider);
        }
    }

    candidates
}

fn match_public_url_provider(provider: &str) -> Option<&'static str> {
    PUBLIC_URL_UPLOAD_PROVIDERS
        .into_iter()
        .find(|candidate| *candidate == provider)
}

fn display_upload_provider(provider: &str) -> &'static str {
    match provider {
        "bizyair" => "BizyAir",
        "kie" => "KIE",
        "fal" => "Fal",
        _ => "Upload provider",
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

    if IMAGE_FIELD_HINTS
        .iter()
        .any(|hint| normalized.contains(hint))
    {
        return MediaKind::Image;
    }

    if VIDEO_FIELD_HINTS
        .iter()
        .any(|hint| normalized.contains(hint))
    {
        return MediaKind::Video;
    }

    MediaKind::Unknown
}

fn requires_public_media_url(provider_id: &str, route: &str, field_name: Option<&str>) -> bool {
    if provider_id != "ppio" {
        return false;
    }

    if route != "/async/wan-2.5-i2v-preview" {
        return false;
    }

    let Some(field_name) = field_name else {
        return false;
    };

    let normalized = field_name.to_lowercase();
    normalized.contains("img_url") || normalized.ends_with("_url") || normalized.ends_with("_urls")
}

fn parse_data_uri(input: &str) -> AiResult<Option<(Vec<u8>, String)>> {
    if !input.starts_with("data:") {
        return Ok(None);
    }

    let Some((header, payload)) = input.split_once(',') else {
        return Err(AiRuntimeError::new(
            "invalid_data_uri",
            "Invalid data URI format",
        ));
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
