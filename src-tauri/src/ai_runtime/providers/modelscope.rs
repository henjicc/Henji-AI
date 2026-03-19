use crate::ai_runtime::errors::{AiResult, AiRuntimeError};
use crate::ai_runtime::polling::{cancelled_error, wait_interval_ms};
use crate::ai_runtime::providers::{ProviderContinuePollingInput, ProviderExecutionInput};
use crate::ai_runtime::task_registry;
use crate::ai_runtime::types::{GenerateStatus, ProviderExecutionResult};
use serde_json::Value;

const MODELSCOPE_BASE_URL: &str = "https://api-inference.modelscope.cn";

pub async fn execute(input: ProviderExecutionInput<'_>) -> AiResult<ProviderExecutionResult> {
    let endpoint = normalize_endpoint(MODELSCOPE_BASE_URL, input.route);
    let response = submit_task(&input, &endpoint).await?;

    let task_id = response
        .get("task_id")
        .and_then(Value::as_str)
        .ok_or_else(|| AiRuntimeError::new("invalid_response", "ModelScope response missing task_id"))?
        .to_string();

    Ok(ProviderExecutionResult {
        status: GenerateStatus::Pending,
        url: String::new(),
        task_id: Some(task_id),
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
        return Err(AiRuntimeError::new(
            "empty_result",
            format!("ModelScope response has no output_images (task_id={})", input.task_id),
        ));
    }

    Ok(ProviderExecutionResult {
        status: GenerateStatus::Completed,
        url: urls.join("|||"),
        task_id: Some(input.task_id.to_string()),
        metadata: final_payload,
    })
}

async fn submit_task(input: &ProviderExecutionInput<'_>, endpoint: &str) -> AiResult<Value> {
    let response = input
        .client
        .post(endpoint)
        .bearer_auth(input.api_key)
        .header("Content-Type", "application/json")
        .header("X-ModelScope-Async-Mode", "true")
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
            format!("ModelScope HTTP {}: {}", status, payload),
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

        let endpoint = format!("{}/v1/tasks/{}", MODELSCOPE_BASE_URL, task_id);
        let response = input
            .client
            .get(&endpoint)
            .bearer_auth(input.api_key)
            .header("Content-Type", "application/json")
            .header("X-ModelScope-Task-Type", "image_generation")
            .send()
            .await?;

        let payload = response
            .json::<Value>()
            .await
            .map_err(|e| AiRuntimeError::new("invalid_json", e.to_string()))?;

        let state = payload
            .get("task_status")
            .and_then(Value::as_str)
            .unwrap_or("");

        if state == "SUCCEED" {
            return Ok(payload);
        }

        if state == "FAILED" {
            return Err(AiRuntimeError::new("provider_task_failed", "ModelScope task failed"));
        }
    }
}

fn extract_urls(payload: &Value) -> Vec<String> {
    let mut urls = Vec::new();
    let Some(Value::Array(items)) = payload.get("output_images") else {
        return urls;
    };

    for item in items {
        if let Some(url) = item.as_str() {
            urls.push(url.to_string());
        }
    }

    urls
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
