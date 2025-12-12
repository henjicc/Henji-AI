# Kling-o1 视频编辑

Kling Omni Video O1 视频编辑器支持通过自然语言命令进行对话式视频编辑。只需简单的文本指令，例如”移除行人”或”将白天改为黄昏”，即可移除物体、更换背景、修改样式、调整天气/光照以及转换场景。

这是一个**异步**API，调用后会返回异步任务的 `task_id`。您需要使用该 `task_id` 请求 [查询任务结果 API](/docs/models/reference-get-async-task-result) 来获取最终的视频生成结果。

## 请求示例

**请求端点**
```
POST https://api.ppinfra.com/v3/async/kling-o1-video-edit
```

**cURL 示例**
```bash
curl --request POST \
  --url https://api.ppinfra.com/v3/async/kling-o1-video-edit \
  --header 'Authorization: <authorization>' \
  --header 'Content-Type: application/json' \
  --data '
{
  "video": "<string>",
  "images": [
    {}
  ],
  "prompt": "<string>",
  "fast_mode": true,
  "aspect_ratio": "<string>",
  "keep_original_sound": true
}
'
```

**响应示例**
```json
{
  "task_id": "<string>"
}
```

## 请求头

| 参数名 | 类型 | 是否必需 | 描述 |
| :--- | :--- | :--- | :--- |
| `Content-Type` | string | 是 | 必须为 `application/json`。 |
| `Authorization` | string | 是 | Bearer 身份验证格式，例如：`Bearer {{API 密钥}}`。 |

## 请求体

| 参数名 | 类型 | 是否必需 | 默认值 | 描述 |
| :--- | :--- | :--- | :--- | :--- |
| `video` | string | 是 | - | 待编辑视频的 URL。 |
| `images` | array | 否 | `[]` | 包含元素、场景、风格等参考图片的数组。最多可包含 4 张图片。 |
| `prompt` | string | 是 | - | 描述编辑需求的自然语言提示词。 |
| `fast_mode` | boolean | 否 | `false` | 是否使用快速生成模式。 |
| `aspect_ratio` | string | 否 | - | 生成视频的宽高比。可选值：`16:9`, `9:16`, `1:1`。 |
| `keep_original_sound` | boolean | 否 | `true` | 是否保留原始视频的声音。 |

## 响应

| 参数名 | 类型 | 是否必需 | 描述 |
| :--- | :--- | :--- | :--- |
| `task_id` | string | 是 | 异步任务的 ID。用于向 [查询任务结果 API](/docs/models/reference-get-async-task-result) 请求获取生成结果。 |