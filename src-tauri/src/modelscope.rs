use serde::{Deserialize, Serialize};
use tauri::command;

#[derive(Debug, Serialize, Deserialize)]
pub struct ModelscopeRequest {
    pub model: String,
    pub prompt: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub negative_prompt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub steps: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub guidance: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub seed: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image_url: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ModelscopeTaskResponse {
    pub task_id: String,
    pub request_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ModelscopeTaskStatus {
    pub task_status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_images: Option<Vec<String>>,
    pub request_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ModelscopeError {
    pub errors: serde_json::Value,
    pub request_id: String,
}

/// 提交魔搭 API 图片生成任务（异步模式）
#[command]
pub async fn modelscope_submit_task(
    api_key: String,
    request: ModelscopeRequest,
) -> Result<ModelscopeTaskResponse, String> {
    let client = reqwest::Client::new();

    let response = client
        .post("https://api-inference.modelscope.cn/v1/images/generations")
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .header("X-ModelScope-Async-Mode", "true")
        .json(&request)
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;

    let status = response.status();
    let response_text = response.text().await.map_err(|e| format!("读取响应失败: {}", e))?;

    if !status.is_success() {
        // 尝试解析错误信息
        if let Ok(error) = serde_json::from_str::<ModelscopeError>(&response_text) {
            return Err(format!("魔搭API错误: {:?}", error.errors));
        }
        return Err(format!("HTTP错误 {}: {}", status, response_text));
    }

    serde_json::from_str(&response_text)
        .map_err(|e| format!("解析响应失败: {} - 响应内容: {}", e, response_text))
}

/// 查询魔搭 API 任务状态
#[command]
pub async fn modelscope_check_status(
    api_key: String,
    task_id: String,
) -> Result<ModelscopeTaskStatus, String> {
    let client = reqwest::Client::new();

    let response = client
        .get(format!("https://api-inference.modelscope.cn/v1/tasks/{}", task_id))
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .header("X-ModelScope-Task-Type", "image_generation")
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;

    let status = response.status();
    let response_text = response.text().await.map_err(|e| format!("读取响应失败: {}", e))?;

    if !status.is_success() {
        if let Ok(error) = serde_json::from_str::<ModelscopeError>(&response_text) {
            return Err(format!("魔搭API错误: {:?}", error.errors));
        }
        return Err(format!("HTTP错误 {}: {}", status, response_text));
    }

    serde_json::from_str(&response_text)
        .map_err(|e| format!("解析响应失败: {} - 响应内容: {}", e, response_text))
}
