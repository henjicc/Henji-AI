# KLING V1.6 图生视频

KLING V1.6 图生视频是快手 AI 团队开发的 AI 图像生成视频模型。它可以将图片转换为动态的 5 秒视频，支持 720p / 1080p 分辨率，具备高质量的视觉输出、增强的运动与语义理解能力。

这是一个**异步**API，只会返回异步任务的 `task_id`。您应该使用该 `task_id` 请求 [查询任务结果 API](/docs/models/reference-get-async-task-result) 来检索视频生成结果。

## 请求示例

**请求**

```bash
curl --request POST \
  --url https://api.ppinfra.com/v3/async/kling-v1.6-i2v \
  --header 'Authorization: <authorization>' \
  --header 'Content-Type: application/json' \
  --data '
{
  "mode": "<string>",
  "image_url": "<string>",
  "end_image_url": "<string>",
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

| 参数 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `Content-Type` | string | 是 | 固定为 `application/json`。 |
| `Authorization` | string | 是 | Bearer 身份验证格式，例如：`Bearer {{API 密钥}}`。 |

## 请求体

| 参数 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `mode` | string | 否 | 视频生成模式。支持：<br/>• `Standard`：快速生成，成本较低，生成 720p 视频。<br/>• `Professional`：高质量，成本较高，生成 1080p 视频，并允许设置结束帧。<br/>默认值：`Standard`。 |
| `image_url` | string | 是 | 用于视频生成的起始帧图片的 URL。 |
| `end_image_url` | string | 否 | 用于视频生成的结束帧图片的 URL。<br/>仅当 `mode` 为 `Professional` 时可用。 |
| `prompt` | string | 是 | 指导生成所需的提示词。取值范围：`1 <= x <= 2000`。 |
| `negative_prompt` | string | 否 | 负面提示词，用于指示模型应避免生成的内容。取值范围：`0 <= x <= 2000`。 |
| `duration` | integer | 否 | 生成视频的时长（秒）。默认值：`5`。<br/>可选值：`5`、`10` |
| `guidance_scale` | float | 否 | 指导强度参数，控制生成内容与提示词的贴合程度。取值范围：`0 <= x <= 1`。默认值：`0.5`。 |

## 返回结果

| 参数 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `task_id` | string | 是 | 异步任务的 `task_id`。您应该使用该 `task_id` 请求 [查询任务结果 API](/docs/models/reference-get-async-task-result) 以获取生成结果。 |