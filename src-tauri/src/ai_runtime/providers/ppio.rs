use crate::ai_runtime::errors::{AiResult, AiRuntimeError};
use crate::ai_runtime::polling::{cancelled_error, wait_interval_ms};
use crate::ai_runtime::providers::{ProviderContinuePollingInput, ProviderExecutionInput};
use crate::ai_runtime::task_registry;
use crate::ai_runtime::types::{GenerateStatus, ProviderExecutionResult};
use serde_json::Value;

const PPIO_BASE_URL: &str = "https://api.ppinfra.com/v3";

pub async fn execute(input: ProviderExecutionInput<'_>) -> AiResult<ProviderExecutionResult> {
    let endpoint = normalize_endpoint(PPIO_BASE_URL, input.route);
    tracing::info!(
        target: "ai_runtime.ppio",
        route = %input.route,
        body = %payload_preview(input.body),
        "submit request"
    );
    let response = send_json(&input, &endpoint).await?;

    if let Some(task_id) = extract_task_id(&response) {
        tracing::info!(
            target: "ai_runtime.ppio",
            route = %input.route,
            task_id = %task_id,
            payload = %payload_preview(&response),
            "submit success"
        );
        return Ok(ProviderExecutionResult {
            status: GenerateStatus::Pending,
            url: String::new(),
            task_id: Some(task_id),
            metadata: response,
        });
    }

    tracing::info!(
        target: "ai_runtime.ppio",
        route = %input.route,
        payload = %payload_preview(&response),
        "submit sync result"
    );

    let urls = extract_urls(&response);
    if urls.is_empty() {
        let task_id = extract_task_id(&response).unwrap_or_else(|| "unknown".to_string());
        let preview = payload_preview(&response);
        tracing::error!(
            target: "ai_runtime.ppio",
            task_id = %task_id,
            payload = %preview,
            "empty result after submit"
        );
        return Err(AiRuntimeError::new(
            "empty_result",
            format!(
                "PPIO response has no media URL (task_id={}). payload={}",
                task_id, preview
            ),
        ));
    }

    Ok(ProviderExecutionResult {
        status: GenerateStatus::Completed,
        url: urls.join("|||"),
        task_id: extract_task_id(&response),
        metadata: response,
    })
}

pub async fn continue_polling(input: ProviderContinuePollingInput<'_>) -> AiResult<ProviderExecutionResult> {
    let null_body = Value::Null;
    let shim = ProviderExecutionInput {
        client: input.client,
        api_key: input.api_key,
        route: input.route,
        method: "GET",
        body: &null_body,
        request_id: input.request_id,
        polling: input.polling,
    };

    let final_payload = poll_task(&shim, input.task_id).await?;
    let urls = extract_urls(&final_payload);
    if urls.is_empty() {
        let task_id = extract_task_id(&final_payload).unwrap_or_else(|| input.task_id.to_string());
        let preview = payload_preview(&final_payload);
        tracing::error!(
            target: "ai_runtime.ppio",
            task_id = %task_id,
            payload = %preview,
            "empty result while continue polling"
        );
        return Err(AiRuntimeError::new(
            "empty_result",
            format!(
                "PPIO response has no media URL (task_id={}). payload={}",
                task_id, preview
            ),
        ));
    }

    Ok(ProviderExecutionResult {
        status: GenerateStatus::Completed,
        url: urls.join("|||"),
        task_id: Some(input.task_id.to_string()),
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

    loop {
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
        let status = response.status();

        let payload = response
            .json::<Value>()
            .await
            .map_err(|e| AiRuntimeError::new("invalid_json", e.to_string()))?;

        if !status.is_success() {
            tracing::error!(
                target: "ai_runtime.ppio",
                task_id = %task_id,
                status = %status,
                payload = %payload_preview(&payload),
                "poll http error"
            );
            return Err(AiRuntimeError::new(
                "provider_http_error",
                format!("PPIO poll HTTP {}: {}", status, payload),
            ));
        }

        let state = payload
            .pointer("/task/status")
            .and_then(Value::as_str)
            .unwrap_or("");

        if state == "TASK_STATUS_SUCCEED" {
            return Ok(payload);
        }

        if state == "TASK_STATUS_FAILED" {
            let reason = extract_task_failure_reason(&payload);
            let summary = summarize_task_failure(&payload);
            tracing::error!(
                target: "ai_runtime.ppio",
                task_id = %task_id,
                reason = %reason,
                payload = %payload_preview(&payload),
                "task failed"
            );
            return Err(AiRuntimeError::new(
                "provider_task_failed",
                format!("{} (task_id={}, {})", reason, task_id, summary),
            ));
        }
    }
}

fn extract_task_id(payload: &Value) -> Option<String> {
    payload
        .get("task_id")
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .or_else(|| {
            payload
                .pointer("/task/task_id")
                .and_then(Value::as_str)
                .map(ToString::to_string)
        })
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
    extract_string_array(payload.pointer("/image_urls"), &mut urls);
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

        for key in ["url", "image_url", "video_url", "audio_url"] {
            if let Some(url) = item.get(key).and_then(Value::as_str) {
                target.push(url.to_string());
                break;
            }
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

fn payload_preview(payload: &Value) -> String {
    let serialized = serde_json::to_string(payload).unwrap_or_else(|_| "<payload_serialize_failed>".to_string());
    const MAX_LEN: usize = 1800;
    if serialized.len() <= MAX_LEN {
        return serialized;
    }
    format!("{}...(truncated)", &serialized[..MAX_LEN])
}

fn truncate_value(value: &str, max_len: usize) -> String {
    let mut chars = value.chars();
    let truncated: String = chars.by_ref().take(max_len).collect();
    if chars.next().is_none() {
        return truncated;
    }
    format!("{}...(truncated)", truncated)
}

fn scalar_preview(value: Option<&Value>) -> String {
    match value {
        Some(Value::String(v)) => format!("\"{}\"", truncate_value(v, 80)),
        Some(Value::Bool(v)) => v.to_string(),
        Some(Value::Number(v)) => v.to_string(),
        Some(Value::Null) => "null".to_string(),
        Some(other) => truncate_value(&other.to_string(), 120),
        None => "<missing>".to_string(),
    }
}

fn extract_task_failure_reason(payload: &Value) -> String {
    let pointers = [
        "/task/reason",
        "/task/message",
        "/task/error",
        "/message",
        "/error",
        "/reason",
        "/task/output/message",
        "/task/output/error",
        "/task/extra/debug_info/message",
        "/task/extra/debug_info/error",
    ];

    for pointer in pointers {
        if let Some(value) = payload.pointer(pointer) {
            let preview = scalar_preview(Some(value));
            if preview != "<missing>" && preview != "null" && preview != "\"\"" {
                return preview.trim_matches('"').to_string();
            }
        }
    }

    "task failed".to_string()
}

fn summarize_task_failure(payload: &Value) -> String {
    let task_type = payload
        .pointer("/task/task_type")
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    let progress = payload
        .pointer("/task/progress_percent")
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let image_count = payload
        .get("images")
        .and_then(Value::as_array)
        .map(|v| v.len())
        .unwrap_or(0);
    let video_count = payload
        .get("videos")
        .and_then(Value::as_array)
        .map(|v| v.len())
        .unwrap_or(0);
    let audio_count = payload
        .get("audios")
        .and_then(Value::as_array)
        .map(|v| v.len())
        .unwrap_or(0);

    format!(
        "task_type={}, progress={}%, result(images={}, videos={}, audios={})",
        task_type, progress, image_count, video_count, audio_count
    )
}
