use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoryboardImageMetadata {
    pub grid_rows: u32,
    pub grid_cols: u32,
    pub frame_notes: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeStoryboardImagesPayload {
    pub frame_sources: Vec<String>,
    pub rows: u32,
    pub cols: u32,
    pub cell_gap: u32,
    pub outer_padding: u32,
    pub note_height: u32,
    pub font_size: u32,
    pub background_color: String,
    pub max_dimension: u32,
    pub show_frame_index: Option<bool>,
    pub show_frame_note: Option<bool>,
    pub note_placement: Option<String>,
    pub image_fit: Option<String>,
    pub frame_index_prefix: Option<String>,
    pub text_color: Option<String>,
    pub frame_notes: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeStoryboardImagesResult {
    pub image_path: String,
    pub canvas_width: u32,
    pub canvas_height: u32,
    pub cell_width: u32,
    pub cell_height: u32,
    pub gap: u32,
    pub padding: u32,
    pub note_height: u32,
    pub font_size: u32,
    pub text_overlay_applied: bool,
    pub metadata_embedded: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareNodeImageSourceResult {
    pub image_path: String,
    pub preview_image_path: String,
    pub aspect_ratio: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CropImageSourcePayload {
    pub source: String,
    pub aspect_ratio: Option<String>,
    pub crop_x: Option<f64>,
    pub crop_y: Option<f64>,
    pub crop_width: Option<f64>,
    pub crop_height: Option<f64>,
}
