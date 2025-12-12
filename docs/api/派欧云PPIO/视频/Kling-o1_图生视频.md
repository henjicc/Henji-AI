# Kling-o1 图生视频

Kling Omni Video O1 图像转视频工具利用 MVL（多模态视觉语言）技术，将静态图像转换为动态的电影级视频。它在保持主体一致性的同时，还能添加自然运动、物理模拟和流畅的场景动态效果。

这是一个**异步**API，只会返回异步任务的 task_id。您应该使用该 task_id 请求 [查询任务结果 API](/docs/models/reference-get-async-task-result) 来检索视频生成结果。

## 接口调用

**请求方法**: POST
**端点**: `https://api.ppinfra.com/v3/async/kling-o1-i2v`

### 请求示例 (cURL)

```bash
curl --request POST \
  --url https://api.ppinfra.com/v3/async/kling-o1-i2v \
  --header 'Authorization: <authorization>' \
  --header 'Content-Type: application/json' \
  --data '
{
  "image": "<string>",
  "prompt": "<string>",
  "duration": 123,
  "last_image": "<string>",
  "aspect_ratio": "<string>"
}
'
```

### 响应示例

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
| `image` | string | 是 | - | 首帧图像。 |
| `prompt` | string | 是 | - | 生成视频的正向提示词。 |
| `duration` | integer | 否 | `5` | 生成视频的持续时间（秒）。可选值：`5`, `10`。 |
| `last_image` | string | 否 | - | 末帧图像。 |
| `aspect_ratio` | string | 否 | `"16:9"` | 生成视频的宽高比。可选值：`16:9`, `9:16`, `1:1`。 |

## 响应

| 参数 | 类型 | 是否必需 | 描述 |
| :--- | :--- | :--- | :--- |
| `task_id` | string | 是 | 异步任务的唯一标识符。您需要使用此 task_id 调用 [查询任务结果 API](/docs/models/reference-get-async-task-result) 来获取最终生成结果。 |