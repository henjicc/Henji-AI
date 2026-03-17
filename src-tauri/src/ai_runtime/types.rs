use crate::ai_runtime::trace::AiRuntimeTrace;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "lowercase")]
#[allow(dead_code)]
pub enum GenerateStatus {
    Completed,
    Failed,
    Timeout,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiGenerateRequestDto {
    pub model_id: String,
    #[serde(default)]
    pub params: Map<String, Value>,
    #[serde(default)]
    pub request_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiContinuePollingRequestDto {
    pub model_id: String,
    pub task_id: String,
    #[serde(default)]
    pub params: Map<String, Value>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiGenerateResponseDto {
    pub status: GenerateStatus,
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trace: Option<AiRuntimeTrace>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderKeyStatusDto {
    pub provider_id: String,
    pub configured: bool,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ModelManifest {
    #[serde(default)]
    pub models: Vec<ModelManifestItem>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelManifestItem {
    pub model_id: String,
    pub provider_id: String,
    #[allow(dead_code)]
    #[serde(default)]
    pub model_type: Option<String>,
    #[serde(default)]
    pub polling: Option<PollingConfig>,
    #[serde(default)]
    pub endpoints: Option<EndpointConfigDsl>,
    #[serde(default)]
    pub request: Option<RequestConfigDsl>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PollingConfig {
    pub interval: u64,
    pub max_attempts: u32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EndpointRuleDsl {
    pub when: Value,
    pub route: String,
    #[allow(dead_code)]
    #[serde(default)]
    pub method: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EndpointNamedRouteDsl {
    pub path: String,
    #[allow(dead_code)]
    #[serde(default)]
    pub method: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EndpointConfigDsl {
    pub default_route: String,
    #[serde(default)]
    pub rules: Vec<EndpointRuleDsl>,
    #[serde(default)]
    pub selector_js: Option<String>,
    #[serde(default)]
    pub method: Option<String>,
    #[serde(default)]
    pub routes: HashMap<String, EndpointNamedRouteDsl>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestTransformDsl {
    pub name: String,
    #[serde(default)]
    pub args: Map<String, Value>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestFieldDsl {
    pub from: String,
    pub to: String,
    #[serde(default)]
    pub transforms: Vec<RequestTransformDsl>,
    #[serde(default)]
    pub when: Option<Value>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestConfigDsl {
    #[serde(default)]
    pub constants: Map<String, Value>,
    #[serde(default)]
    pub fields: Vec<RequestFieldDsl>,
    #[serde(default)]
    pub remove_empty: Vec<String>,
    #[serde(default)]
    pub builder_js: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ProviderExecutionResult {
    pub status: GenerateStatus,
    pub url: String,
    pub metadata: Value,
}
