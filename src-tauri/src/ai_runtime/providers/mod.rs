pub mod fal;
pub mod kie;
pub mod modelscope;
pub mod ppio;

use crate::ai_runtime::errors::{AiResult, AiRuntimeError};
use crate::ai_runtime::types::{PollingConfig, ProviderExecutionResult};
use serde_json::Value;

pub struct ProviderExecutionInput<'a> {
    pub client: &'a reqwest::Client,
    pub api_key: &'a str,
    pub route: &'a str,
    pub method: &'a str,
    pub body: &'a Value,
    pub request_id: &'a str,
    pub polling: Option<&'a PollingConfig>,
}

pub async fn execute_generate(
    provider_id: &str,
    input: ProviderExecutionInput<'_>,
) -> AiResult<ProviderExecutionResult> {
    match provider_id {
        "ppio" => ppio::execute(input).await,
        "kie" => kie::execute(input).await,
        "modelscope" => modelscope::execute(input).await,
        "fal" => fal::execute(input).await,
        _ => Err(AiRuntimeError::new(
            "unsupported_provider",
            format!("Unsupported provider: {}", provider_id),
        )),
    }
}
