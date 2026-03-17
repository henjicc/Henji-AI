use crate::ai_runtime::errors::AiRuntimeError;
use crate::ai_runtime::key_store;
use crate::ai_runtime::media_store;
use crate::ai_runtime::model_manifest::{get_manifest_store, reload_manifest_store};
use crate::ai_runtime::providers::{self, ProviderContinuePollingInput, ProviderExecutionInput};
use crate::ai_runtime::request_builder_dsl;
use crate::ai_runtime::task_registry;
use crate::ai_runtime::trace;
use crate::ai_runtime::types::{
    AiContinuePollingRequestDto, AiGenerateRequestDto, AiGenerateResponseDto, ProviderKeyStatusDto,
};
use crate::ai_runtime::upload;

#[tauri::command]
pub async fn ai_set_provider_api_key(provider_id: String, api_key: String) -> Result<(), String> {
    key_store::set_provider_api_key(provider_id.trim(), api_key.trim()).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ai_remove_provider_api_key(provider_id: String) -> Result<(), String> {
    key_store::remove_provider_api_key(provider_id.trim()).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ai_get_provider_api_key(provider_id: String) -> Result<Option<String>, String> {
    key_store::get_provider_api_key(provider_id.trim()).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ai_get_provider_key_status() -> Result<Vec<ProviderKeyStatusDto>, String> {
    let mut provider_ids = key_store::KNOWN_PROVIDER_IDS
        .iter()
        .map(|id| id.to_string())
        .collect::<Vec<String>>();

    if let Ok(manifest) = get_manifest_store().read() {
        for provider_id in manifest.provider_ids() {
            if !provider_ids.contains(&provider_id) {
                provider_ids.push(provider_id);
            }
        }
    }

    key_store::get_provider_key_status(&provider_ids).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ai_reload_model_manifest() -> Result<usize, String> {
    Ok(reload_manifest_store())
}

#[tauri::command]
pub async fn ai_generate(
    app: tauri::AppHandle,
    request: AiGenerateRequestDto,
) -> Result<AiGenerateResponseDto, String> {
    let request_id = resolve_request_id(&request);
    task_registry::clear_cancel_flag(&request_id);

    let client = reqwest::Client::new();

    let maybe_model = get_manifest_store()
        .read()
        .ok()
        .and_then(|guard| guard.get(&request.model_id).cloned());

    let provider_id = resolve_provider_id(&request, maybe_model.as_ref())?;

    let api_key = key_store::get_provider_api_key(&provider_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| {
            format!(
                "[api_key_missing] API key not configured for provider: {}",
                provider_id
            )
        })?;

    let built_request = request_builder_dsl::build_request(&request.params, maybe_model.as_ref())
        .map_err(|e| e.to_string())?;

    if built_request.route.trim().is_empty() {
        return Err("[invalid_route] Request route is empty".to_string());
    }

    let upload_strategy = upload::resolve_upload_strategy(&request.params);
    let preprocessed_body =
        upload::preprocess_request_body(
            &provider_id,
            &built_request.route,
            &built_request.body,
            &upload_strategy,
        )
            .await
            .map_err(|e| e.to_string())?;

    let execution_input = ProviderExecutionInput {
        client: &client,
        api_key: &api_key,
        route: &built_request.route,
        method: &built_request.method,
        body: &preprocessed_body,
        request_id: &request_id,
        polling: maybe_model
            .as_ref()
            .and_then(|model| model.polling.as_ref()),
    };

    let provider_result = providers::execute_generate(&provider_id, execution_input)
        .await
        .map_err(|e| e.to_string())?;
    let trace_payload = trace::build_generate_trace(
        &request.model_id,
        &provider_id,
        &request_id,
        &built_request.route,
        &built_request.method,
        &preprocessed_body,
        &provider_result.metadata,
    );
    trace::log_trace(&trace_payload);

    let file_path = save_media_paths(&app, &provider_result.url).await?;

    task_registry::clear_cancel_flag(&request_id);

    Ok(AiGenerateResponseDto {
        status: provider_result.status,
        url: provider_result.url,
        file_path,
        metadata: Some(provider_result.metadata),
        trace: Some(trace_payload),
    })
}

#[tauri::command]
pub async fn ai_continue_polling(
    app: tauri::AppHandle,
    request: AiContinuePollingRequestDto,
) -> Result<AiGenerateResponseDto, String> {
    let request_id = format!(
        "continue-{}-{}",
        request.model_id,
        chrono_like_timestamp_ms()
    );
    task_registry::clear_cancel_flag(&request_id);

    let client = reqwest::Client::new();

    let maybe_model = get_manifest_store()
        .read()
        .ok()
        .and_then(|guard| guard.get(&request.model_id).cloned());

    let provider_id = resolve_provider_id_from_model(&request.model_id, maybe_model.as_ref())?;

    let api_key = key_store::get_provider_api_key(&provider_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| {
            format!(
                "[api_key_missing] API key not configured for provider: {}",
                provider_id
            )
        })?;

    let built_request = request_builder_dsl::build_request(&request.params, maybe_model.as_ref())
        .map_err(|e| e.to_string())?;

    let execution_input = ProviderContinuePollingInput {
        client: &client,
        api_key: &api_key,
        route: &built_request.route,
        task_id: request.task_id.trim(),
        request_id: &request_id,
        polling: maybe_model
            .as_ref()
            .and_then(|model| model.polling.as_ref()),
    };

    let provider_result = providers::execute_continue_polling(&provider_id, execution_input)
        .await
        .map_err(|e| e.to_string())?;
    let trace_payload = trace::build_continue_polling_trace(
        &request.model_id,
        &provider_id,
        &request_id,
        &built_request.route,
        request.task_id.trim(),
        &provider_result.metadata,
    );
    trace::log_trace(&trace_payload);

    let file_path = save_media_paths(&app, &provider_result.url).await?;

    task_registry::clear_cancel_flag(&request_id);

    Ok(AiGenerateResponseDto {
        status: provider_result.status,
        url: provider_result.url,
        file_path,
        metadata: Some(provider_result.metadata),
        trace: Some(trace_payload),
    })
}

#[tauri::command]
pub async fn ai_cancel_task(task_id: String) -> Result<(), String> {
    task_registry::cancel_task(task_id.trim());
    Ok(())
}

fn resolve_request_id(request: &AiGenerateRequestDto) -> String {
    request
        .request_id
        .clone()
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| format!("{}-{}", request.model_id, chrono_like_timestamp_ms()))
}

fn chrono_like_timestamp_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn resolve_provider_id(
    request: &AiGenerateRequestDto,
    model: Option<&crate::ai_runtime::types::ModelManifestItem>,
) -> Result<String, String> {
    if let Some(model_item) = model {
        return Ok(model_item.provider_id.clone());
    }

    Err(AiRuntimeError::new(
        "provider_not_found",
        format!("Unable to resolve provider for model: {}", request.model_id),
    )
    .to_string())
}

fn resolve_provider_id_from_model(
    model_id: &str,
    model: Option<&crate::ai_runtime::types::ModelManifestItem>,
) -> Result<String, String> {
    if let Some(model_item) = model {
        return Ok(model_item.provider_id.clone());
    }

    Err(AiRuntimeError::new(
        "provider_not_found",
        format!("Unable to resolve provider for model: {}", model_id),
    )
    .to_string())
}

async fn save_media_paths(
    app: &tauri::AppHandle,
    joined_urls: &str,
) -> Result<Option<String>, String> {
    let mut saved_paths: Vec<String> = Vec::new();
    for url in joined_urls
        .split("|||")
        .map(str::trim)
        .filter(|u| !u.is_empty())
    {
        if let Some(path) = media_store::save_media_from_url(app, url)
            .await
            .map_err(|e| e.to_string())?
        {
            saved_paths.push(path);
        }
    }

    if saved_paths.is_empty() {
        Ok(None)
    } else {
        Ok(Some(saved_paths.join("|||")))
    }
}
