# Kling-o1 文生视频

Kling Omni Video O1 是快手首款采用 MVL（多模态视觉语言）技术的统一多模态视频模型。其文本转视频模式可根据文本提示生成电影级视频，并保持主题一致性、自然物理模拟和精准语义理解。

这是一个**异步**API，只会返回异步任务的 `task_id`。您应该使用该 `task_id` 请求 [查询任务结果 API](/docs/models/reference-get-async-task-result) 来检索视频生成结果。

## 请求

**端点**
```
POST https://api.ppinfra.com/v3/async/kling-o1-t2v
```

**cURL 示例**
```bash
curl --request POST \
  --url https://api.ppinfra.com/v3/async/kling-o1-t2v \
  --header 'Authorization: <authorization>' \
  --header 'Content-Type: application/json' \
  --data '
{
  "prompt": "<string>",
  "duration": 123,
  "aspect_ratio": "<string>"
}
'
```

## 请求头

| 参数 | 类型 | 是否必需 | 描述 |
| :--- | :--- | :--- | :--- |
| `Content-Type` | string | 是 | 必须为 `application/json`。 |
| `Authorization` | string | 是 | Bearer 身份验证格式，例如：`Bearer {{API 密钥}}`。 |

## 请求体

| 参数 | 类型 | 是否必需 | 默认值 | 描述 | 可选值 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `prompt` | string | 是 | - | 生成视频的正向提示词。 | - |
| `duration` | integer | 否 | `5` | 生成视频的持续时间（秒）。 | `5`, `10` |
| `aspect_ratio` | string | 否 | `"16:9"` | 生成视频的宽高比。 | `16:9`, `9:16`, `1:1` |

## 响应

**响应示例**
```json
{
  "task_id": "<string>"
}
```

**响应参数**

| 参数 | 类型 | 是否必需 | 描述 |
| :--- | :--- | :--- | :--- |
| `task_id` | string | 是 | 异步任务的 ID。您应使用此 ID 请求 [查询任务结果 API](/docs/models/reference-get-async-task-result) 以获取生成结果。 |

---
[Kling-o1 参考生视频](/docs/models/reference-kling-o1-ref2v) | [Kling-o1 视频编辑](/docs/models/reference-kling-o1-video-edit)