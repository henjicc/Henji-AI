use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use tauri::AppHandle;
use zip::write::SimpleFileOptions;
use zip::{ZipArchive, ZipWriter};

use crate::image_commands::path_utils::resolve_data_root_dir;

const PACKAGE_MANIFEST_NAME: &str = "manifest.json";
const PACKAGE_MEDIA_DIR: &str = "media/";
const SUPPORTED_FORMAT_VERSION: u64 = 1;
const MAX_MANIFEST_BYTES: u64 = 64 * 1024 * 1024;
const MAX_SINGLE_MEDIA_BYTES: u64 = 4 * 1024 * 1024 * 1024;
const MAX_TOTAL_MEDIA_BYTES: u64 = 16 * 1024 * 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageMediaFile {
    pub src_path: String,
    pub package_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedProjectPackage {
    pub manifest_json: String,
    /// 包内路径（media/xxx.ext）-> 解压后的本地绝对路径
    pub path_map: HashMap<String, String>,
}

fn validate_package_path(package_path: &str) -> Result<(), String> {
    if !package_path.starts_with(PACKAGE_MEDIA_DIR) {
        return Err(format!("Invalid package media path: {}", package_path));
    }
    let relative = Path::new(package_path);
    for component in relative.components() {
        match component {
            Component::Normal(_) => {}
            _ => return Err(format!("Unsafe package path: {}", package_path)),
        }
    }
    Ok(())
}

fn normalize_media_extension(package_path: &str) -> String {
    Path::new(package_path)
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .filter(|value| !value.is_empty() && value.len() <= 8)
        .unwrap_or_else(|| "bin".to_string())
}

#[tauri::command]
pub async fn export_project_package(
    manifest_json: String,
    media_files: Vec<PackageMediaFile>,
    target_path: String,
) -> Result<(), String> {
    let target = PathBuf::from(target_path.trim());
    if target.as_os_str().is_empty() {
        return Err("Export target path is empty".to_string());
    }
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create export dir: {}", e))?;
    }

    let file = File::create(&target).map_err(|e| format!("Failed to create package file: {}", e))?;
    let mut writer = ZipWriter::new(file);
    let options = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .large_file(true);
    let stored_options = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Stored)
        .large_file(true);

    writer
        .start_file(PACKAGE_MANIFEST_NAME, options)
        .map_err(|e| format!("Failed to start manifest entry: {}", e))?;
    writer
        .write_all(manifest_json.as_bytes())
        .map_err(|e| format!("Failed to write manifest: {}", e))?;

    let mut written_paths: HashMap<String, ()> = HashMap::new();
    for media in media_files {
        validate_package_path(&media.package_path)?;
        if written_paths.contains_key(&media.package_path) {
            continue;
        }

        let mut source = File::open(&media.src_path)
            .map_err(|e| format!("Failed to open media {}: {}", media.src_path, e))?;

        // 多数媒体已是压缩格式，存储模式避免重复压缩开销
        writer
            .start_file(&media.package_path, stored_options)
            .map_err(|e| format!("Failed to start media entry: {}", e))?;
        std::io::copy(&mut source, &mut writer)
            .map_err(|e| format!("Failed to write media {}: {}", media.src_path, e))?;
        written_paths.insert(media.package_path, ());
    }

    writer
        .finish()
        .map_err(|e| format!("Failed to finalize package: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn import_project_package(
    app: AppHandle,
    zip_path: String,
) -> Result<ImportedProjectPackage, String> {
    let source = PathBuf::from(zip_path.trim());
    let file = File::open(&source).map_err(|e| format!("Failed to open package: {}", e))?;
    let mut archive = ZipArchive::new(file).map_err(|e| format!("Invalid package file: {}", e))?;

    let manifest_json = {
        let mut manifest_entry = archive
            .by_name(PACKAGE_MANIFEST_NAME)
            .map_err(|_| "Package manifest.json missing".to_string())?;
        if manifest_entry.size() > MAX_MANIFEST_BYTES {
            return Err("Package manifest is too large".to_string());
        }
        let mut content = String::new();
        manifest_entry
            .read_to_string(&mut content)
            .map_err(|e| format!("Failed to read manifest: {}", e))?;
        content
    };

    let manifest_value: serde_json::Value = serde_json::from_str(&manifest_json)
        .map_err(|e| format!("Invalid manifest JSON: {}", e))?;
    let format_version = manifest_value
        .get("formatVersion")
        .and_then(|value| value.as_u64())
        .unwrap_or(0);
    if format_version == 0 || format_version > SUPPORTED_FORMAT_VERSION {
        return Err(format!(
            "Unsupported package format version: {} (supported <= {})",
            format_version, SUPPORTED_FORMAT_VERSION
        ));
    }

    let imported_dir = resolve_data_root_dir(&app)?
        .join("Uploads")
        .join("imported");
    std::fs::create_dir_all(&imported_dir)
        .map_err(|e| format!("Failed to create import dir: {}", e))?;

    let mut path_map: HashMap<String, String> = HashMap::new();
    let mut total_bytes: u64 = 0;

    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|e| format!("Failed to read package entry: {}", e))?;
        let entry_name = entry.name().to_string();
        if !entry_name.starts_with(PACKAGE_MEDIA_DIR) || entry_name.ends_with('/') {
            continue;
        }
        validate_package_path(&entry_name)?;

        let declared_size = entry.size();
        if declared_size > MAX_SINGLE_MEDIA_BYTES {
            return Err(format!("Package media too large: {}", entry_name));
        }
        total_bytes = total_bytes.saturating_add(declared_size);
        if total_bytes > MAX_TOTAL_MEDIA_BYTES {
            return Err("Package total media size exceeds limit".to_string());
        }

        let mut bytes: Vec<u8> = Vec::with_capacity(declared_size.min(64 * 1024 * 1024) as usize);
        entry
            .read_to_end(&mut bytes)
            .map_err(|e| format!("Failed to extract {}: {}", entry_name, e))?;

        let mut hasher = Sha256::new();
        hasher.update(&bytes);
        let digest = hasher.finalize();
        let hash_prefix = digest
            .iter()
            .take(8)
            .map(|byte| format!("{:02x}", byte))
            .collect::<String>();
        let extension = normalize_media_extension(&entry_name);
        let dest_path = imported_dir.join(format!("{}.{}", hash_prefix, extension));

        if !dest_path.exists() {
            std::fs::write(&dest_path, &bytes)
                .map_err(|e| format!("Failed to write imported media: {}", e))?;
        }

        path_map.insert(entry_name, dest_path.to_string_lossy().to_string());
    }

    Ok(ImportedProjectPackage {
        manifest_json,
        path_map,
    })
}
