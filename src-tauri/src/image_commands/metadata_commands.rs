use image::DynamicImage;
use png::{BitDepth, ColorType, Compression, Decoder, Encoder, FilterType};
use std::io::Cursor;
use tauri::AppHandle;

use crate::image_commands::path_utils::persist_image_bytes;
use crate::image_commands::source::resolve_source_bytes;
use crate::image_commands::types::StoryboardImageMetadata;

const STORYBOARD_METADATA_PNG_TEXT_KEY: &str = "StoryboardCopilotMetadata";

fn read_storyboard_metadata_from_png_bytes(
    bytes: &[u8],
) -> Result<Option<StoryboardImageMetadata>, String> {
    let decoder = Decoder::new(Cursor::new(bytes));
    let reader = decoder
        .read_info()
        .map_err(|e| format!("Failed to decode PNG metadata: {}", e))?;
    let info = reader.info();

    for text_chunk in &info.uncompressed_latin1_text {
        if text_chunk.keyword == STORYBOARD_METADATA_PNG_TEXT_KEY {
            let parsed = serde_json::from_str::<StoryboardImageMetadata>(&text_chunk.text)
                .map_err(|e| format!("Invalid storyboard metadata JSON: {}", e))?;
            return Ok(Some(parsed));
        }
    }

    for text_chunk in &info.utf8_text {
        if text_chunk.keyword == STORYBOARD_METADATA_PNG_TEXT_KEY {
            let text = text_chunk
                .get_text()
                .map_err(|e| format!("Failed to decode iTXt metadata text: {}", e))?;
            let parsed = serde_json::from_str::<StoryboardImageMetadata>(&text)
                .map_err(|e| format!("Invalid storyboard metadata JSON: {}", e))?;
            return Ok(Some(parsed));
        }
    }

    for text_chunk in &info.compressed_latin1_text {
        if text_chunk.keyword == STORYBOARD_METADATA_PNG_TEXT_KEY {
            let text = text_chunk
                .get_text()
                .map_err(|e| format!("Failed to decode zTXt metadata text: {}", e))?;
            let parsed = serde_json::from_str::<StoryboardImageMetadata>(&text)
                .map_err(|e| format!("Invalid storyboard metadata JSON: {}", e))?;
            return Ok(Some(parsed));
        }
    }

    Ok(None)
}

pub(crate) fn encode_png_with_storyboard_metadata(
    image: &DynamicImage,
    metadata: &StoryboardImageMetadata,
) -> Result<Vec<u8>, String> {
    let metadata_json = serde_json::to_string(metadata)
        .map_err(|e| format!("Failed to serialize storyboard metadata: {}", e))?;
    let rgba = image.to_rgba8();
    let width = rgba.width().max(1);
    let height = rgba.height().max(1);
    let mut output = Vec::new();

    {
        let mut encoder = Encoder::new(&mut output, width, height);
        encoder.set_color(ColorType::Rgba);
        encoder.set_depth(BitDepth::Eight);
        encoder.set_compression(Compression::Fast);
        encoder.set_filter(FilterType::NoFilter);
        encoder
            .add_itxt_chunk(STORYBOARD_METADATA_PNG_TEXT_KEY.to_string(), metadata_json)
            .map_err(|e| format!("Failed to attach metadata into PNG: {}", e))?;

        let mut writer = encoder
            .write_header()
            .map_err(|e| format!("Failed to write PNG header: {}", e))?;
        writer
            .write_image_data(rgba.as_raw())
            .map_err(|e| format!("Failed to encode PNG pixels: {}", e))?;
    }

    Ok(output)
}

#[tauri::command]
pub async fn read_storyboard_image_metadata(
    source: String,
) -> Result<Option<StoryboardImageMetadata>, String> {
    let trimmed = source.trim();
    if trimmed.is_empty() {
        return Err("Image source is empty".to_string());
    }

    let (bytes, extension) = resolve_source_bytes(trimmed).await?;
    if extension != "png" {
        return Ok(None);
    }

    read_storyboard_metadata_from_png_bytes(&bytes)
}

#[tauri::command]
pub async fn embed_storyboard_image_metadata(
    app: AppHandle,
    source: String,
    metadata: StoryboardImageMetadata,
) -> Result<String, String> {
    let trimmed = source.trim();
    if trimmed.is_empty() {
        return Err("Image source is empty".to_string());
    }

    let (bytes, _extension) = resolve_source_bytes(trimmed).await?;
    let image = image::load_from_memory(&bytes)
        .map_err(|e| format!("Failed to decode image for metadata embedding: {}", e))?;
    let encoded = encode_png_with_storyboard_metadata(&image, &metadata)?;

    persist_image_bytes(&app, &encoded, "png")
}
