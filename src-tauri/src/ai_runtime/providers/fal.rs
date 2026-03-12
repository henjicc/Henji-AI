use crate::ai_runtime::errors::{AiResult, AiRuntimeError};
use crate::ai_runtime::polling::{cancelled_error, timeout_error, wait_interval_ms};
use crate::ai_runtime::providers::ProviderExecutionInput;
use crate::ai_runtime::task_registry;
use crate::ai_runtime::types::{GenerateStatus, ProviderExecutionResult};
use serde_json::{json, Value};

const FAL_SYNC_BASE_URL: &str = "https://fal.run";
const FAL_QUEUE_BASE_URL: &str = "https://queue.fal.run";

pub async fn execute(input: ProviderExecutionInput<'_>) -> AiResult<ProviderExecutionResult> {
    let sync_mode = input
        .body
        .get("sync_mode")
        .and_then(Value::as_bool)
        .unwrap_or(false);

    let clean_input = strip_sync_mode(input.body.clone());

    let submit_payload = if sync_mode {
        submit_sync(&input, &clean_input).await?
    } else {
        submit_async(&input, &clean_input).await?
    };

    let final_payload = if sync_mode {
        submit_payload
    } else {
        resolve_async_payload(&input, submit_payload).await?
    };

    let urls = extract_urls(&final_payload);
    if urls.is_empty() {
        return Err(AiRuntimeError::new(
            "empty_result",
            "Fal response has no media URL",
        ));
    }

    Ok(ProviderExecutionResult {
        status: GenerateStatus::Completed,
        url: urls.join("|||"),
        metadata: final_payload,
    })
}

async fn submit_sync(input: &ProviderExecutionInput<'_>, clean_input: &Value) -> AiResult<Value> {
    let endpoint = normalize_endpoint(FAL_SYNC_BASE_URL, input.route);
    send_fal_request(input, &endpoint, clean_input).await
}

async fn submit_async(input: &ProviderExecutionInput<'_>, clean_input: &Value) -> AiResult<Value> {
    let endpoint = normalize_endpoint(FAL_QUEUE_BASE_URL, input.route);
    send_fal_request(input, &endpoint, clean_input).await
}

async fn send_fal_request(
    input: &ProviderExecutionInput<'_>,
    endpoint: &str,
    clean_input: &Value,
) -> AiResult<Value> {
    let payload = json!({ "input": clean_input });
    let response = input
        .client
        .post(endpoint)
        .header("Authorization", format!("Key {}", input.api_key))
        .header("Content-Type", "application/json")
        .json(&payload)
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
            format!("Fal HTTP {}: {}", status, payload),
        ));
    }

    Ok(payload)
}

async fn resolve_async_payload(
    input: &ProviderExecutionInput<'_>,
    submit_payload: Value,
) -> AiResult<Value> {
    let status_url = submit_payload
        .get("status_url")
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .or_else(|| {
            submit_payload
                .get("request_id")
                .and_then(Value::as_str)
                .map(|request_id| {
                    format!(
                        "{}/{}/requests/{}/status",
                        FAL_QUEUE_BASE_URL,
                        input.route.trim_start_matches('/'),
                        request_id
                    )
                })
        })
        .ok_or_else(|| AiRuntimeError::new("invalid_response", "Fal async response missing status_url"))?;

    let interval = input.polling.map(|p| p.interval).unwrap_or(3000);
    let max_attempts = input.polling.map(|p| p.max_attempts).unwrap_or(200);

    for _ in 0..max_attempts {
        if task_registry::is_cancelled(input.request_id) {
            return Err(cancelled_error(input.request_id));
        }

        wait_interval_ms(interval).await;

        let response = input
            .client
            .get(&status_url)
            .header("Authorization", format!("Key {}", input.api_key))
            .send()
            .await?;

        let payload = response
            .json::<Value>()
            .await
            .map_err(|e| AiRuntimeError::new("invalid_json", e.to_string()))?;

        let state = payload
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_uppercase();

        if state == "COMPLETED" || state == "OK" {
            if let Some(response_url) = payload.get("response_url").and_then(Value::as_str) {
                let final_response = input
                    .client
                    .get(response_url)
                    .header("Authorization", format!("Key {}", input.api_key))
                    .send()
                    .await?;

                let response_json = final_response
                    .json::<Value>()
                    .await
                    .map_err(|e| AiRuntimeError::new("invalid_json", e.to_string()))?;
                return Ok(response_json);
            }
            return Ok(payload);
        }

        if state == "FAILED" || state == "ERROR" {
            return Err(AiRuntimeError::new("provider_task_failed", "Fal task failed"));
        }
    }

    Err(timeout_error(max_attempts))
}

fn strip_sync_mode(value: Value) -> Value {
    if let Value::Object(mut map) = value {
        map.remove("sync_mode");
        return Value::Object(map);
    }
    value
}

fn extract_urls(payload: &Value) -> Vec<String> {
    let mut urls = Vec::new();
    collect_urls(payload, &mut urls);
    urls
}

fn collect_urls(value: &Value, target: &mut Vec<String>) {
    match value {
        Value::Object(map) => {
            for (key, item) in map {
                let lower = key.to_lowercase();
                if lower.contains("url") {
                    if let Some(url) = item.as_str() {
                        if url.starts_with("http://") || url.starts_with("https://") {
                            target.push(url.to_string());
                            continue;
                        }
                    }
                }
                collect_urls(item, target);
            }
        }
        Value::Array(items) => {
            for item in items {
                collect_urls(item, target);
            }
        }
        _ => {}
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
