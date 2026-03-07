use base64::{engine::general_purpose::STANDARD, Engine};
use image::imageops::FilterType;
use image::GenericImageView;
use std::time::Instant;
use tauri::AppHandle;

use crate::image_commands::path_utils::persist_image_bytes;
use crate::image_commands::perf_log::{source_kind, PerfLog};
use crate::image_commands::source::resolve_source_bytes;
use crate::image_commands::split_prepare_utils::{
    decode_base64_payload, encode_jpeg_bytes, encode_png_bytes, parse_aspect_ratio,
    reduce_aspect_ratio, split_dynamic_image,
};
use crate::image_commands::types::{CropImageSourcePayload, PrepareNodeImageSourceResult};

fn prepare_from_bytes(
    app: &AppHandle,
    bytes: &[u8],
    extension: &str,
    max_preview_dimension: u32,
    perf: &mut PerfLog,
) -> Result<PrepareNodeImageSourceResult, String> {
    let decoded = image::load_from_memory(bytes)
        .map_err(|e| format!("Failed to decode image source: {}", e))?;
    let (width, height) = decoded.dimensions();
    perf.stage(
        "decode_image",
        format!("bytes={} size={}x{}", bytes.len(), width, height),
    );

    let aspect_ratio = reduce_aspect_ratio(width, height);

    let image_path = persist_image_bytes(app, bytes, extension)?;
    perf.stage(
        "persist_original",
        format!("ext={} image_path={}", extension, image_path),
    );

    let safe_max = max_preview_dimension.max(64);
    let longest_side = width.max(height);

    if longest_side <= safe_max {
        perf.stage(
            "preview_bypass",
            format!("longest_side={} <= {}", longest_side, safe_max),
        );
        return Ok(PrepareNodeImageSourceResult {
            image_path: image_path.clone(),
            preview_image_path: image_path,
            aspect_ratio,
        });
    }

    let preview = decoded.resize(safe_max, safe_max, FilterType::Lanczos3);
    let preview_bytes = encode_jpeg_bytes(&preview, 86)?;
    perf.stage(
        "build_preview",
        format!(
            "preview_size={}x{} preview_bytes={}",
            preview.width(),
            preview.height(),
            preview_bytes.len()
        ),
    );

    let preview_path = persist_image_bytes(app, &preview_bytes, "jpg")?;
    perf.stage("persist_preview", format!("preview_path={}", preview_path));

    Ok(PrepareNodeImageSourceResult {
        image_path,
        preview_image_path: preview_path,
        aspect_ratio,
    })
}

#[tauri::command]
pub async fn split_image(
    image_base64: String,
    rows: u32,
    cols: u32,
    line_thickness: Option<u32>,
) -> Result<Vec<String>, String> {
    let line = line_thickness.unwrap_or(0);
    let mut perf = PerfLog::begin(
        "split_image",
        format!("rows={} cols={} line={}", rows.max(1), cols.max(1), line),
    );

    let bytes = decode_base64_payload(&image_base64)?;
    perf.stage("decode_base64", format!("bytes={}", bytes.len()));

    let image =
        image::load_from_memory(&bytes).map_err(|e| format!("Failed to decode image: {}", e))?;
    perf.stage(
        "decode_image",
        format!("size={}x{}", image.width(), image.height()),
    );

    let frames = split_dynamic_image(&image, rows, cols, line)?;
    perf.stage("split", format!("frames={}", frames.len()));

    let encode_started = Instant::now();
    let mut outputs = Vec::with_capacity(frames.len());
    for frame in frames {
        let png = encode_png_bytes(&frame)?;
        outputs.push(format!("data:image/png;base64,{}", STANDARD.encode(png)));
    }
    perf.stage(
        "encode_data_url",
        format!(
            "outputs={} elapsed_ms={}",
            outputs.len(),
            encode_started.elapsed().as_millis()
        ),
    );
    perf.done(format!("outputs={}", outputs.len()));

    Ok(outputs)
}

#[tauri::command]
pub async fn split_image_source(
    app: AppHandle,
    source: String,
    rows: u32,
    cols: u32,
    line_thickness: Option<u32>,
) -> Result<Vec<String>, String> {
    let trimmed = source.trim();
    if trimmed.is_empty() {
        return Err("Image source is empty".to_string());
    }

    let line = line_thickness.unwrap_or(0);
    let mut perf = PerfLog::begin(
        "split_image_source",
        format!(
            "source_kind={} rows={} cols={} line={}",
            source_kind(trimmed),
            rows.max(1),
            cols.max(1),
            line
        ),
    );

    let (bytes, _ext) = resolve_source_bytes(trimmed).await?;
    perf.stage("resolve_source", format!("bytes={}", bytes.len()));

    let image = image::load_from_memory(&bytes)
        .map_err(|e| format!("Failed to decode source image: {}", e))?;
    perf.stage(
        "decode_image",
        format!("size={}x{}", image.width(), image.height()),
    );

    let frames = split_dynamic_image(&image, rows, cols, line)?;
    perf.stage("split", format!("frames={}", frames.len()));

    let persist_started = Instant::now();
    let mut outputs = Vec::with_capacity(frames.len());
    for frame in frames {
        let png = encode_png_bytes(&frame)?;
        outputs.push(persist_image_bytes(&app, &png, "png")?);
    }
    perf.stage(
        "persist_frames",
        format!(
            "outputs={} elapsed_ms={}",
            outputs.len(),
            persist_started.elapsed().as_millis()
        ),
    );
    perf.done(format!("outputs={}", outputs.len()));

    Ok(outputs)
}

