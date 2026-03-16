use crate::ai_runtime::errors::{AiResult, AiRuntimeError};
use base64::Engine;
use hmac::{Hmac, Mac};
use serde_json::{json, Value};
use sha1::Sha1;

const BIZYAIR_TOKEN_URL: &str = "https://api.bizyair.cn/x/v1/upload/token";
const BIZYAIR_COMMIT_URL: &str = "https://api.bizyair.cn/x/v1/input_resource/commit";

type HmacSha1 = Hmac<Sha1>;

pub async fn upload_to_bizyair(api_key: &str, bytes: &[u8], filename: &str) -> AiResult<String> {
    let token_data = fetch_upload_token(api_key, filename).await?;

    let file_info = token_data
        .pointer("/data/file")
        .and_then(Value::as_object)
        .ok_or_else(|| AiRuntimeError::new("upload_failed", "BizyAir token missing data.file"))?;

    let storage = token_data
        .pointer("/data/storage")
        .and_then(Value::as_object)
        .ok_or_else(|| {
            AiRuntimeError::new("upload_failed", "BizyAir token missing data.storage")
        })?;

    let access_key_id = read_string(file_info, "access_key_id")?;
    let access_key_secret = read_string(file_info, "access_key_secret")?;
    let security_token = read_string(file_info, "security_token")?;
    let object_key = read_string(file_info, "object_key")?;
    let bucket = read_string(storage, "bucket")?;
    let endpoint = read_string(storage, "endpoint")?;

    upload_to_aliyun_oss(
        bytes,
        filename,
        &endpoint,
        &bucket,
        &object_key,
        &access_key_id,
        &access_key_secret,
        &security_token,
    )
    .await?;

    commit_resource(api_key, filename, &object_key).await
}

async fn fetch_upload_token(api_key: &str, filename: &str) -> AiResult<Value> {
    let response = reqwest::Client::new()
        .get(BIZYAIR_TOKEN_URL)
        .query(&[("file_name", filename), ("file_type", "inputs")])
        .header("Authorization", to_bearer_auth(api_key))
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
            format!("BizyAir token HTTP {}: {}", status, payload),
        ));
    }

    if payload.get("status").and_then(Value::as_bool) != Some(true) {
        let message = payload
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("BizyAir token request failed");
        return Err(AiRuntimeError::new("upload_failed", message));
    }

    Ok(payload)
}

#[allow(clippy::too_many_arguments)]
async fn upload_to_aliyun_oss(
    bytes: &[u8],
    filename: &str,
    endpoint: &str,
    bucket: &str,
    object_key: &str,
    access_key_id: &str,
    access_key_secret: &str,
    security_token: &str,
) -> AiResult<()> {
    let content_type = infer_mime(filename);
    let date = httpdate::fmt_http_date(std::time::SystemTime::now());
    let canonical_oss_headers = format!("x-oss-security-token:{}", security_token);
    let canonical_resource = format!("/{}/{}", bucket, object_key);
    let string_to_sign = format!(
        "PUT\n\n{}\n{}\n{}\n{}",
        content_type, date, canonical_oss_headers, canonical_resource
    );

    let signature = sign_oss_request(access_key_secret, &string_to_sign)?;
    let authorization = format!("OSS {}:{}", access_key_id, signature);

    let object_path = object_key
        .split('/')
        .map(urlencoding::encode)
        .collect::<Vec<_>>()
        .join("/");

    let upload_url = format!(
        "{}/{}",
        normalize_oss_upload_base(endpoint, bucket)?,
        object_path
    );

    let response = reqwest::Client::new()
        .put(&upload_url)
        .header("Authorization", authorization)
        .header("Date", date)
        .header("x-oss-security-token", security_token)
        .header("Content-Type", content_type)
        .body(bytes.to_vec())
        .send()
        .await?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response
            .text()
            .await
            .unwrap_or_else(|_| "read response failed".to_string());
        return Err(AiRuntimeError::new(
            "upload_failed",
            format!("OSS PUT HTTP {}: {}", status, text),
        ));
    }

    Ok(())
}

async fn commit_resource(api_key: &str, filename: &str, object_key: &str) -> AiResult<String> {
    let response = reqwest::Client::new()
        .post(BIZYAIR_COMMIT_URL)
        .header("Authorization", to_bearer_auth(api_key))
        .header("Content-Type", "application/json")
        .json(&json!({
            "name": filename,
            "object_key": object_key
        }))
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
            format!("BizyAir commit HTTP {}: {}", status, payload),
        ));
    }

    if payload.get("status").and_then(Value::as_bool) != Some(true) {
        let message = payload
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("BizyAir commit failed");
        return Err(AiRuntimeError::new("upload_failed", message));
    }

    payload
        .pointer("/data/url")
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .ok_or_else(|| {
            AiRuntimeError::new(
                "upload_failed",
                format!("BizyAir commit missing data.url: {}", payload),
            )
        })
}

fn to_bearer_auth(api_key: &str) -> String {
    if api_key.starts_with("Bearer ") {
        return api_key.to_string();
    }
    format!("Bearer {}", api_key)
}

fn read_string(source: &serde_json::Map<String, Value>, key: &'static str) -> AiResult<String> {
    source
        .get(key)
        .and_then(Value::as_str)
        .filter(|v| !v.trim().is_empty())
        .map(ToString::to_string)
        .ok_or_else(|| {
            AiRuntimeError::new("upload_failed", format!("BizyAir token missing {}", key))
        })
}

fn normalize_oss_upload_base(endpoint: &str, bucket: &str) -> AiResult<String> {
    if endpoint.trim().is_empty() {
        return Err(AiRuntimeError::new(
            "upload_failed",
            "BizyAir storage endpoint is empty",
        ));
    }

    let raw = endpoint.trim().trim_end_matches('/');

    if raw.starts_with("http://") || raw.starts_with("https://") {
        let stripped = raw
            .trim_start_matches("http://")
            .trim_start_matches("https://");
        return Ok(format!("https://{}.{}", bucket, stripped));
    }

    Ok(format!("https://{}.{}", bucket, raw))
}

fn sign_oss_request(secret: &str, data: &str) -> AiResult<String> {
    let mut mac = HmacSha1::new_from_slice(secret.as_bytes())
        .map_err(|e| AiRuntimeError::new("upload_failed", e.to_string()))?;
    mac.update(data.as_bytes());
    let signature = mac.finalize().into_bytes();
    Ok(base64::engine::general_purpose::STANDARD.encode(signature))
}

fn infer_mime(filename: &str) -> &'static str {
    let lower = filename.to_lowercase();
    if lower.ends_with(".png") {
        return "image/png";
    }
    if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        return "image/jpeg";
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
    if lower.ends_with(".mov") {
        return "video/quicktime";
    }
    "application/octet-stream"
}
