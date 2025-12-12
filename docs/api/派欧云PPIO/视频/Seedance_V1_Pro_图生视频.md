# Seedance V1 Pro 图生视频

Seedance V1 Pro 是一个 AI 视频模型，专为生成连贯的多镜头视频而设计，提供流畅的运动和对详细提示的精确遵循。它支持 480p、720p 和 1080p 的分辨率。

本接口支持个人认证及企业认证用户调用。请参见 [实名认证](/docs/support/identity-verification)，完成个人用户认证或企业用户认证，以确保可以正常使用本功能。

## 接口调用示例

**请求示例**
```bash
curl --request POST \
  --url https://api.ppinfra.com/v3/async/seedance-v1-pro-i2v \
  --header 'Authorization: <authorization>' \
  --header 'Content-Type: application/json' \
  --data '
{
  "prompt": "<string>",
  "image": "<string>",
  "last_image": "<string>",
  "resolution": "<string>",
  "aspect_ratio": "<string>",
  "camera_fixed": true,
  "seed": 123,
  "duration": 123
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

| 参数 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `Content-Type` | string | 是 | 必须为 `application/json`。 |
| `Authorization` | string | 是 | Bearer 身份验证格式，例如：`Bearer {{API 密钥}}`。 |

## 请求体

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- | :--- |
| `prompt` | string | 否 | - | 视频生成的文本提示（正面提示）。支持中英文，建议不超过500字。 |
| `image` | string | 是 | - | 输入图像，支持 URL 和 Base64 格式。<br>• 图片格式：`jpeg`, `png`, `webp`, `bmp`, `tiff`, `gif`。<br>• 文件大小 ≤ 30MB。<br>• 短边 > 300 像素，长边 < 6000 像素。<br>• 宽高比在 0.4 到 2.5 之间。 |
| `last_image` | string | 否 | - | 结束图像，支持 URL 和 Base64 格式。要求与 `image` 参数相同。<br>传入的首尾帧图片可相同。首尾帧图片的宽高比不一致时，以首帧图片为主，尾帧图片会自动裁剪适配。 |
| `resolution` | string | 是 | - | 视频质量。可选值：`480p`, `720p`, `1080p`。 |
| `aspect_ratio` | string | 否 | `"16:9"` | 生成视频的长宽比。可选值：`21:9`, `16:9`, `4:3`, `1:1`, `3:4`, `9:16`, `9:21`。 |
| `camera_fixed` | boolean | 否 | `false` | 确定相机位置是否应保持固定。 |
| `seed` | integer | 否 | `-1` | 用于生成的随机种子。`-1` 表示使用随机种子。 |
| `duration` | integer | 否 | `5` | 指定生成视频的长度（秒）。可选值：`5`, `10`。 |

## 响应

| 参数 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `task_id` | string | 是 | 异步任务的 ID。使用此 `task_id` 请求 [查询任务结果 API](/docs/models/reference-get-async-task-result) 以获取生成结果。 |