use crate::ai_runtime::errors::{AiResult, AiRuntimeError};
use crate::ai_runtime::polling::{cancelled_error, timeout_error, wait_interval_ms};
use crate::ai_runtime::providers::ProviderExecutionInput;
use crate::ai_runtime::task_registry;
use crate::ai_runtime::types::{GenerateStatus, ProviderExecutionResult};
use serde_json::Value;

const KIE_BASE_URL: &str = "https://api.kie.ai";
const KIE_STATUS_ENDPOINT: &str = "/api/v1/jobs/recordInfo";

pub async fn execute(input: ProviderExecutionInput<'_>) -> AiResult<ProviderExecutionResult> {
    let endpoint = normalize_endpoint(KIE_BASE_URL, input.route);
    let response = send_create_task(&input, &endpoint).await?;

    let final_payload = if let Some(task_id) = extract_task_id(&response) {
        poll_task(&input, &task_id).await?
    } else {
        response
    };

    let urls = extract_urls(&final_payload);
    if urls.is_empty() {
        return Err(AiRuntimeError::new(
            "empty_result",
            "KIE response has no media URL",
        ));
    }

    Ok(ProviderExecutionResult {
        status: GenerateStatus::Completed,
        url: urls.join("|||"),
        metadata: final_payload,
    })
}

async fn send_create_task(input: &ProviderExecutionInput<'_>, endpoint: &str) -> AiResult<Value> {
    let response = input
        .client
        .post(endpoint)
        .bearer_auth(input.api_key)
        .header("Content-Type", "application/json")
        .json(input.body)
        .send()
        .await?;

    let status = response.status();
    let payload = response
        .json::<Value>()
        .await
        .map_err(|e| AiRuntimeError::new("invalid_json", e.to_string()))?;

    if !status.is_success() {
        return Err(AiRuntimeError::new(
            "provider_http_error",
            format!("KIE HTTP {}: {}", status, payload),
        ));
    }

    let code = payload.get("code").and_then(Value::as_i64).unwrap_or(200);
    if code != 200 {
        let message = payload
            .get("msg")
            .and_then(Value::as_str)
            .unwrap_or("KIE create task failed");
        return Err(AiRuntimeError::new("provider_task_failed", message));
    }

    Ok(payload)
}

async fn poll_task(input: &ProviderExecutionInput<'_>, task_id: &str) -> AiResult<Value> {
    let interval = input.polling.map(|p| p.interval).unwrap_or(3000);
    let max_attempts = input.polling.map(|p| p.max_attempts).unwrap_or(200);

    for _ in 0..max_attempts {
        if task_registry::is_cancelled(input.request_id) {
            return Err(cancelled_error(input.request_id));
        }

        wait_interval_ms(interval).await;

        let endpoint = format!("{}{}?taskId={}", KIE_BASE_URL, KIE_STATUS_ENDPOINT, task_id);
        let response = input
            .client
            .get(&endpoint)
            .bearer_auth(input.api_key)
            .send()
            .await?;

        let payload = response
            .json::<Value>()
            .await
            .map_err(|e| AiRuntimeError::new("invalid_json", e.to_string()))?;

        let code = payload.get("code").and_then(Value::as_i64).unwrap_or(200);
        if code != 200 {
            continue;
        }

        let state = payload
            .pointer("/data/state")
            .and_then(Value::as_str)
            .unwrap_or("");

        if state == "success" {
            return Ok(payload);
        }

        if state == "fail" {
            let fail_msg = payload
                .pointer("/data/failMsg")
                .and_then(Value::as_str)
                .unwrap_or("KIE task failed");
            return Err(AiRuntimeError::new("provider_task_failed", fail_msg));
        }
    }

    Err(timeout_error(max_attempts))
}

fn extract_task_id(payload: &Value) -> Option<String> {
    payload
        .pointer("/data/taskId")
        .and_then(Value::as_str)
        .map(ToString::to_string)
}

fn extract_urls(payload: &Value) -> Vec<String> {
    if let Some(result_json) = payload
        .pointer("/data/resultJson")
        .and_then(Value::as_str)
    {
        if let Ok(parsed) = serde_json::from_str::<Value>(result_json) {
            let mut urls = vec![];
            extract_from_array(parsed.get("resultUrls"), &mut urls);
            extract_from_array(parsed.get("images"), &mut urls);
            extract_from_array(parsed.get("videos"), &mut urls);
            if !urls.is_empty() {
                return urls;
            }
        }
    }

    let mut urls = vec![];
    extract_from_array(payload.get("resultUrls"), &mut urls);
    extract_from_array(payload.get("images"), &mut urls);
    extract_from_array(payload.get("videos"), &mut urls);
    urls
}

fn extract_from_array(value: Option<&Value>, target: &mut Vec<String>) {
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
