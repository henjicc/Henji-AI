# Minimax Video-01

Minimax Video-01（又名海螺）是一款 AI 视频生成模型，可生成 6 秒、720p 分辨率、25 帧/秒的视频。支持文本生成视频（文生视频）和图片生成视频（图生视频）两种模式。

这是一个**异步**API，只会返回异步任务的 task\_id。您应该使用该 task\_id 请求 [查询任务结果 API](/docs/models/reference-get-async-task-result) 来检索视频生成结果。

## 请求示例

**请求方法**: `POST`

**请求地址**: `https://api.ppinfra.com/v3/async/minimax-video-01`

```bash
curl --request POST \
  --url https://api.ppinfra.com/v3/async/minimax-video-01 \
  --header 'Authorization: <authorization>' \
  --header 'Content-Type: application/json' \
  --data '
{
  "prompt": "<string>",
  "image_url": "<string>",
  "enable_prompt_expansion": true
}
'
```

**响应示例**:
```json
{
  "task_id": "<string>"
}
```

## 请求头

### Content-Type
*   **类型**: `string`
*   **是否必需**: 是
*   **枚举值**: `application/json`

### Authorization
*   **类型**: `string`
*   **是否必需**: 是
*   **说明**: Bearer 身份验证格式，例如：`Bearer {{API 密钥}}`。

## 请求体

### prompt
*   **类型**: `string`
*   **是否必需**: 是
*   **说明**: 指导生成所需的提示词文本。
*   **取值范围**: `1 <= x <= 2000`

### image_url
*   **类型**: `string`
*   **是否必需**: 否
*   **说明**: 用于视频生成的首帧图片的 URL。

### enable_prompt_expansion
*   **类型**: `boolean`
*   **是否必需**: 否
*   **说明**: 是否启用提示词优化。
*   **默认值**: `true`

## 响应

### task_id
*   **类型**: `string`
*   **是否必需**: 是
*   **说明**: 异步任务的 task\_id。您应该使用该 task\_id 请求 [查询任务结果 API](/docs/models/reference-get-async-task-result) 以获取生成结果。