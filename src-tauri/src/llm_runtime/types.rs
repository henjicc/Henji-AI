use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LlmCapabilitiesDto {
    #[serde(default = "default_true")]
    pub text: bool,
    #[serde(default)]
    pub image: bool,
    #[serde(default)]
    pub video: bool,
    #[serde(default)]
    pub audio: bool,
    #[serde(default = "default_true")]
    pub streaming: bool,
    #[serde(default)]
    pub tool_call: bool,
    #[serde(default)]
    pub json_output: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmReasoningConfigDto {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_reasoning_effort")]
    pub effort: String,
}

impl Default for LlmReasoningConfigDto {
    fn default() -> Self {
        Self {
            enabled: false,
            effort: default_reasoning_effort(),
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmModelConfigDto {
    pub provider_id: String,
    pub model_id: String,
    pub display_name: String,
    pub adapter: String,
    #[serde(default)]
    pub base_url: Option<String>,
    #[serde(default)]
    pub capabilities: LlmCapabilitiesDto,
    #[serde(default)]
    pub enabled: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmProviderConfigDto {
    pub provider_id: String,
    pub display_name: String,
    pub adapter: String,
    #[serde(default)]
    pub base_url: Option<String>,
    #[serde(default)]
    pub reasoning: LlmReasoningConfigDto,
    #[serde(default)]
    pub enabled: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmToolSchemaDto {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub input_schema: Option<Value>,
    #[serde(default)]
    pub output_schema: Option<Value>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LlmPolicyDto {
    #[serde(default)]
    pub allowed_tools: Vec<String>,
    #[serde(default)]
    pub require_human_confirmation: bool,
    #[serde(default)]
    pub max_tokens: Option<u32>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LlmMemoryScopeDto {
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub conversation_id: Option<String>,
    #[serde(default)]
    pub long_term_namespace: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmImageUrlValueDto {
    pub url: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmVideoUrlValueDto {
    pub url: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmInputAudioValueDto {
    pub data: String,
    pub format: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum LlmMessageContentPartDto {
    Text {
        text: String,
    },
    ImageUrl {
        #[serde(rename = "imageUrl")]
        image_url: LlmImageUrlValueDto,
    },
    VideoUrl {
        #[serde(rename = "videoUrl")]
        video_url: LlmVideoUrlValueDto,
    },
    InputAudio {
        #[serde(rename = "inputAudio")]
        input_audio: LlmInputAudioValueDto,
    },
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(untagged)]
pub enum LlmMessageContentDto {
    Text(String),
    Parts(Vec<LlmMessageContentPartDto>),
    Null,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmChatMessageDto {
    pub role: String,
    pub content: LlmMessageContentDto,
    #[serde(default)]
    pub name: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmChatRequestDto {
    #[serde(default)]
    pub request_id: Option<String>,
    pub provider_id: String,
    pub model_id: String,
    #[serde(default)]
    pub adapter: Option<String>,
    #[serde(default)]
    pub base_url: Option<String>,
    #[serde(default)]
    pub reasoning: LlmReasoningConfigDto,
    #[serde(default)]
    pub messages: Vec<LlmChatMessageDto>,
    #[serde(default)]
    pub capabilities: LlmCapabilitiesDto,
    #[serde(default)]
    pub tools: Vec<LlmToolSchemaDto>,
    #[serde(default)]
    pub policy: LlmPolicyDto,
    #[serde(default)]
    pub memory: LlmMemoryScopeDto,
    #[serde(default)]
    pub metadata: HashMap<String, Value>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", content = "data")]
pub enum LlmStreamEventDto {
    Token(String),
    ReasoningToken(String),
    Done(LlmTraceDto),
    Error(String),
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmTraceDto {
    pub provider_id: String,
    pub model_id: String,
    pub started_at_ms: u128,
    pub elapsed_ms: u128,
    pub input_chars: usize,
    pub output_chars: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmProviderKeyStatusDto {
    pub provider_id: String,
    pub configured: bool,
}

fn default_true() -> bool {
    true
}

fn default_reasoning_effort() -> String {
    "high".to_string()
}
