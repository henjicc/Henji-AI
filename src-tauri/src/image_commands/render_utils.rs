use ab_glyph::{FontArc, PxScale};
use image::imageops::{overlay, FilterType};
use image::{DynamicImage, Rgba, RgbaImage};
use imageproc::drawing::text_size;
use std::sync::OnceLock;

static OVERLAY_FONT: OnceLock<Option<FontArc>> = OnceLock::new();

pub fn parse_hex_color(color: &str) -> Rgba<u8> {
    let value = color.trim().trim_start_matches('#');
    let parse_pair =
        |start: usize| -> Option<u8> { u8::from_str_radix(value.get(start..start + 2)?, 16).ok() };

    match value.len() {
        6 => {
            let (Some(r), Some(g), Some(b)) = (parse_pair(0), parse_pair(2), parse_pair(4)) else {
                return Rgba([15, 17, 21, 255]);
            };
            Rgba([r, g, b, 255])
        }
        8 => {
            let (Some(r), Some(g), Some(b), Some(a)) =
                (parse_pair(0), parse_pair(2), parse_pair(4), parse_pair(6))
            else {
                return Rgba([15, 17, 21, 255]);
            };
            Rgba([r, g, b, a])
        }
        _ => Rgba([15, 17, 21, 255]),
    }
}

pub fn fill_rect(image: &mut RgbaImage, x: u32, y: u32, width: u32, height: u32, color: Rgba<u8>) {
    if width == 0 || height == 0 {
        return;
    }

    let max_x = x.saturating_add(width).min(image.width());
    let max_y = y.saturating_add(height).min(image.height());

    for yy in y..max_y {
        for xx in x..max_x {
            image.put_pixel(xx, yy, color);
        }
    }
}

fn blend_pixel(bottom: Rgba<u8>, top: Rgba<u8>) -> Rgba<u8> {
    let top_alpha = top[3] as u16;
    if top_alpha == 0 {
        return bottom;
    }
    if top_alpha == 255 {
        return top;
    }

    let bottom_alpha = bottom[3] as u16;
    let inv_top_alpha = 255_u16.saturating_sub(top_alpha);
    let out_alpha = top_alpha + (bottom_alpha * inv_top_alpha + 127) / 255;
    if out_alpha == 0 {
        return Rgba([0, 0, 0, 0]);
    }

    let blend_channel = |bottom_channel: u8, top_channel: u8| -> u8 {
        let bottom_premul = bottom_channel as u32 * bottom_alpha as u32;
        let top_premul = top_channel as u32 * top_alpha as u32;
        let out_premul = top_premul + ((bottom_premul * inv_top_alpha as u32 + 127) / 255);
        let out = (out_premul + (out_alpha as u32 / 2)) / out_alpha as u32;
        out.min(255) as u8
    };

    Rgba([
        blend_channel(bottom[0], top[0]),
        blend_channel(bottom[1], top[1]),
        blend_channel(bottom[2], top[2]),
        out_alpha as u8,
    ])
}

pub fn fill_rect_alpha_blend(
    image: &mut RgbaImage,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
    color: Rgba<u8>,
) {
    if width == 0 || height == 0 {
        return;
    }

    let max_x = x.saturating_add(width).min(image.width());
    let max_y = y.saturating_add(height).min(image.height());

    for yy in y..max_y {
        for xx in x..max_x {
            let current = *image.get_pixel(xx, yy);
            image.put_pixel(xx, yy, blend_pixel(current, color));
        }
    }
}

pub fn load_overlay_font() -> Option<&'static FontArc> {
    OVERLAY_FONT
        .get_or_init(|| {
            #[cfg(target_os = "windows")]
            let candidate_paths = [
                "C:\\Windows\\Fonts\\msyh.ttc",
                "C:\\Windows\\Fonts\\msyhbd.ttc",
                "C:\\Windows\\Fonts\\msyhl.ttc",
                "C:\\Windows\\Fonts\\simhei.ttf",
                "C:\\Windows\\Fonts\\segoeui.ttf",
                "C:\\Windows\\Fonts\\arial.ttf",
            ];

            #[cfg(target_os = "macos")]
            let candidate_paths = [
                "/System/Library/Fonts/PingFang.ttc",
                "/System/Library/Fonts/Hiragino Sans GB.ttc",
                "/System/Library/Fonts/STHeiti Medium.ttc",
                "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
                "/System/Library/Fonts/Supplemental/Arial.ttf",
            ];

            #[cfg(not(any(target_os = "windows", target_os = "macos")))]
            let candidate_paths = [
                "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
                "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
                "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
                "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            ];

            for path in candidate_paths {
                if let Ok(bytes) = std::fs::read(path) {
                    if let Ok(font) = FontArc::try_from_vec(bytes) {
                        return Some(font);
                    }
                }
            }

            None
        })
        .as_ref()
}

pub fn trim_text_to_width(font: &FontArc, scale: PxScale, text: &str, max_width: u32) -> String {
    let normalized = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let safe_text = normalized.trim();
    if safe_text.is_empty() {
        return String::new();
    }

    if text_size(scale, font, safe_text).0 <= max_width {
        return safe_text.to_string();
    }

    let mut content = safe_text.to_string();
    while content.chars().count() > 1 {
        content.pop();
        let with_ellipsis = format!("{}...", content);
        if text_size(scale, font, &with_ellipsis).0 <= max_width {
            return with_ellipsis;
        }
    }

    "...".to_string()
}

pub fn draw_fitted_image(
    canvas: &mut RgbaImage,
    source: &DynamicImage,
    dx: u32,
    dy: u32,
    dw: u32,
    dh: u32,
    fit: &str,
) {
    if dw == 0 || dh == 0 {
        return;
    }

    let sw = source.width().max(1);
    let sh = source.height().max(1);
    let source_ratio = sw as f64 / sh as f64;
    let target_ratio = dw as f64 / dh as f64;

    let rendered = if fit.eq_ignore_ascii_case("contain") {
        source.resize(dw, dh, FilterType::Lanczos3).to_rgba8()
    } else {
        let cropped = if source_ratio > target_ratio {
            let crop_w = ((sh as f64) * target_ratio).floor().max(1.0) as u32;
            let offset_x = sw.saturating_sub(crop_w) / 2;
            source.crop_imm(offset_x, 0, crop_w, sh)
        } else {
            let crop_h = ((sw as f64) / target_ratio).floor().max(1.0) as u32;
            let offset_y = sh.saturating_sub(crop_h) / 2;
            source.crop_imm(0, offset_y, sw, crop_h)
        };
        cropped
            .resize_exact(dw, dh, FilterType::Lanczos3)
            .to_rgba8()
    };

    let rw = rendered.width();
    let rh = rendered.height();
    let tx = if fit.eq_ignore_ascii_case("contain") {
        dx.saturating_add(dw.saturating_sub(rw) / 2)
    } else {
        dx
    };
    let ty = if fit.eq_ignore_ascii_case("contain") {
        dy.saturating_add(dh.saturating_sub(rh) / 2)
    } else {
        dy
    };

    overlay(canvas, &rendered, tx as i64, ty as i64);
}
