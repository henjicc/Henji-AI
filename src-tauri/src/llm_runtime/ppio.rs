use crate::ai_runtime::task_registry;
use crate::llm_runtime::types::{
    LlmChatMessageDto, LlmChatRequestDto, LlmMessageContentDto, LlmMessageContentPartDto,
    LlmStreamEventDto,
};
use reqwest::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE};
use serde_json::{json, Value};
use tauri::ipc::Channel;

const DEFAULT_PPIO_BASE_URL: &str = "https://api.ppio.com/openai";
const DEFAULT_PPIO_MAX_TOKENS: u32 = 4096;

pub struct PpioChatStreamResult {
    pub output: String,
    pub reasoning_output: String,
}

pub async fn stream_chat(
    request: &LlmChatRequestDto,
    api_key: &str,
    request_id: &str,
    on_event: &Channel<LlmStreamEventDto>,
) -> Result<PpioChatStreamResult, String> {
    let endpoint = resolve_chat_endpoint(request.base_url.as_deref());
    let payload = build_payload(request)?;
    let client = reqwest::Client::new();
    let response = client
        .post(endpoint)
        .header(CONTENT_TYPE, "application/json")
        .header(ACCEPT, "text/event-stream")
        .header(AUTHORIZATION, format!("Bearer {}", api_key.trim()))
        .json(&payload)
        .send()
        .await
        .map_err(|error| error.to_string())?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(format!("PPIO HTTP {}: {}", status, body));
    }

    let mut output = String::new();
    let mut reasoning_output = String::new();
    let mut pending: Vec<u8> = Vec::new();

    let mut response = response;
    while let Some(chunk) = response.chunk().await.map_err(|error| error.to_string())? {
        if task_registry::is_cancelled(request_id) {
            return Err(format!(
                "[task_cancelled] LLM task cancelled: {}",
                request_id
            ));
        }

        pending.extend_from_slice(&chunk);

        while let Some(event) = take_next_event(&mut pending) {
            if handle_sse_event(&event, on_event, &mut output, &mut reasoning_output)? {
                return Ok(PpioChatStreamResult {
                    output,
                    reasoning_output,
                });
            }
        }
    }

    if !pending.is_empty() {
        let tail = String::from_utf8(pending).map_err(|error| error.to_string())?;
        let _ = handle_sse_event(&tail, on_event, &mut output, &mut reasoning_output)?;
    }

    Ok(PpioChatStreamResult {
        output,
        reasoning_output,
    })
}

pub(crate) fn build_payload(request: &LlmChatRequestDto) -> Result<Value, String> {
    let messages = request
        .messages
        .iter()
        .map(serialize_message)
        .collect::<Result<Vec<Value>, String>>()?;

    Ok(json!({
        "model": request.model_id.trim(),
        "messages": messages,
        "max_tokens": request.policy.max_tokens.unwrap_or(DEFAULT_PPIO_MAX_TOKENS),
        "stream": true,
        "stream_options": {
            "include_usage": true
        }
    }))
}

fn serialize_message(message: &LlmChatMessageDto) -> Result<Value, String> {
    let mut data = json!({
        "role": message.role,
        "content": serialize_content(&message.content)?,
    });

    if let Some(name) = message
        .name
        .as_deref()
        .map(str::trim)
        .filter(|name| !name.is_empty())
    {
        data["name"] = Value::String(name.to_string());
    }

    Ok(data)
}

fn serialize_content(content: &LlmMessageContentDto) -> Result<Value, String> {
    match content {
        LlmMessageContentDto::Text(text) => Ok(Value::String(text.clone())),
        LlmMessageContentDto::Null => Ok(Value::Null),
        LlmMessageContentDto::Parts(parts) => {
            Ok(Value::Array(parts.iter().map(serialize_part).collect()))
        }
    }
}

fn serialize_part(part: &LlmMessageContentPartDto) -> Value {
    match part {
        LlmMessageContentPartDto::Text { text } => json!({
            "type": "text",
            "text": text,
        }),
        LlmMessageContentPartDto::ImageUrl { image_url } => json!({
            "type": "image_url",
            "image_url": {
                "url": image_url.url,
            },
        }),
        LlmMessageContentPartDto::VideoUrl { video_url } => json!({
            "type": "video_url",
            "video_url": {
                "url": video_url.url,
            },
        }),
        LlmMessageContentPartDto::InputAudio { input_audio } => json!({
            "type": "input_audio",
            "input_audio": {
                "data": input_audio.data,
                "format": input_audio.format,
            },
        }),
    }
}

pub(crate) fn resolve_chat_endpoint(base_url: Option<&str>) -> String {
    let normalized = base_url
        .and_then(|value| {
            let trimmed = value.trim().trim_end_matches('/');
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        })
        .unwrap_or_else(|| DEFAULT_PPIO_BASE_URL.to_string());

    if normalized.ends_with("/v1") {
        format!("{}/chat/completions", normalized)
    } else {
        format!("{}/v1/chat/completions", normalized)
    }
}

fn take_next_event(buffer: &mut Vec<u8>) -> Option<String> {
    let delimiter = find_delimiter(buffer)?;
    let (index, len) = delimiter;
    let event_bytes = buffer[..index].to_vec();
    buffer.drain(..index + len);
    String::from_utf8(event_bytes).ok()
}

fn find_delimiter(buffer: &[u8]) -> Option<(usize, usize)> {
    for (index, window) in buffer.windows(4).enumerate() {
        if window == b"\r\n\r\n" {
            return Some((index, 4));
        }
    }

    for (index, window) in buffer.windows(2).enumerate() {
        if window == b"\n\n" {
            return Some((index, 2));
        }
    }

    None
}

fn handle_sse_event(
    raw_event: &str,
    on_event: &Channel<LlmStreamEventDto>,
    output: &mut String,
    reasoning_output: &mut String,
) -> Result<bool, String> {
    for line in raw_event.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || !trimmed.starts_with("data:") {
            continue;
        }

        let data = trimmed.trim_start_matches("data:").trim();
        if data == "[DONE]" {
            return Ok(true);
        }

        let payload: Value = serde_json::from_str(data).map_err(|error| error.to_string())?;
        if let Some(reasoning) = extract_delta_text(&payload, &["reasoning_content", "reasoning"]) {
            reasoning_output.push_str(reasoning);
            on_event
                .send(LlmStreamEventDto::ReasoningToken(reasoning.to_string()))
                .map_err(|error| error.to_string())?;
        }
        if let Some(content) = extract_delta_text(&payload, &["content"]) {
            output.push_str(content);
            on_event
                .send(LlmStreamEventDto::Token(content.to_string()))
                .map_err(|error| error.to_string())?;
        }
    }

    Ok(false)
}

fn extract_delta_text<'a>(payload: &'a Value, keys: &[&str]) -> Option<&'a str> {
    let delta = payload.pointer("/choices/0/delta")?;
    keys.iter()
        .find_map(|key| delta.get(*key).and_then(Value::as_str))
        .filter(|value| !value.is_empty())
}
