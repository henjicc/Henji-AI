#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PpioMediaRewriteMode {
    DataUri,
    RawBase64,
    PublicUrl,
}

pub fn resolve_ppio_media_rewrite_mode(
    route: &str,
    field_name: Option<&str>,
    is_video: bool,
) -> PpioMediaRewriteMode {
    let normalized = field_name
        .map(|value| value.trim().to_lowercase())
        .unwrap_or_default();

    if normalized.ends_with("_base64") || normalized.ends_with("_base64s") {
        return PpioMediaRewriteMode::RawBase64;
    }

    if normalized.ends_with("_url") || normalized.ends_with("_urls") || is_video {
        return PpioMediaRewriteMode::PublicUrl;
    }

    if normalized == "reference_voice" {
        return PpioMediaRewriteMode::PublicUrl;
    }

    match route {
        "/async/kling-2.5-turbo-i2v" if normalized == "image" => PpioMediaRewriteMode::RawBase64,
        "/async/pixverse-v4.5-i2v" if normalized == "image" => PpioMediaRewriteMode::RawBase64,
        "/async/kling-v2.6-pro-motion-control" if normalized == "image" => {
            PpioMediaRewriteMode::PublicUrl
        }
        "/async/kling-v3.0-4k-i2v" if normalized == "image" || normalized == "end_image" => {
            PpioMediaRewriteMode::PublicUrl
        }
        "/async/kling-v3.0-motion-control" if normalized == "image" => {
            PpioMediaRewriteMode::PublicUrl
        }
        _ => PpioMediaRewriteMode::DataUri,
    }
}
