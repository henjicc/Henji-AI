# Kling V2.6 Pro 文生视频

> 来源: https://ppio.com/docs/models/reference-kling-v2.6-pro-t2v

Kling v2.6 Pro 文本转视频工具可根据文本提示词生成高质量动态视频，支持音视频同步生成。

这是一个**异步**API，只会返回异步任务的 task\_id。您应该使用该 task\_id 请求 [查询任务结果 API](/docs/models/reference-get-async-task-result) 来检索视频生成结果。

## 请求

**方法：** POST
**端点：** `https://api.ppinfra.com/v3/async/kling-v2.6-pro-t2v`

### 请求头

| 参数 | 类型 | 说明 | 是否必填 |
| :--- | :--- | :--- | :--- |
| `Content-Type` | `string` | 必须为 `application/json`。 | 是 |
| `Authorization` | `string` | Bearer 身份验证格式，例如：`Bearer {{API_KEY}}`。 | 是 |

### 请求体

| 参数 | 类型 | 说明 | 是否必填 | 默认值/有效值 |
| :--- | :--- | :--- | :--- | :--- |
| `sound` | `boolean` | 是否在生成视频时同时生成音频。 | 否 | `true` |
| `prompt` | `string` | 生成视频的正向提示词文本；不可超过 2500 个字符。 | 是 | - |
| `duration` | `integer` | 生成媒体的持续时间（秒）。 | 否 | `5`<br>可选值：`5`, `10` |
| `cfg_scale` | `number` | 控制视频生成的灵活性，数值越高，模型生成内容对提示词的贴合度越高。取值范围：[0, 1] | 否 | - |
| `aspect_ratio` | `string` | 生成视频的宽高比。 | 否 | `"1:1"`<br>可选值：`"16:9"`, `"9:16"`, `"1:1"` |
| `negative_prompt` | `string` | 反向提示词；长度不超过 2500 字符。 | 否 | - |

### 请求示例

```bash
curl --request POST \
  --url https://api.ppinfra.com/v3/async/kling-v2.6-pro-t2v \
  --header 'Authorization: Bearer <your-api-key>' \
  --header 'Content-Type: application/json' \
  --data '
{
  "sound": true,
  "prompt": "A beautiful sunset over the ocean.",
  "duration": 5,
  "cfg_scale": 0.8,
  "aspect_ratio": "16:9",
  "negative_prompt": "low quality, blurry"
}
'
```

## 响应

### 响应体

| 参数 | 类型 | 说明 |
| :--- | :--- | :--- |
| `task_id` | `string` | 异步任务的唯一标识符。需使用此ID [查询任务结果 API](/docs/models/reference-get-async-task-result) 来获取最终的视频生成结果。 |

### 响应示例

```json
{
  "task_id": "task_abc123xyz789"
}
```