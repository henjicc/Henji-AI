use crate::ai_runtime::errors::{AiResult, AiRuntimeError};
use crate::ai_runtime::polling::{cancelled_error, timeout_error, wait_interval_ms};
use crate::ai_runtime::providers::ProviderExecutionInput;
use crate::ai_runtime::task_registry;
use crate::ai_runtime::types::{GenerateStatus, ProviderExecutionResult};
use serde_json::Value;

const PPIO_BASE_URL: &str = "https://api.ppinfra.com/v3";

pub async fn execute(input: ProviderExecutionInput<'_>) -> AiResult<ProviderExecutionResult> {
    let endpoint = normalize_endpoint(PPIO_BASE_URL, input.route);
    let response = send_json(&input, &endpoint).await?;

    let final_payload = if let Some(task_id) = extract_task_id(&response) {
        poll_task(&input, &task_id).await?
    } else {
        response
    };

    let urls = extract_urls(&final_payload);
    if urls.is_empty() {
        return Err(AiRuntimeError::new(
            "empty_result",
            "PPIO response has no media URL",
        ));
    }

    Ok(ProviderExecutionResult {
        status: GenerateStatus::Completed,
        url: urls.join("|||"),
        metadata: final_payload,
    })
}

async fn send_json(input: &ProviderExecutionInput<'_>, endpoint: &str) -> AiResult<Value> {
    let method = input.method.to_uppercase();
    let request = match method.as_str() {
        "GET" => input.client.get(endpoint),
        _ => input.client.post(endpoint),
    }
    .bearer_auth(input.api_key)
    .header("Content-Type", "application/json");

    let request = if method == "GET" {
        request
    } else {
        request.json(input.body)
    };

    let response = request.send().await?;
    let status = response.status();
    let payload = response
        .json::<Value>()
        .await
        .map_err(|e| AiRuntimeError::new("invalid_json", e.to_string()))?;

    if !status.is_success() {
        return Err(AiRuntimeError::new(
            "provider_http_error",
            format!("PPIO HTTP {}: {}", status, payload),
        ));
    }

    Ok(payload)
}

async fn poll_task(input: &ProviderExecutionInput<'_>, task_id: &str) -> AiResult<Value> {
    let interval = input.polling.map(|p| p.interval).unwrap_or(3000);
    let max_attempts = input.polling.map(|p| p.max_attempts).unwrap_or(120);

    for _ in 0..max_attempts {
        if task_registry::is_cancelled(input.request_id) {
            return Err(cancelled_error(input.request_id));
        }

        wait_interval_ms(interval).await;

        let status_endpoint = format!(
            "{}/async/task-result?task_id={}",
            PPIO_BASE_URL, task_id
        );
        let response = input
            .client
            .get(&status_endpoint)
            .bearer_auth(input.api_key)
            .send()
            .await?;

        let payload = response
            .json::<Value>()
            .await
            .map_err(|e| AiRuntimeError::new("invalid_json", e.to_string()))?;

        let state = payload
            .pointer("/task/status")
            .and_then(Value::as_str)
            .unwrap_or("");

        if state == "TASK_STATUS_SUCCEED" {
            return Ok(payload);
        }

        if state == "TASK_STATUS_FAILED" {
            let reason = payload
                .pointer("/task/reason")
                .and_then(Value::as_str)
                .unwrap_or("task failed");
            return Err(AiRuntimeError::new("provider_task_failed", reason));
        }
    }

    Err(timeout_error(max_attempts))
}

fn extract_task_id(payload: &Value) -> Option<String> {
    payload
        .get("task_id")
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .or_else(|| {
            payload
                .pointer("/data/task_id")
                .and_then(Value::as_str)
                .map(ToString::to_string)
        })
}

fn extract_urls(payload: &Value) -> Vec<String> {
    let mut urls = Vec::new();

    extract_string_array(payload.pointer("/images"), &mut urls);
    extract_string_array(payload.pointer("/videos"), &mut urls);
    extract_string_array(payload.pointer("/audios"), &mut urls);

    if urls.is_empty() {
        for pointer in ["/url", "/image_url", "/video_url", "/audio_url", "/output"] {
            if let Some(url) = payload.pointer(pointer).and_then(Value::as_str) {
                urls.push(url.to_string());
            }
        }
    }

    urls
}

fn extract_string_array(value: Option<&Value>, target: &mut Vec<String>) {
    let Some(Value::Array(items)) = value else {
        return;
    };

    for item in items {
        if let Some(url) = item.as_str() {
            target.push(url.to_string());
            continue;
        }

        if let Some(url) = item.get("url").and_then(Value::as_str) {
            target.push(url.to_string());
        }
    }
}

fn normalize_endpoint(base: &str, route: &str) -> String {
    if route.starts_with("http://") || route.starts_with("https://") {
        return route.to_string();
    }
    if route.starts_with('/') {
        return format!("{}{}", base, route);
    }
    format!("{}/{}", base, route)
}
