use base64::{engine::general_purpose::STANDARD, Engine};
use image::codecs::jpeg::JpegEncoder;
use image::{DynamicImage, GenericImageView};
use png::{BitDepth, ColorType, Compression, Encoder, FilterType};

fn split_sizes(total: u32, segments: u32) -> Vec<u32> {
    let safe_segments = segments.max(1);
    let base = total / safe_segments;
    let remainder = total % safe_segments;

    (0..safe_segments)
        .map(|idx| base + if idx < remainder { 1 } else { 0 })
        .collect()
}

fn resolve_line_thickness(
    image_width: u32,
    image_height: u32,
    rows: u32,
    cols: u32,
    line_thickness: u32,
) -> u32 {
    if line_thickness == 0 {
        return 0;
    }

    let max_by_width = if cols > 1 {
        image_width.saturating_sub(cols) / (cols - 1)
    } else {
        line_thickness
    };
    let max_by_height = if rows > 1 {
        image_height.saturating_sub(rows) / (rows - 1)
    } else {
        line_thickness
    };

    line_thickness.min(max_by_width.min(max_by_height))
}

fn gcd_u32(a: u32, b: u32) -> u32 {
    let mut x = a.max(1);
    let mut y = b.max(1);

    while y != 0 {
        let temp = y;
        y = x % y;
        x = temp;
    }

    x.max(1)
}

pub fn reduce_aspect_ratio(width: u32, height: u32) -> String {
    let safe_width = width.max(1);
    let safe_height = height.max(1);
    let gcd = gcd_u32(safe_width, safe_height);
    format!("{}:{}", safe_width / gcd, safe_height / gcd)
}

pub fn parse_aspect_ratio(value: &str) -> Option<f64> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("free") {
        return None;
    }

    let (w, h) = trimmed.split_once(':')?;
    let width = w.trim().parse::<f64>().ok()?;
    let height = h.trim().parse::<f64>().ok()?;
    if width <= 0.0 || height <= 0.0 {
        return None;
    }
    Some(width / height)
}

pub fn decode_base64_payload(input: &str) -> Result<Vec<u8>, String> {
    if input.starts_with("data:") {
        let payload = input
            .split_once(',')
            .map(|(_, encoded)| encoded)
            .ok_or_else(|| "Invalid data URL".to_string())?;
        return STANDARD
            .decode(payload)
            .map_err(|e| format!("Failed to decode base64 payload: {}", e));
    }

    STANDARD
        .decode(input)
        .map_err(|e| format!("Failed to decode base64 payload: {}", e))
}

pub fn split_dynamic_image(
    image: &DynamicImage,
    rows: u32,
    cols: u32,
    line_thickness: u32,
) -> Result<Vec<DynamicImage>, String> {
    let safe_rows = rows.max(1);
    let safe_cols = cols.max(1);

    let (width, height) = image.dimensions();
    let resolved_line = resolve_line_thickness(width, height, safe_rows, safe_cols, line_thickness);
    let usable_width =
        width.saturating_sub((safe_cols.saturating_sub(1)).saturating_mul(resolved_line));
    let usable_height =
        height.saturating_sub((safe_rows.saturating_sub(1)).saturating_mul(resolved_line));

    if usable_width < safe_cols || usable_height < safe_rows {
        return Err("分割线过粗，无法完成切割".to_string());
    }

    let col_widths = split_sizes(usable_width, safe_cols);
    let row_heights = split_sizes(usable_height, safe_rows);

    let mut x_offsets = Vec::with_capacity(safe_cols as usize);
    let mut x = 0_u32;
    for col in 0..safe_cols {
        x_offsets.push(x);
        x = x.saturating_add(col_widths[col as usize]);
        if col < safe_cols - 1 {
            x = x.saturating_add(resolved_line);
        }
    }

    let mut y_offsets = Vec::with_capacity(safe_rows as usize);
    let mut y = 0_u32;
    for row in 0..safe_rows {
        y_offsets.push(y);
        y = y.saturating_add(row_heights[row as usize]);
        if row < safe_rows - 1 {
            y = y.saturating_add(resolved_line);
        }
    }

    let mut outputs = Vec::with_capacity((safe_rows * safe_cols) as usize);
    for row in 0..safe_rows {
        for col in 0..safe_cols {
            outputs.push(image.crop_imm(
                x_offsets[col as usize],
                y_offsets[row as usize],
                col_widths[col as usize],
                row_heights[row as usize],
            ));
        }
    }

    Ok(outputs)
}

pub fn encode_png_bytes(image: &DynamicImage) -> Result<Vec<u8>, String> {
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
        let mut writer = encoder
            .write_header()
            .map_err(|e| format!("Failed to write PNG header: {}", e))?;
        writer
            .write_image_data(rgba.as_raw())
            .map_err(|e| format!("Failed to encode PNG pixels: {}", e))?;
    }

    Ok(output)
}

pub fn encode_jpeg_bytes(image: &DynamicImage, quality: u8) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    let mut encoder = JpegEncoder::new_with_quality(&mut bytes, quality);
    encoder
        .encode_image(image)
        .map_err(|e| format!("Failed to encode preview jpeg: {}", e))?;
    Ok(bytes)
}
