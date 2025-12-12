# PixVerse V4.5 文生视频

使用 PixVerse 最新的 v4.5 模型从文本描述生成高质量视频。支持多种分辨率、纵横比和风格预设，以实现多样化的视频创作。

这是一个**异步** API，调用后返回异步任务的 `task_id`。您需要使用该 `task_id` 调用 [查询任务结果 API](/docs/models/reference-get-async-task-result) 来获取视频生成结果。

## 请求示例

**请求**
```bash
curl --request POST \
  --url https://api.ppinfra.com/v3/async/pixverse-v4.5-t2v \
  --header 'Authorization: <authorization>' \
  --header 'Content-Type: application/json' \
  --data '
{
  "prompt": "<string>",
  "aspect_ratio": "<string>",
  "resolution": "<string>",
  "negative_prompt": "<string>",
  "fast_mode": true,
  "style": "<string>",
  "seed": 123
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

| 参数名 | 类型 | 是否必需 | 描述 |
| :--- | :--- | :--- | :--- |
| `Content-Type` | string | 是 | 必须为 `application/json`。 |
| `Authorization` | string | 是 | Bearer 身份验证格式，例如：`Bearer {{API 密钥}}`。 |

## 请求体

| 参数名 | 类型 | 是否必需 | 描述 |
| :--- | :--- | :--- | :--- |
| `prompt` | string | 是 | 视频生成的文本提示。最大长度：2048 个字符。建议清晰描述所需场景和动作。 |
| `aspect_ratio` | string | 是 | 视频的宽高比。默认值：`16:9`。<br>可接受的值：`16:9`、`4:3`、`1:1`、`3:4`、`9:16`。 |
| `resolution` | string | 是 | 视频质量。默认值：`540p`。<br>可接受的值：<br>- 当 `fast_mode` 为 `false` 时：`360p`、`540p`、`720p`、`1080p`。<br>- 当 `fast_mode` 为 `true` 时：`360p`、`540p`、`720p`。 |
| `negative_prompt` | string | 否 | 生成的负面提示。最大长度：2048 个字符。 |
| `fast_mode` | boolean | 否 | 是否启用快速模式。该模式将更快地生成视频，但可能降低质量并降低价格。默认值：`false`。 |
| `style` | string | 否 | 风格预设（仅限 v3.5）。<br>可接受的值：`anime`、`3d_animation`、`clay`、`comic`、`cyberpunk`。 |
| `seed` | integer | 否 | 用于生成的随机种子。 |

## 响应

| 参数名 | 类型 | 是否必需 | 描述 |
| :--- | :--- | :--- | :--- |
| `task_id` | string | 是 | 异步任务的 ID。您应该使用此 ID 请求 [查询任务结果 API](/docs/models/reference-get-async-task-result) 以获取生成结果。 |