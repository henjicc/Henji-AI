use crate::ai_runtime::errors::{AiResult, AiRuntimeError};
use reqwest::multipart::{Form, Part};
use serde_json::Value;

const KIE_UPLOAD_URL: &str = "https://kieai.redpandaai.co/api/file-stream-upload";

pub async fn upload_to_kie(api_key: &str, bytes: &[u8], filename: &str) -> AiResult<String> {
    let part = Part::bytes(bytes.to_vec())
        .file_name(filename.to_string())
        .mime_str(infer_mime(filename))
        .map_err(|e| AiRuntimeError::new("upload_failed", e.to_string()))?;

    let form = Form::new()
        .text("uploadPath", "henji-uploads")
        .text("fileName", filename.to_string())
        .part("file", part);

    let response = reqwest::Client::new()
        .post(KIE_UPLOAD_URL)
        .bearer_auth(api_key)
        .multipart(form)
        .send()
        .await?;

    let status = response.status();
    let payload = response
        .json::<Value>()
        .await
        .map_err(|e| AiRuntimeError::new("upload_failed", e.to_string()))?;

    if !status.is_success() {
        return Err(AiRuntimeError::new(
            "upload_failed",
            format!("KIE upload HTTP {}: {}", status, payload),
        ));
    }

    let file_url = payload
        .pointer("/data/fileUrl")
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .or_else(|| {
            payload
                .pointer("/data/downloadUrl")
                .and_then(Value::as_str)
                .map(ToString::to_string)
        });

    file_url.ok_or_else(|| {
        AiRuntimeError::new(
            "upload_failed",
            format!("KIE upload missing file URL: {}", payload),
        )
    })
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
