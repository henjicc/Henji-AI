use crate::ai_runtime::errors::{AiResult, AiRuntimeError};
use crate::ai_runtime::types::ProviderKeyStatusDto;
use keyring::Entry;

const KEYCHAIN_SERVICE: &str = "com.henji.ai.provider_keys";
pub const KNOWN_PROVIDER_IDS: [&str; 5] = ["ppio", "fal", "kie", "modelscope", "bizyair"];

fn key_entry(provider_id: &str) -> AiResult<Entry> {
    Entry::new(KEYCHAIN_SERVICE, provider_id)
        .map_err(|e| AiRuntimeError::new("key_store_entry_failed", e.to_string()))
}

pub fn set_provider_api_key(provider_id: &str, api_key: &str) -> AiResult<()> {
    let key = api_key.trim();
    if key.is_empty() {
        return Err(AiRuntimeError::new("invalid_api_key", "API key cannot be empty"));
    }

    key_entry(provider_id)
        ?
        .set_password(key)
        .map_err(|e| AiRuntimeError::new("key_store_write_failed", e.to_string()))
}

pub fn remove_provider_api_key(provider_id: &str) -> AiResult<()> {
    let result = key_entry(provider_id)?
        .delete_password()
        .map_err(|e| e);

    match result {
        Ok(()) => Ok(()),
        // NoEntry is idempotent for delete.
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(err) => Err(AiRuntimeError::new("key_store_delete_failed", err.to_string())),
    }
}

pub fn get_provider_api_key(provider_id: &str) -> AiResult<Option<String>> {
    match key_entry(provider_id)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(err) => Err(AiRuntimeError::new("key_store_read_failed", err.to_string())),
    }
}

pub fn has_provider_api_key(provider_id: &str) -> AiResult<bool> {
    Ok(get_provider_api_key(provider_id)?.is_some())
}

pub fn get_provider_key_status(provider_ids: &[String]) -> AiResult<Vec<ProviderKeyStatusDto>> {
    provider_ids
        .iter()
        .map(|provider_id| {
            let configured = has_provider_api_key(provider_id)?;
            Ok(ProviderKeyStatusDto {
                provider_id: provider_id.clone(),
                configured,
            })
        })
        .collect()
}

pub fn default_provider_key_status() -> AiResult<Vec<ProviderKeyStatusDto>> {
    let provider_ids = KNOWN_PROVIDER_IDS
        .iter()
        .map(|id| id.to_string())
        .collect::<Vec<String>>();

    get_provider_key_status(&provider_ids)
}
