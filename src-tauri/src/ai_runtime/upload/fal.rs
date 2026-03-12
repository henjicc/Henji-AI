use crate::ai_runtime::errors::AiResult;
use base64::Engine;

pub async fn upload_to_fal(_api_key: &str, bytes: &[u8], filename: &str) -> AiResult<String> {
    let mime = infer_mime(filename);
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    Ok(format!("data:{};base64,{}", mime, encoded))
}

fn infer_mime(filename: &str) -> &'static str {
    let lower = filename.to_lowercase();
    if lower.ends_with(".png") {
        return "image/png";
    }
    if lower.ends_with(".webp") {
        return "image/webp";
    }
    if lower.ends_with(".gif") {
        return "image/gif";
    }
    if lower.ends_with(".mp4") {
        return "video/mp4";
    }
    if lower.ends_with(".webm") {
        return "video/webm";
    }
    "application/octet-stream"
}
