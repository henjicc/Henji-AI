# KLING V1.6 文生视频

KLING V1.6 文生视频是快手 AI 团队开发的 AI 文本生成视频模型。它可将文本描述转化为动态的 5 秒 720p 视频，具备高质量视觉输出、增强的运动与语义理解能力。

这是一个**异步**API，只会返回异步任务的 `task_id`。您应该使用该 `task_id` 请求 [查询任务结果 API](/docs/models/reference-get-async-task-result) 来检索视频生成结果。

## 请求示例

**请求**

```bash
curl --request POST \
  --url https://api.ppinfra.com/v3/async/kling-v1.6-t2v \
  --header 'Authorization: <authorization>' \
  --header 'Content-Type: application/json' \
  --data '
{
  "mode": "<string>",
  "prompt": "<string>",
  "negative_prompt": "<string>",
  "duration": 123,
  "guidance_scale": 123
}
'
```

**响应**

```json
{
  "task_id": "<string>"
}
```

## 请求头

| 参数名 | 类型 | 是否必需 | 说明 |
| :--- | :--- | :--- | :--- |
| `Content-Type` | string | 是 | 必须为 `application/json`。 |
| `Authorization` | string | 是 | Bearer 身份验证格式，例如：`Bearer {{API 密钥}}`。 |

## 请求体

| 参数名 | 类型 | 是否必需 | 说明 |
| :--- | :--- | :--- | :--- |
| `mode` | string | 否 | 视频生成模式。支持：<br>• `Standard`：快速生成，成本较低，生成 720p 视频。<br>默认值：`Standard`。 |
| `prompt` | string | 是 | 指导生成所需的提示词文本。取值范围：`1 <= x <= 2000`。 |
| `negative_prompt` | string | 否 | 负面提示词，用于指示模型应避免生成的内容。取值范围：`0 <= x <= 2000`。 |
| `duration` | integer | 否 | 生成视频的时长（秒）。默认值：`5`。<br>可选值：`5`、`10`。 |
| `guidance_scale` | float | 否 | 指导强度参数，控制生成内容与提示词的贴合程度。取值范围：`0 <= x <= 1`。默认值：`0.5`。 |

## 响应

| 参数名 | 类型 | 是否必需 | 说明 |
| :--- | :--- | :--- | :--- |
| `task_id` | string | 是 | 异步任务的 task_id。您应该使用该 task_id 请求 [查询任务结果 API](/docs/models/reference-get-async-task-result) 以获取生成结果。 |