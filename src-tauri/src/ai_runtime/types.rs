use crate::ai_runtime::trace::AiRuntimeTrace;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "lowercase")]
#[allow(dead_code)]
pub enum GenerateStatus {
    Completed,
    Pending,
    Failed,
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

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiGetProgressEstimateRequestDto {
    pub model_id: String,
    #[serde(default)]
    pub params: Map<String, Value>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiRecordProgressSampleRequestDto {
    pub model_id: String,
    #[serde(default)]
    pub params: Map<String, Value>,
    pub started_at_ms: i64,
    pub finished_at_ms: i64,
    pub source: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiGenerateResponseDto {
    pub status: GenerateStatus,
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_id: Option<String>,
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProgressEstimateSource {
    TimeBucket,
    Global,
    Seed,
    Meta,
    Default,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiProgressEstimateDto {
    pub duration_ms: u64,
    pub source: ProgressEstimateSource,
    pub profile_key: String,
    pub time_bucket: String,
    pub global_sample_count: usize,
    pub bucket_sample_count: usize,
    pub default_duration_ms: u64,
    pub global_estimate_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bucket_estimate_ms: Option<u64>,
    #[serde(default)]
    pub recent_global_durations_ms: Vec<u64>,
    #[serde(default)]
    pub recent_bucket_durations_ms: Vec<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiRecordProgressSampleResponseDto {
    pub actual_duration_ms: u64,
    pub estimate: AiProgressEstimateDto,
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
    pub progress: Option<ProgressConfig>,
    #[serde(default)]
    pub progress_learning: Option<ProgressLearningConfig>,
    #[serde(default)]
    pub endpoints: Option<EndpointConfigDsl>,
    #[serde(default)]
    pub request: Option<RequestConfigDsl>,
    #[serde(default)]
    pub runtime_constraints: Option<RuntimeConstraintsDsl>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PollingConfig {
    pub interval: u64,
    pub max_attempts: u32,
    #[serde(default)]
    pub expected_attempts: Option<u32>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressConfig {
    pub mode: String,
    #[serde(default)]
    pub base_duration_ms: Option<u64>,
    #[serde(default)]
    pub per_unit_ms: Option<u64>,
    #[serde(default)]
    pub scale_with: Option<String>,
    #[serde(default)]
    pub min_duration_ms: Option<u64>,
    #[serde(default)]
    pub max_duration_ms: Option<u64>,
    #[serde(default)]
    pub base_attempts: Option<u32>,
    #[serde(default)]
    pub per_unit_attempts: Option<u32>,
    #[serde(default)]
    pub min_attempts: Option<u32>,
    #[serde(default)]
    pub max_attempts: Option<u32>,
    #[serde(default)]
    pub interval_ms: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressLearningConfig {
    #[serde(default)]
    pub segments: Vec<ProgressLearningSegment>,
    #[serde(default)]
    pub enable_time_buckets: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ProgressLearningSegment {
    Field { field: String },
    TextLength { field: String, buckets: Vec<u32> },
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

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeConstraintsDsl {
    #[serde(default)]
    pub number_fields: Vec<RuntimeNumberFieldConstraintDsl>,
    #[serde(default)]
    pub enum_fields: Vec<RuntimeEnumFieldConstraintDsl>,
    #[serde(default)]
    pub image_size_fields: Vec<RuntimeImageSizeFieldConstraintDsl>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeNumberFieldConstraintDsl {
    pub field: String,
    #[serde(default)]
    pub min: Option<f64>,
    #[serde(default)]
    pub max: Option<f64>,
    #[serde(default)]
    pub integer: Option<bool>,
    #[serde(default)]
    pub fallback: Option<f64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeEnumFieldConstraintDsl {
    pub field: String,
    #[serde(default)]
    pub allowed: Vec<Value>,
    #[serde(default)]
    pub fallback: Option<Value>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeImageSizeFieldConstraintDsl {
    pub field: String,
    #[serde(default)]
    pub format: Option<String>,
    #[serde(default)]
    pub width_key: Option<String>,
    #[serde(default)]
    pub height_key: Option<String>,
    #[serde(default)]
    pub min_side: Option<f64>,
    #[serde(default)]
    pub max_side: Option<f64>,
    #[serde(default)]
    pub min_pixels: Option<f64>,
    pub max_pixels: f64,
    #[serde(default)]
    pub min_aspect_ratio: Option<f64>,
    #[serde(default)]
    pub max_aspect_ratio: Option<f64>,
}

#[derive(Debug, Clone)]
pub struct ProviderExecutionResult {
    pub status: GenerateStatus,
    pub url: String,
    pub task_id: Option<String>,
    pub metadata: Value,
}
