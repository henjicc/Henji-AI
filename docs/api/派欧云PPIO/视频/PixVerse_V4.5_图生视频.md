# PixVerse V4.5 图生视频

使用 PixVerse 最新的 v4.5 模型，根据文本描述和输入图像生成高质量视频。支持多种分辨率、纵横比和运动模式，以实现多样化的视频创作。

这是一个**异步** API，调用后仅返回异步任务的 `task_id`。您需要使用该 `task_id` 调用 [查询任务结果 API](/docs/models/reference-get-async-task-result) 来获取视频生成结果。

## 请求示例

**请求 URL**
```
POST https://api.ppinfra.com/v3/async/pixverse-v4.5-i2v
```

**cURL 示例**
```bash
curl --request POST \
  --url https://api.ppinfra.com/v3/async/pixverse-v4.5-i2v \
  --header 'Authorization: <authorization>' \
  --header 'Content-Type: application/json' \
  --data '
{
  "prompt": "<string>",
  "image": "<string>",
  "resolution": "<string>",
  "negative_prompt": "<string>",
  "fast_mode": true,
  "style": "<string>",
  "seed": 123
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

| 参数名 | 类型 | 是否必需 | 说明 |
| :--- | :--- | :--- | :--- |
| `Content-Type` | string | 是 | 固定为 `application/json`。 |
| `Authorization` | string | 是 | Bearer 身份验证格式，例如：`Bearer {{API 密钥}}`。 |

## 请求体

| 参数名 | 类型 | 是否必需 | 说明与约束 |
| :--- | :--- | :--- | :--- |
| `prompt` | string | 是 | 视频生成的文本提示。<br>• 最大长度：2048 个字符。<br>• 应清晰描述所需场景和动作。 |
| `image` | string | 是 | 视频的第一帧图像。<br>• 支持格式：`.jpg`/`.jpeg`/`.png`。<br>• 文件大小：不超过 10MB。<br>• 分辨率：不小于 300\*300 像素。<br>• 宽高比：应在 1:2.5 ~ 2.5:1 之间。 |
| `resolution` | string | 是 | 视频分辨率/质量。<br>• 默认值：`540p`。<br>• **`fast_mode` 为 `false` 时可选**：`360p`、`540p`、`720p`、`1080p`。<br>• **`fast_mode` 为 `true` 时可选**：`360p`、`540p`、`720p`。 |
| `negative_prompt` | string | 否 | 生成的负面提示。<br>• 最大长度：2048 个字符。 |
| `fast_mode` | boolean | 否 | 是否启用快速模式。启用后将更快生成视频，但可能降低质量并减少费用。<br>• 默认值：`false`。 |
| `style` | string | 否 | 风格预设（仅限 v3.5）。<br>• 可选值：`anime`、`3d_animation`、`clay`、`comic`、`cyberpunk`。 |
| `seed` | integer | 否 | 用于生成的随机种子。 |

## 响应

| 参数名 | 类型 | 是否必需 | 说明 |
| :--- | :--- | :--- | :--- |
| `task_id` | string | 是 | 异步任务的唯一标识符。用于请求 [查询任务结果 API](/docs/models/reference-get-async-task-result) 以获取最终生成结果。 |