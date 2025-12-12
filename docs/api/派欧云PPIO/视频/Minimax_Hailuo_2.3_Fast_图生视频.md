# Minimax Hailuo 2.3 Fast 图生视频

Minimax Hailuo 2.3 Fast 在保持优异画质与表现力的同时，大幅提升了生成速度，具备更高性价比。

这是一个**异步**API，调用后会返回异步任务的 `task_id`。您需要使用该 `task_id` 请求 [查询任务结果 API](/docs/models/reference-get-async-task-result) 来获取视频生成结果。

## 请求示例

**请求方法:** POST
**请求地址:** `https://api.ppinfra.com/v3/async/minimax-hailuo-2.3-fast-i2v`

**cURL 示例:**
```bash
curl --request POST \
  --url https://api.ppinfra.com/v3/async/minimax-hailuo-2.3-fast-i2v \
  --header 'Authorization: <authorization>' \
  --header 'Content-Type: application/json' \
  --data '
{
  "prompt": "<string>",
  "image": "<string>",
  "duration": 123,
  "resolution": "<string>",
  "enable_prompt_expansion": true
}
'
```

**响应示例:**
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

| 参数名 | 类型 | 是否必需 | 说明 |
| :--- | :--- | :--- | :--- |
| `prompt` | string | 是 | 指导生成所需的提示词文本。范围: `1 <= x <= 2000`。 |
| `image` | string | 是 | 用于视频生成的图片。支持公网 URL 或 Base64 编码（如 `data:image/jpeg;base64,...`）。 |
| `duration` | integer | 否 | 生成视频的时长（秒）。<br>**默认值：** `6`<br>**可选值：** `6`、`10` |
| `resolution` | string | 否 | 生成视频的分辨率。<br>**默认值：** `768P`<br>**注意：**<br>- 6 秒视频支持：`768P`、`1080P`<br>- 10 秒视频仅支持：`768P` |
| `enable_prompt_expansion` | boolean | 否 | 是否启用提示词优化。<br>**默认值：** `true`。 |

## 响应

| 参数名 | 类型 | 是否必需 | 说明 |
| :--- | :--- | :--- | :--- |
| `task_id` | string | 是 | 异步任务的 ID。您需要使用此 ID 请求 [查询任务结果 API](/docs/models/reference-get-async-task-result) 以获取生成结果。 |