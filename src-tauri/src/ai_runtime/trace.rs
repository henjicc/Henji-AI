use serde::Serialize;
use serde_json::{Map, Value};

const MAX_DEPTH: usize = 12;
const DATA_URI_HEAD_LEN: usize = 96;
const DATA_URI_TAIL_LEN: usize = 32;
const LONG_STRING_HEAD_LEN: usize = 1200;
const LONG_STRING_TAIL_LEN: usize = 240;
const BASE64_HEAD_LEN: usize = 160;
const BASE64_TAIL_LEN: usize = 48;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiRuntimeTrace {
    pub model_id: String,
    pub provider_id: String,
    pub request_id: String,
    pub phase: String,
    pub route: String,
    pub method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_body: Option<Value>,
    pub response_body: Value,
}

pub fn build_generate_trace(
    model_id: &str,
    provider_id: &str,
    request_id: &str,
    route: &str,
    method: &str,
    request_body: &Value,
    response_body: &Value,
) -> AiRuntimeTrace {
    AiRuntimeTrace {
        model_id: model_id.to_string(),
        provider_id: provider_id.to_string(),
        request_id: request_id.to_string(),
        phase: "generate".to_string(),
        route: route.to_string(),
        method: method.to_uppercase(),
        task_id: None,
        request_body: Some(sanitize_json_value(request_body, 0)),
        response_body: sanitize_json_value(response_body, 0),
    }
}

pub fn build_continue_polling_trace(
    model_id: &str,
    provider_id: &str,
    request_id: &str,
    route: &str,
    task_id: &str,
    response_body: &Value,
) -> AiRuntimeTrace {
    AiRuntimeTrace {
        model_id: model_id.to_string(),
        provider_id: provider_id.to_string(),
        request_id: request_id.to_string(),
        phase: "continuePolling".to_string(),
        route: route.to_string(),
        method: "GET".to_string(),
        task_id: normalize_optional_text(task_id),
        request_body: None,
        response_body: sanitize_json_value(response_body, 0),
    }
}

pub fn log_trace(trace: &AiRuntimeTrace) {
    let content = serde_json::to_string_pretty(trace)
        .unwrap_or_else(|_| "<trace_serialize_failed>".to_string());
    eprintln!("[ai_runtime][trace][{}]\n{}", trace.phase, content);
}

fn sanitize_json_value(value: &Value, depth: usize) -> Value {
    if depth >= MAX_DEPTH {
        return Value::String("[depth-limited]".to_string());
    }

    match value {
        Value::Object(map) => {
            let mut next = Map::new();
            for (key, item) in map {
                let sanitized = if is_sensitive_key(key) {
                    Value::String("***".to_string())
                } else {
                    sanitize_json_value(item, depth + 1)
                };
                next.insert(key.clone(), sanitized);
            }
            Value::Object(next)
        }
        Value::Array(items) => Value::Array(
            items
                .iter()
                .map(|item| sanitize_json_value(item, depth + 1))
                .collect(),
        ),
        Value::String(text) => Value::String(sanitize_string(text)),
        _ => value.clone(),
    }
}

fn sanitize_string(value: &str) -> String {
    if value.starts_with("data:") {
        return summarize_data_uri(value);
    }

    if looks_like_base64(value) {
        return summarize_compact_string(value, BASE64_HEAD_LEN, BASE64_TAIL_LEN, "base64");
    }

    if value.chars().count() > LONG_STRING_HEAD_LEN + LONG_STRING_TAIL_LEN {
        return summarize_compact_string(value, LONG_STRING_HEAD_LEN, LONG_STRING_TAIL_LEN, "truncated");
    }

    value.to_string()
}

fn summarize_data_uri(value: &str) -> String {
    let Some((header, payload)) = value.split_once(',') else {
        return summarize_compact_string(value, DATA_URI_HEAD_LEN, DATA_URI_TAIL_LEN, "data-uri");
    };

    format!(
        "{},{}",
        header,
        summarize_compact_string(payload, DATA_URI_HEAD_LEN, DATA_URI_TAIL_LEN, "data-uri")
    )
}

fn summarize_compact_string(value: &str, head: usize, tail: usize, label: &str) -> String {
    let length = value.chars().count();
    if length <= head + tail + 24 {
        return value.to_string();
    }

    format!(
        "{}...(len={}, {})...{}",
        take_prefix(value, head),
        length,
        label,
        take_suffix(value, tail)
    )
}

fn take_prefix(value: &str, count: usize) -> String {
    value.chars().take(count).collect()
}

fn take_suffix(value: &str, count: usize) -> String {
    let chars = value.chars().collect::<Vec<char>>();
    let start = chars.len().saturating_sub(count);
    chars[start..].iter().collect()
}

fn looks_like_base64(value: &str) -> bool {
    let trimmed = value.trim();
    if trimmed.len() < 512 {
        return false;
    }

    trimmed.chars().all(|ch| {
        ch.is_ascii_alphanumeric()
            || matches!(ch, '+' | '/' | '=' | '-' | '_' | '\r' | '\n')
    })
}

fn is_sensitive_key(key: &str) -> bool {
    let lower = key.to_lowercase();
    lower.contains("api_key")
        || lower.contains("apikey")
        || lower.contains("authorization")
        || lower.contains("token")
        || lower.contains("secret")
        || lower.contains("password")
}

fn normalize_optional_text(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}