#[tauri::command]
pub async fn prepare_node_image_source(
    app: AppHandle,
    source: String,
    max_preview_dimension: Option<u32>,
) -> Result<PrepareNodeImageSourceResult, String> {
    let trimmed = source.trim();
    if trimmed.is_empty() {
        return Err("Image source is empty".to_string());
    }

    let safe_max = max_preview_dimension.unwrap_or(512).max(64);
    let mut perf = PerfLog::begin(
        "prepare_node_image_source",
        format!(
            "source_kind={} max_preview={}",
            source_kind(trimmed),
            safe_max
        ),
    );

    let (bytes, extension) = resolve_source_bytes(trimmed).await?;
    perf.stage(
        "resolve_source",
        format!("bytes={} ext={}", bytes.len(), extension),
    );

    let result = prepare_from_bytes(&app, &bytes, &extension, safe_max, &mut perf)?;
    perf.done(format!(
        "aspect={} preview_same={}",
        result.aspect_ratio,
        result.image_path == result.preview_image_path
    ));
    Ok(result)
}

#[tauri::command]
pub async fn prepare_node_image_binary(
    app: AppHandle,
    bytes: Vec<u8>,
    extension: Option<String>,
    max_preview_dimension: Option<u32>,
) -> Result<PrepareNodeImageSourceResult, String> {
    let safe_extension = extension.unwrap_or_else(|| "png".to_string());
    let safe_max = max_preview_dimension.unwrap_or(512).max(64);
    let mut perf = PerfLog::begin(
        "prepare_node_image_binary",
        format!(
            "bytes={} ext={} max_preview={}",
            bytes.len(),
            safe_extension,
            safe_max
        ),
    );

    let result = prepare_from_bytes(&app, &bytes, &safe_extension, safe_max, &mut perf)?;
    perf.done(format!(
        "aspect={} preview_same={}",
        result.aspect_ratio,
        result.image_path == result.preview_image_path
    ));
    Ok(result)
}

#[tauri::command]
pub async fn crop_image_source(
    app: AppHandle,
    payload: CropImageSourcePayload,
) -> Result<String, String> {
    let trimmed_source = payload.source.trim();
    if trimmed_source.is_empty() {
        return Err("Image source is empty".to_string());
    }

    let mut perf = PerfLog::begin(
        "crop_image_source",
        format!(
            "source_kind={} has_aspect={} has_crop={}",
            source_kind(trimmed_source),
            payload.aspect_ratio.is_some(),
            payload.crop_x.is_some()
                && payload.crop_y.is_some()
                && payload.crop_width.is_some()
                && payload.crop_height.is_some()
        ),
    );

    let (bytes, _ext) = resolve_source_bytes(trimmed_source).await?;
    perf.stage("resolve_source", format!("bytes={}", bytes.len()));

    let image = image::load_from_memory(&bytes)
        .map_err(|e| format!("Failed to decode image source: {}", e))?;
    perf.stage(
        "decode_image",
        format!("size={}x{}", image.width(), image.height()),
    );

    let mut x = 0_u32;
    let mut y = 0_u32;
    let mut w = image.width().max(1);
    let mut h = image.height().max(1);

    let has_explicit_crop = payload.crop_x.is_some()
        && payload.crop_y.is_some()
        && payload.crop_width.is_some()
        && payload.crop_height.is_some();

    if has_explicit_crop {
        let max_x = image.width().saturating_sub(1) as f64;
        let max_y = image.height().saturating_sub(1) as f64;
        x = payload.crop_x.unwrap_or(0.0).max(0.0).min(max_x).floor() as u32;
        y = payload.crop_y.unwrap_or(0.0).max(0.0).min(max_y).floor() as u32;
        w = payload
            .crop_width
            .unwrap_or(image.width() as f64)
            .max(1.0)
            .floor() as u32;
        h = payload
            .crop_height
            .unwrap_or(image.height() as f64)
            .max(1.0)
            .floor() as u32;

        w = w.min(image.width().saturating_sub(x).max(1));
        h = h.min(image.height().saturating_sub(y).max(1));
    } else if let Some(aspect_ratio) = payload.aspect_ratio.as_deref().and_then(parse_aspect_ratio)
    {
        let source_ratio = image.width() as f64 / image.height().max(1) as f64;
        if source_ratio > aspect_ratio {
            w = ((image.height() as f64) * aspect_ratio).floor().max(1.0) as u32;
            x = image.width().saturating_sub(w) / 2;
        } else {
            h = ((image.width() as f64) / aspect_ratio).floor().max(1.0) as u32;
            y = image.height().saturating_sub(h) / 2;
        }
    }
    perf.stage("resolve_crop", format!("x={} y={} w={} h={}", x, y, w, h));

    let cropped = image.crop_imm(x, y, w.max(1), h.max(1));
    let png = encode_png_bytes(&cropped)?;
    perf.stage(
        "encode_png",
        format!(
            "output_size={}x{} png_bytes={}",
            cropped.width(),
            cropped.height(),
            png.len()
        ),
    );

    let out = persist_image_bytes(&app, &png, "png")?;
    perf.stage("persist", format!("path={}", out));
    perf.done(format!(
        "output_size={}x{}",
        cropped.width(),
        cropped.height()
    ));
    Ok(out)
}
