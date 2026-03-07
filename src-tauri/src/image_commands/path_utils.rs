use md5;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

pub fn normalize_extension(raw_ext: &str) -> String {
    let ext = raw_ext.trim().trim_start_matches('.').to_ascii_lowercase();
    if ext.is_empty() {
        return "png".to_string();
    }

    if ext == "jpeg" {
        return "jpg".to_string();
    }

    ext
}

pub fn extension_from_mime(mime: &str) -> String {
    let normalized = mime.trim().to_ascii_lowercase();
    match normalized.as_str() {
        "image/png" => "png".to_string(),
        "image/jpeg" => "jpg".to_string(),
        "image/jpg" => "jpg".to_string(),
        "image/webp" => "webp".to_string(),
        "image/gif" => "gif".to_string(),
        "image/bmp" => "bmp".to_string(),
        "image/avif" => "avif".to_string(),
        _ => "png".to_string(),
    }
}

pub fn mime_from_extension(ext: &str) -> &'static str {
    match normalize_extension(ext).as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "avif" => "image/avif",
        _ => "application/octet-stream",
    }
}

pub fn resolve_data_root_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let app_local = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("Failed to resolve app local data dir: {}", e))?;

    let root = app_local.join("Henji-AI");
    std::fs::create_dir_all(&root).map_err(|e| format!("Failed to create data root dir: {}", e))?;
    Ok(root)
}

pub fn resolve_uploads_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let uploads_dir = resolve_data_root_dir(app)?.join("Uploads");
    std::fs::create_dir_all(&uploads_dir)
        .map_err(|e| format!("Failed to create uploads dir: {}", e))?;
    Ok(uploads_dir)
}

pub fn resolve_debug_dir(app: &AppHandle, category: &str) -> Result<PathBuf, String> {
    let normalized_category = sanitize_file_stem(category);
    let debug_dir = resolve_data_root_dir(app)?
        .join("debug")
        .join(normalized_category);
    std::fs::create_dir_all(&debug_dir)
        .map_err(|e| format!("Failed to create debug dir: {}", e))?;
    Ok(debug_dir)
}

pub fn persist_image_bytes(
    app: &AppHandle,
    bytes: &[u8],
    extension: &str,
) -> Result<String, String> {
    if bytes.is_empty() {
        return Err("Image bytes are empty".to_string());
    }

    let digest = md5::compute(bytes);
    let ext = normalize_extension(extension);
    let filename = format!("{:x}.{}", digest, ext);
    let output_path = resolve_uploads_dir(app)?.join(filename);

    if !output_path.exists() {
        std::fs::write(&output_path, bytes)
            .map_err(|e| format!("Failed to persist generated image: {}", e))?;
    }

    Ok(output_path.to_string_lossy().to_string())
}

pub fn sanitize_file_stem(raw: &str) -> String {
    let trimmed = raw.trim();
    let fallback = "storyboard-image";
    if trimmed.is_empty() {
        return fallback.to_string();
    }

    let mut sanitized = String::with_capacity(trimmed.len());
    for ch in trimmed.chars() {
        let blocked = matches!(ch, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*');
        if blocked || ch.is_control() {
            continue;
        }
        sanitized.push(ch);
    }

    let compact = sanitized.trim().trim_matches('.').to_string();
    if compact.is_empty() {
        fallback.to_string()
    } else {
        compact
    }
}

pub fn ensure_unique_path(path: PathBuf) -> PathBuf {
    if !path.exists() {
        return path;
    }

    let parent = path
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."));
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("storyboard-image");
    let ext = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("png");

    for index in 1..10_000_u32 {
        let candidate = parent.join(format!("{}-{}.{}", stem, index, ext));
        if !candidate.exists() {
            return candidate;
        }
    }

    path
}

pub fn ensure_output_path_with_extension(path: &Path, extension: &str) -> PathBuf {
    if path.extension().is_some() {
        return path.to_path_buf();
    }

    let mut with_extension = path.to_path_buf();
    with_extension.set_extension(normalize_extension(extension));
    with_extension
}
