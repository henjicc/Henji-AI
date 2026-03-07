use ab_glyph::PxScale;
use image::{DynamicImage, Rgba, RgbaImage};
use imageproc::drawing::{draw_text_mut, text_size};
use tauri::AppHandle;

use crate::image_commands::metadata_commands::encode_png_with_storyboard_metadata;
use crate::image_commands::path_utils::persist_image_bytes;
use crate::image_commands::perf_log::{source_kind, PerfLog};
use crate::image_commands::render_utils::{
    draw_fitted_image, fill_rect, fill_rect_alpha_blend, load_overlay_font, parse_hex_color,
    trim_text_to_width,
};
use crate::image_commands::source::resolve_source_bytes;
use crate::image_commands::types::{
    MergeStoryboardImagesPayload, MergeStoryboardImagesResult, StoryboardImageMetadata,
};

async fn load_source_image(source: &str) -> Result<DynamicImage, String> {
    let (bytes, _ext) = resolve_source_bytes(source).await?;
    image::load_from_memory(&bytes).map_err(|e| format!("Failed to decode image source: {}", e))
}

#[tauri::command]
pub async fn merge_storyboard_images(
    app: AppHandle,
    payload: MergeStoryboardImagesPayload,
) -> Result<MergeStoryboardImagesResult, String> {
    let rows = payload.rows.max(1);
    let cols = payload.cols.max(1);
    let frame_count = rows.saturating_mul(cols).max(1) as usize;
    let first_source_kind = payload
        .frame_sources
        .iter()
        .find(|source| !source.trim().is_empty())
        .map(|source| source_kind(source.trim()))
        .unwrap_or("none");
    let mut perf = PerfLog::begin(
        "merge_storyboard_images",
        format!(
            "rows={} cols={} frames={} first_source_kind={}",
            rows, cols, frame_count, first_source_kind
        ),
    );

    let mut frames: Vec<Option<DynamicImage>> = Vec::with_capacity(frame_count);
    let mut reference_size: Option<(u32, u32)> = None;
    let mut loaded_frames = 0_usize;
    for index in 0..frame_count {
        let source = payload
            .frame_sources
            .get(index)
            .map(|value| value.trim())
            .unwrap_or("");
        if source.is_empty() {
            frames.push(None);
            continue;
        }

        match load_source_image(source).await {
            Ok(image) => {
                if reference_size.is_none() {
                    reference_size = Some((image.width().max(64), image.height().max(64)));
                }
                frames.push(Some(image));
                loaded_frames += 1;
            }
            Err(_) => frames.push(None),
        }
    }
    perf.stage(
        "load_frames",
        format!("loaded={}/{}", loaded_frames, frame_count),
    );

    let (mut cell_width, mut cell_height) =
        reference_size.ok_or_else(|| "没有可合并的分镜图片".to_string())?;
    let gap = payload.cell_gap;
    let padding = payload.outer_padding;
    let show_frame_index = payload.show_frame_index.unwrap_or(false);
    let show_frame_note = payload.show_frame_note.unwrap_or(false);
    let note_placement_bottom = payload
        .note_placement
        .as_deref()
        .map(|value| value.eq_ignore_ascii_case("bottom"))
        .unwrap_or(false);
    let mut note_height = if show_frame_note && note_placement_bottom {
        payload.note_height
    } else {
        0
    };
    let mut font_size = payload.font_size.max(10);

    let mut output_width = padding
        .saturating_mul(2)
        .saturating_add(cols.saturating_mul(cell_width))
        .saturating_add(cols.saturating_sub(1).saturating_mul(gap));
    let mut output_height = padding
        .saturating_mul(2)
        .saturating_add(rows.saturating_mul(cell_height.saturating_add(note_height)))
        .saturating_add(rows.saturating_sub(1).saturating_mul(gap));

    let max_dimension = payload.max_dimension.max(256);
    let max_edge = output_width.max(output_height);
    if max_edge > max_dimension {
        let scale = max_dimension as f64 / max_edge as f64;
        cell_width = ((cell_width as f64) * scale).round().max(32.0) as u32;
        cell_height = ((cell_height as f64) * scale).round().max(32.0) as u32;
        note_height = ((note_height as f64) * scale).round().max(0.0) as u32;
        font_size = ((font_size as f64) * scale).round().max(10.0) as u32;
        output_width = padding
            .saturating_mul(2)
            .saturating_add(cols.saturating_mul(cell_width))
            .saturating_add(cols.saturating_sub(1).saturating_mul(gap));
        output_height = padding
            .saturating_mul(2)
            .saturating_add(rows.saturating_mul(cell_height.saturating_add(note_height)))
            .saturating_add(rows.saturating_sub(1).saturating_mul(gap));
    }
    perf.stage(
        "compute_layout",
        format!(
            "cell={}x{} canvas={}x{} gap={} padding={} note_h={} font={}",
            cell_width,
            cell_height,
            output_width,
            output_height,
            gap,
            padding,
            note_height,
            font_size
        ),
    );

    let fit = payload.image_fit.as_deref().unwrap_or("cover");
    let frame_index_prefix = payload
        .frame_index_prefix
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("S")
        .to_string();
    let text_color = parse_hex_color(payload.text_color.as_deref().unwrap_or("#f8fafc"));
    let frame_notes = payload.frame_notes.unwrap_or_default();
    let overlay_requested = show_frame_index || show_frame_note;
    let overlay_font = if overlay_requested {
        load_overlay_font()
    } else {
        None
    };
    let text_overlay_applied = !overlay_requested || overlay_font.is_some();
    let overlay_scale = PxScale::from(font_size.max(10) as f32);
    perf.stage(
        "overlay_setup",
        format!(
            "overlay_requested={} overlay_ready={} fit={}",
            overlay_requested, text_overlay_applied, fit
        ),
    );

    let mut canvas = RgbaImage::from_pixel(
        output_width.max(1),
        output_height.max(1),
        parse_hex_color(&payload.background_color),
    );
    let placeholder = Rgba([255, 255, 255, 20]);

    for index in 0..frame_count {
        let row = index as u32 / cols;
        let col = index as u32 % cols;
        let x = padding.saturating_add(col.saturating_mul(cell_width.saturating_add(gap)));
        let y = padding.saturating_add(
            row.saturating_mul(cell_height.saturating_add(note_height).saturating_add(gap)),
        );

        fill_rect(&mut canvas, x, y, cell_width, cell_height, placeholder);
        if let Some(frame) = frames.get(index).and_then(|value| value.as_ref()) {
            draw_fitted_image(&mut canvas, frame, x, y, cell_width, cell_height, fit);
        }

        if let Some(font) = overlay_font {
            if show_frame_index {
                let label = format!("{}{}", frame_index_prefix, index + 1);
                let (label_w, label_h) = text_size(overlay_scale, font, &label);
                let badge_padding_x = (font_size as f32 * 0.35).round().max(6.0) as u32;
                let badge_height = (font_size as f32 * 1.15).round().max(18.0) as u32;
                let badge_width = label_w.saturating_add(badge_padding_x.saturating_mul(2));
                let badge_x = x.saturating_add(6);
                let badge_y = y.saturating_add(6);
                fill_rect_alpha_blend(
                    &mut canvas,
                    badge_x,
                    badge_y,
                    badge_width,
                    badge_height,
                    Rgba([0, 0, 0, 166]),
                );
                let text_x = badge_x.saturating_add(badge_padding_x) as i32;
                let text_y =
                    badge_y.saturating_add(badge_height.saturating_sub(label_h) / 2) as i32;
                draw_text_mut(
                    &mut canvas,
                    text_color,
                    text_x,
                    text_y,
                    overlay_scale,
                    font,
                    &label,
                );
            }

            if show_frame_note {
                let note_raw = frame_notes
                    .get(index)
                    .map(|value| value.trim())
                    .unwrap_or("");
                if !note_raw.is_empty() {
                    let note = trim_text_to_width(
                        font,
                        overlay_scale,
                        note_raw,
                        cell_width.saturating_sub(14),
                    );
                    if !note.is_empty() {
                        let (_note_w, note_h) = text_size(overlay_scale, font, &note);
                        if note_placement_bottom && note_height > 0 {
                            let note_x = x.saturating_add(4) as i32;
                            let note_y = y
                                .saturating_add(cell_height)
                                .saturating_add(note_height.saturating_sub(note_h) / 2)
                                as i32;
                            draw_text_mut(
                                &mut canvas,
                                text_color,
                                note_x,
                                note_y,
                                overlay_scale,
                                font,
                                &note,
                            );
                        } else {
                            let overlay_height = (font_size as f32 * 1.35).round().max(18.0) as u32;
                            let overlay_y =
                                y.saturating_add(cell_height).saturating_sub(overlay_height);
                            fill_rect_alpha_blend(
                                &mut canvas,
                                x,
                                overlay_y,
                                cell_width,
                                overlay_height,
                                Rgba([0, 0, 0, 153]),
                            );
                            let note_x = x.saturating_add(7) as i32;
                            let note_y = overlay_y
                                .saturating_add(overlay_height.saturating_sub(note_h) / 2)
                                as i32;
                            draw_text_mut(
                                &mut canvas,
                                text_color,
                                note_x,
                                note_y,
                                overlay_scale,
                                font,
                                &note,
                            );
                        }
                    }
                }
            }
        }
    }
    perf.stage("render_canvas", format!("cells={}", frame_count));

    let mut metadata_frame_notes = frame_notes;
    if metadata_frame_notes.len() < frame_count {
        metadata_frame_notes.resize(frame_count, String::new());
    } else {
        metadata_frame_notes.truncate(frame_count);
    }

    let metadata = StoryboardImageMetadata {
        grid_rows: rows,
        grid_cols: cols,
        frame_notes: metadata_frame_notes,
    };
    let encoded =
        encode_png_with_storyboard_metadata(&DynamicImage::ImageRgba8(canvas), &metadata)?;
    perf.stage(
        "encode_png_with_metadata",
        format!(
            "bytes={} notes={}",
            encoded.len(),
            metadata.frame_notes.len()
        ),
    );
    let image_path = persist_image_bytes(&app, &encoded, "png")?;
    perf.stage("persist", format!("path={}", image_path));
    perf.done(format!(
        "canvas={}x{} overlay_ready={}",
        output_width.max(1),
        output_height.max(1),
        text_overlay_applied
    ));
    Ok(MergeStoryboardImagesResult {
        image_path,
        canvas_width: output_width.max(1),
        canvas_height: output_height.max(1),
        cell_width,
        cell_height,
        gap,
        padding,
        note_height,
        font_size,
        text_overlay_applied,
        metadata_embedded: true,
    })
}
