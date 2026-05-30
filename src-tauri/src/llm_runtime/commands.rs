use crate::ai_runtime::{key_store, task_registry, upload};
use crate::llm_runtime::ppio;
use crate::llm_runtime::types::{
    LlmChatMessageDto, LlmChatRequestDto, LlmInputAudioValueDto, LlmMessageContentDto,
    LlmMessageContentPartDto, LlmProviderKeyStatusDto, LlmStreamEventDto, LlmTraceDto,
};
use futures::StreamExt;
use genai::chat::{
    Binary, ChatMessage, ChatOptions, ChatRequest, ChatStreamEvent, ContentPart, MessageContent,
    ReasoningEffort,
};
use genai::resolver::{AuthData, AuthResolver, Endpoint, ServiceTargetResolver};
use genai::{Client, ModelIden, ServiceTarget};
use serde_json::json;
use serde::Serialize;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Emitter;
use tauri::ipc::Channel;

const PPIO_PROVIDER_ID: &str = "ppio";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LlmRuntimeRequestPreviewEvent {
    request_id: String,
    model_id: String,
    provider_id: String,
    method: String,
    route: String,
    request_body: serde_json::Value,
}

#[tauri::command]
pub async fn llm_set_provider_api_key(provider_id: String, api_key: String) -> Result<(), String> {
    key_store::set_provider_api_key(&provider_key_id(provider_id.trim()), api_key.trim())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn llm_remove_provider_api_key(provider_id: String) -> Result<(), String> {
    key_store::remove_provider_api_key(&provider_key_id(provider_id.trim()))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn llm_get_provider_api_key(provider_id: String) -> Result<Option<String>, String> {
    resolve_provider_api_key(provider_id.trim())
}

#[tauri::command]
pub async fn llm_get_provider_key_status(
    provider_ids: Vec<String>,
) -> Result<Vec<LlmProviderKeyStatusDto>, String> {
    provider_ids
        .into_iter()
        .map(|provider_id| {
            let configured = has_configured_provider_api_key(provider_id.trim())?;
            Ok(LlmProviderKeyStatusDto {
                provider_id,
                configured,
            })
        })
        .collect()
}

#[tauri::command]
pub async fn llm_chat_stream(
    app: tauri::AppHandle,
    request: LlmChatRequestDto,
    on_event: Channel<LlmStreamEventDto>,
) -> Result<(), String> {
    let started_at_ms = now_ms();
    let request_id = resolve_request_id(&request);
    task_registry::clear_cancel_flag(&request_id);

    let provider_id = request.provider_id.trim().to_string();
    let key = resolve_provider_api_key(&provider_id)?.ok_or_else(|| {
        format!(
            "[api_key_missing] LLM API key not configured: {}",
            provider_id
        )
    })?;
    let input_chars = request.messages.iter().map(count_message_chars).sum();

    let request = preprocess_llm_request(request).await?;
    if is_ppio_request(&request) {
        let preview_body = ppio::build_payload(&request)?;
        let preview_event = LlmRuntimeRequestPreviewEvent {
            request_id: request_id.clone(),
            model_id: request.model_id.clone(),
            provider_id: request.provider_id.clone(),
            method: "POST".to_string(),
            route: ppio::resolve_chat_endpoint(request.base_url.as_deref()),
            request_body: preview_body,
        };
        let _ = app.emit("henji://llm-runtime-request-preview", &preview_event);
    }

    let stream_result = if is_ppio_request(&request) {
        ppio::stream_chat(&request, &key, &request_id, &on_event)
            .await
            .map(|result| (result.output, result.reasoning_output))
    } else {
        stream_genai_chat(&request, &key, &request_id, &on_event).await
    };

    let (output, reasoning_output) = match stream_result {
        Ok(result) => result,
        Err(message) => {
            let _ = on_event.send(LlmStreamEventDto::Error(message.clone()));
            task_registry::clear_cancel_flag(&request_id);
            return Err(message);
        }
    };

    let trace = LlmTraceDto {
        provider_id,
        model_id: request.model_id.clone(),
        started_at_ms,
        elapsed_ms: now_ms().saturating_sub(started_at_ms),
        input_chars,
        output_chars: output.chars().count() + reasoning_output.chars().count(),
    };
    task_registry::clear_cancel_flag(&request_id);
    on_event
        .send(LlmStreamEventDto::Done(trace))
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn llm_cancel_task(task_id: String) -> Result<(), String> {
    tracing::info!(
        target: "llm_runtime.cancel",
        event = "llm_runtime.cancel.requested",
        task_id = %task_id,
        "llm_cancel_task requested"
    );
    task_registry::cancel_task(task_id.trim());
    tracing::info!(
        target: "llm_runtime.cancel",
        event = "llm_runtime.cancel.completed",
        task_id = %task_id,
        "llm_cancel_task completed"
    );
    Ok(())
}

async fn stream_genai_chat(
    request: &LlmChatRequestDto,
    api_key: &str,
    request_id: &str,
    on_event: &Channel<LlmStreamEventDto>,
) -> Result<(String, String), String> {
    let messages = request
        .messages
        .iter()
        .map(to_chat_message)
        .collect::<Result<Vec<ChatMessage>, String>>()?;
    let model_id = resolve_genai_model_id(request);
    let api_key_owned = api_key.to_string();
    let auth_resolver = AuthResolver::from_resolver_fn(move |_iden: ModelIden| {
        Ok(Some(AuthData::from_single(api_key_owned.clone())))
    });
    let mut builder = Client::builder().with_auth_resolver(auth_resolver);
    if let Some(endpoint) = normalize_base_url(request.base_url.as_deref()) {
        let target_resolver = ServiceTargetResolver::from_resolver_fn(
            move |mut service_target: ServiceTarget| -> Result<ServiceTarget, genai::resolver::Error> {
                service_target.endpoint = Endpoint::from_owned(endpoint.clone());
                Ok(service_target)
            },
        );
        builder = builder.with_service_target_resolver(target_resolver);
    }
    let client = builder.build();
    let chat_request = ChatRequest::new(messages);
    let chat_options = build_chat_options(request);
    let stream_result = client
        .exec_chat_stream(&model_id, chat_request, Some(&chat_options))
        .await
        .map_err(|e| e.to_string())?;
    let mut stream = stream_result.stream;
    let mut output = String::new();
    let mut reasoning_output = String::new();

    while let Some(event) = stream.next().await {
        if task_registry::is_cancelled(request_id) {
            task_registry::clear_cancel_flag(request_id);
            return Err(format!(
                "[task_cancelled] LLM task cancelled: {}",
                request_id
            ));
        }
        match event {
            Ok(ChatStreamEvent::Chunk(chunk)) => {
                output.push_str(&chunk.content);
                on_event
                    .send(LlmStreamEventDto::Token(chunk.content))
                    .map_err(|error| error.to_string())?;
            }
            Ok(ChatStreamEvent::ReasoningChunk(chunk)) => {
                reasoning_output.push_str(&chunk.content);
                on_event
                    .send(LlmStreamEventDto::ReasoningToken(chunk.content))
                    .map_err(|error| error.to_string())?;
            }
            Ok(ChatStreamEvent::End(_)) => break,
            Ok(_) => {}
            Err(error) => return Err(error.to_string()),
        }
    }

    Ok((output, reasoning_output))
}

fn resolve_provider_api_key(provider_id: &str) -> Result<Option<String>, String> {
    let provider_id = provider_id.trim();
    let scoped = key_store::get_provider_api_key(&provider_key_id(provider_id))
        .map_err(|e| e.to_string())?;
    if scoped.is_some() {
        return Ok(scoped);
    }

    if provider_id.eq_ignore_ascii_case(PPIO_PROVIDER_ID) {
        return key_store::get_provider_api_key(PPIO_PROVIDER_ID).map_err(|e| e.to_string());
    }

    Ok(None)
}

fn has_configured_provider_api_key(provider_id: &str) -> Result<bool, String> {
    Ok(resolve_provider_api_key(provider_id)?.is_some())
}

fn provider_key_id(provider_id: &str) -> String {
    format!("llm:{}", provider_id.trim())
}

fn resolve_request_id(request: &LlmChatRequestDto) -> String {
    request
        .request_id
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| format!("llm-{}-{}", request.model_id, now_ms()))
}

fn resolve_genai_model_id(request: &LlmChatRequestDto) -> String {
    let model_id = request.model_id.trim();
    if model_id.contains("::") {
        return model_id.to_string();
    }

    let adapter = request
        .adapter
        .as_deref()
        .unwrap_or(request.provider_id.as_str())
        .trim()
        .to_lowercase();
    if adapter.is_empty() {
        model_id.to_string()
    } else {
        format!("{adapter}::{model_id}")
    }
}

fn normalize_base_url(base_url: Option<&str>) -> Option<String> {
    let trimmed = base_url?.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return None;
    }
    if trimmed.ends_with("/v1") {
        Some(format!("{}/", trimmed))
    } else {
        Some(format!("{}/v1/", trimmed))
    }
}

fn build_chat_options(request: &LlmChatRequestDto) -> ChatOptions {
    let mut options = ChatOptions::default().with_capture_content(true);
    if request.reasoning.enabled {
        options = options
            .with_capture_reasoning_content(true)
            .with_reasoning_effort(to_reasoning_effort(&request.reasoning.effort));
    }

    if is_deepseek_request(request) {
        let thinking_type = if request.reasoning.enabled {
            "enabled"
        } else {
            "disabled"
        };
        options = options.with_extra_body(json!({
            "thinking": {
                "type": thinking_type,
            },
        }));
    }

    options
}

fn to_reasoning_effort(value: &str) -> ReasoningEffort {
    match value.trim().to_lowercase().as_str() {
        "low" => ReasoningEffort::Low,
        "medium" => ReasoningEffort::Medium,
        "xhigh" => ReasoningEffort::XHigh,
        "max" => ReasoningEffort::Max,
        _ => ReasoningEffort::High,
    }
}

fn is_deepseek_request(request: &LlmChatRequestDto) -> bool {
    let adapter = request
        .adapter
        .as_deref()
        .unwrap_or(request.provider_id.as_str())
        .trim()
        .to_lowercase();
    request.provider_id.trim().eq_ignore_ascii_case("deepseek") || adapter == "deepseek"
}

fn is_ppio_request(request: &LlmChatRequestDto) -> bool {
    request
        .provider_id
        .trim()
        .eq_ignore_ascii_case(PPIO_PROVIDER_ID)
}

async fn preprocess_llm_request(request: LlmChatRequestDto) -> Result<LlmChatRequestDto, String> {
    let LlmChatRequestDto {
        request_id,
        provider_id,
        model_id,
        adapter,
        base_url,
        reasoning,
        messages,
        capabilities,
        tools,
        policy,
        memory,
        metadata,
    } = request;

    let metadata_map: serde_json::Map<String, serde_json::Value> = metadata
        .iter()
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect();
    let strategy = upload::resolve_upload_strategy(&metadata_map);
    let body = serde_json::json!({
        "messages": messages,
    });
    let processed = upload::preprocess_request_body(
        provider_id.trim(),
        "/v1/chat/completions",
        &body,
        &strategy,
    )
    .await
    .map_err(|error| error.to_string())?;
    let messages_value = processed
        .get("messages")
        .cloned()
        .ok_or_else(|| "LLM preprocess missing messages".to_string())?;
    let messages = serde_json::from_value(messages_value).map_err(|error| error.to_string())?;

    Ok(LlmChatRequestDto {
        request_id,
        provider_id,
        model_id,
        adapter,
        base_url,
        reasoning,
        messages,
        capabilities,
        tools,
        policy,
        memory,
        metadata,
    })
}

fn to_chat_message(message: &LlmChatMessageDto) -> Result<ChatMessage, String> {
    let content = to_message_content(&message.content)?;
    let chat_message = match message.role.as_str() {
        "system" => ChatMessage::system(content),
        "assistant" => ChatMessage::assistant(content),
        _ => ChatMessage::user(content),
    };
    Ok(chat_message)
}

fn to_message_content(content: &LlmMessageContentDto) -> Result<MessageContent, String> {
    match content {
        LlmMessageContentDto::Text(text) => Ok(MessageContent::from_text(text.clone())),
        LlmMessageContentDto::Null => Ok(MessageContent::default()),
        LlmMessageContentDto::Parts(parts) => parts
            .iter()
            .map(to_content_part)
            .collect::<Result<Vec<ContentPart>, String>>()
            .map(MessageContent::from_parts),
    }
}

fn to_content_part(part: &LlmMessageContentPartDto) -> Result<ContentPart, String> {
    match part {
        LlmMessageContentPartDto::Text { text } => Ok(ContentPart::Text(text.clone())),
        LlmMessageContentPartDto::ImageUrl { image_url } => {
            let mime = resolve_content_type_from_url(&image_url.url, "image/jpeg");
            Ok(ContentPart::from(Binary::from_url(
                mime,
                image_url.url.clone(),
                None,
            )))
        }
        LlmMessageContentPartDto::InputAudio { input_audio } => {
            Ok(ContentPart::from(build_audio_binary(input_audio)))
        }
        LlmMessageContentPartDto::VideoUrl { .. } => {
            Err("当前通用 LLM 适配暂不支持 video_url，请改用派欧云内置 Provider。".to_string())
        }
    }
}

fn build_audio_binary(input_audio: &LlmInputAudioValueDto) -> Binary {
    if let Some((mime, data)) = parse_data_url(&input_audio.data) {
        return Binary::from_base64(mime, data, None);
    }

    if looks_like_remote_url(&input_audio.data) {
        let mime = resolve_audio_mime(&input_audio.format);
        return Binary::from_url(mime, input_audio.data.clone(), None);
    }

    Binary::from_base64(
        resolve_audio_mime(&input_audio.format),
        input_audio.data.clone(),
        None,
    )
}

fn parse_data_url(value: &str) -> Option<(String, String)> {
    if !value.starts_with("data:") {
        return None;
    }

    let (header, data) = value.split_once(',')?;
    let mime = header
        .strip_prefix("data:")?
        .split(';')
        .next()
        .filter(|item| !item.trim().is_empty())?
        .to_string();
    Some((mime, data.to_string()))
}

fn looks_like_remote_url(value: &str) -> bool {
    value.starts_with("http://") || value.starts_with("https://")
}

fn resolve_content_type_from_url(value: &str, fallback: &str) -> String {
    if let Some((mime, _)) = parse_data_url(value) {
        return mime;
    }

    let normalized = value.to_ascii_lowercase();
    for (suffix, mime) in [
        (".png", "image/png"),
        (".jpg", "image/jpeg"),
        (".jpeg", "image/jpeg"),
        (".webp", "image/webp"),
        (".gif", "image/gif"),
        (".bmp", "image/bmp"),
        (".svg", "image/svg+xml"),
        (".mp3", "audio/mpeg"),
        (".wav", "audio/wav"),
        (".m4a", "audio/mp4"),
        (".ogg", "audio/ogg"),
        (".flac", "audio/flac"),
    ] {
        if normalized.contains(suffix) {
            return mime.to_string();
        }
    }

    fallback.to_string()
}

fn resolve_audio_mime(format: &str) -> String {
    match format.trim().to_ascii_lowercase().as_str() {
        "wav" => "audio/wav".to_string(),
        "ogg" => "audio/ogg".to_string(),
        "flac" => "audio/flac".to_string(),
        "m4a" | "mp4" => "audio/mp4".to_string(),
        _ => "audio/mpeg".to_string(),
    }
}

fn count_message_chars(message: &LlmChatMessageDto) -> usize {
    count_content_chars(&message.content)
}

fn count_content_chars(content: &LlmMessageContentDto) -> usize {
    match content {
        LlmMessageContentDto::Text(text) => text.chars().count(),
        LlmMessageContentDto::Null => 0,
        LlmMessageContentDto::Parts(parts) => parts
            .iter()
            .map(|part| match part {
                LlmMessageContentPartDto::Text { text } => text.chars().count(),
                LlmMessageContentPartDto::ImageUrl { image_url } => image_url.url.chars().count(),
                LlmMessageContentPartDto::VideoUrl { video_url } => video_url.url.chars().count(),
                LlmMessageContentPartDto::InputAudio { input_audio } => {
                    input_audio.data.chars().count() + input_audio.format.chars().count()
                }
            })
            .sum(),
    }
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}
