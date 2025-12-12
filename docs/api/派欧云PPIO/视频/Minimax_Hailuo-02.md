# Minimax Hailuo-02

Minimax Hailuo-02 是一款支持文本生成视频和图片生成视频的AI视频生成模型。它可以生成 6秒的 768P 或 1080P 分辨率视频，以及 10秒的 768P 分辨率视频。

这是一个**异步**API，只会返回异步任务的 `task_id`。您应该使用该 `task_id` 请求 [查询任务结果 API](/docs/models/reference-get-async-task-result) 来检索视频生成结果。

## 请求

**端点**
```
POST https://api.ppinfra.com/v3/async/minimax-hailuo-02
```

**cURL 示例**
```bash
curl --request POST \
  --url https://api.ppinfra.com/v3/async/minimax-hailuo-02 \
  --header 'Authorization: <authorization>' \
  --header 'Content-Type: application/json' \
  --data '
{
  "prompt": "<string>",
  "image": "<string>",
  "end_image": "<string>",
  "duration": 123,
  "resolution": "<string>",
  "enable_prompt_expansion": true
}
'
```

## 请求头

| 参数 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `Content-Type` | string | 是 | 必须为 `application/json`。 |
| `Authorization` | string | 是 | Bearer 身份验证格式，例如：`Bearer {{API 密钥}}`。 |

## 请求体

| 参数 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `prompt` | string | 是 | 指导生成所需的提示词文本。范围: `1 <= x <= 2000`。 |
| `image` | string | 否 | 用于视频生成的首帧图片。支持公网 URL 或 Base64 编码（如 `data:image/jpeg;base64,...`）。 |
| `end_image` | string | 否 | 用于视频生成的结束帧图片。支持公网 URL 或 Base64 编码（如 `data:image/jpeg;base64,...`）。 |
| `duration` | integer | 否 | 生成视频的时长（秒）。默认值：`6`。可选值：`6`、`10`。 |
| `resolution` | string | 否 | 生成视频的分辨率。默认值：`768P`。<br>• 6 秒视频支持：`768P`、`1080P`<br>• 10 秒视频仅支持：`768P` |
| `enable_prompt_expansion` | boolean | 否 | 是否启用提示词优化。默认值: `true`。 |

## 响应

**成功响应示例**
```json
{
  "task_id": "<string>"
}
```

| 参数 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `task_id` | string | 是 | 异步任务的 task_id。您应该使用该 task_id 请求 [查询任务结果 API](/docs/models/reference-get-async-task-result) 以获取生成结果。 |

## 示例

以下是如何使用 Minimax Hailuo-02 API 的示例。

### 步骤 1：创建视频生成任务

发起 POST 请求以获取 `task_id`。

**请求**
```bash
curl \
-X POST https://api.ppinfra.com/v3/async/minimax-hailuo-02 \
-H "Authorization: Bearer $your_api_key" \
-H "Content-Type: application/json" \
-d '{
  "image": "https://static.ppinfra.com/docs/assets/minimax-hailuo-video-02-input-image.jpg",
  "prompt": "戴着太阳镜的毛茸茸的熊猫在日出时的雪山顶上跳舞，左移运镜",
  "duration": 6,
  "resolution": "768P",
  "enable_prompt_expansion": true
}'
```

**响应**
```json
{
    "task_id": "{返回的 Task ID}"
}
```

### 步骤 2：查询任务结果

使用上一步获取的 `task_id` 查询生成结果。

**请求**
```bash
curl --location --request GET 'https://api.ppinfra.com/v3/async/task-result?task_id={返回的 Task ID}' \
--header 'Authorization: Bearer {{API Key}}'
```

**响应**
```json
{
    "task": {
        "task_id": "{返回的 Task ID}",
        "task_type": "MINIMAX_HAILUO_02",
        "status": "TASK_STATUS_SUCCEED",
        "reason": "",
        "eta": 0,
        "progress_percent": 100
    },
    "images": [],
    "videos": [
        {
            "video_url": "{生成视频的 URL}",
            "video_url_ttl": "3600",
            "video_type": "mp4"
        }
    ]
}
```

**视频文件**
[示例视频](https://static.ppinfra.com/docs/assets/minimax-hailuo-video-02-result.mp4)