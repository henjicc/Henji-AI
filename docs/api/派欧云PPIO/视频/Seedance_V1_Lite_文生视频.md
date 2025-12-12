# Seedance V1 Lite 文生视频

Seedance V1 Lite 是一款 AI 视频模型，专为生成连贯的多镜头视频而设计，提供流畅的运动和对详细提示的精确遵循。它支持 480p、720p 和 1080p 的分辨率。

本接口支持个人认证及企业认证用户调用。请参见 [实名认证](/docs/support/identity-verification)，完成个人用户认证或企业用户认证，以确保可以正常使用本功能。

## 接口调用示例

**请求示例**
```bash
curl --request POST \
  --url https://api.ppinfra.com/v3/async/seedance-v1-lite-t2v \
  --header 'Authorization: <authorization>' \
  --header 'Content-Type: application/json' \
  --data '
{
  "prompt": "<string>",
  "resolution": "<string>",
  "aspect_ratio": "<string>",
  "duration": 123,
  "camera_fixed": true,
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

| 参数 | 类型 | 是否必需 | 描述 |
| :--- | :--- | :--- | :--- |
| `Content-Type` | string | 是 | 必须为 `application/json`。 |
| `Authorization` | string | 是 | Bearer 身份验证格式，例如：`Bearer {{API 密钥}}`。 |

## 请求体

| 参数 | 类型 | 是否必需 | 默认值 | 描述 |
| :--- | :--- | :--- | :--- | :--- |
| `prompt` | string | 是 | - | 视频生成的文本提示（正面提示）；支持中英文，建议不超过500字。 |
| `resolution` | string | 是 | - | 视频质量。可接受的值：`480p`，`720p`，`1080p`。 |
| `aspect_ratio` | string | 否 | `"16:9"` | 生成视频的长宽比。可接受的值：`21:9`，`16:9`，`4:3`，`1:1`，`3:4`，`9:16`，`9:21`。 |
| `duration` | integer | 是 | `5` | 指定生成视频的长度（以秒为单位）。可用选项：`5`，`10`。 |
| `camera_fixed` | boolean | 否 | `false` | 确定相机位置是否应保持固定。 |
| `seed` | integer | 否 | `-1` | 用于生成的随机种子。`-1` 表示将使用随机种子。 |

## 响应

| 参数 | 类型 | 是否必需 | 描述 |
| :--- | :--- | :--- | :--- |
| `task_id` | string | 是 | 异步任务的 `task_id`。您应该使用该 `task_id` 请求 [查询任务结果 API](/docs/models/reference-get-async-task-result) 以获取生成结果。 |