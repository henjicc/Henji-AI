# Kling V2.6 Pro 动作控制

Kling v2.6 Pro 动作控制工具可从参考视频提取运动轨迹，并将其应用到参考图像生成视频，同时保持主体一致性。

这是一个**异步**API，调用后仅返回异步任务的 `task_id`。您需要使用这个 `task_id` 调用 [查询任务结果 API](/docs/models/reference-get-async-task-result) 来获取视频生成结果。

## 端点

```
POST https://api.ppinfra.com/v3/async/kling-v2.6-pro-motion-control
```

## 快速示例

### 请求示例

```bash
curl --request POST \
  --url https://api.ppinfra.com/v3/async/kling-v2.6-pro-motion-control \
  --header 'Authorization: <authorization>' \
  --header 'Content-Type: application/json' \
  --data '
{
  "image": "<string>",
  "video": "<string>",
  "prompt": "<string>",
  "negative_prompt": "<string>",
  "keep_original_sound": true,
  "character_orientation": "<string>"
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

| 参数名 | 类型 | 必须 | 描述 |
| :--- | :--- | :--- | :--- |
| `Content-Type` | string | 是 | 固定为 `application/json` |
| `Authorization` | string | 是 | Bearer 令牌，格式为 `Bearer {Your_API_Key}` |

## 请求体参数

| 参数名 | 类型 | 必须 | 描述 | 约束 |
| :--- | :--- | :--- | :--- | :--- |
| `image` | string | 是 | 参考图像的 URL 或 base64 编码。 | 支持 `.jpg`, `.jpeg`, `.png` 格式。文件大小 ≤ 10MB。图像宽和高均需 ≥ 300px，宽高比需在 1:2.5 到 2.5:1 之间。 |
| `video` | string | 是 | 作为运动参考的视频 URL。 | 支持 `.mp4`, `.mov` 格式。文件大小 ≤ 10MB。视频宽和高均需 ≥ 300px，时长需在 3-30 秒之间。 |
| `prompt` | string | 否 | 正向提示词，描述场景、风格、光照等。 | |
| `negative_prompt` | string | 否 | 反向提示词。 | 长度不超过 2500 字符。 |
| `keep_original_sound` | boolean | 否 | 是否保留参考视频的原始音频。 | 默认值：`true` |
| `character_orientation` | string | 是 | 输出视频的帧（取景）模式。 | **取值**：<br>`image`: 输出视频匹配参考图像的构图，**输出时长固定为5秒**。<br>`video`: 输出视频匹配参考视频的构图，**输出时长与参考视频一致，最长30秒**。 |

## 响应参数

| 参数名 | 类型 | 必须 | 描述 |
| :--- | :--- | :--- | :--- |
| `task_id` | string | 是 | 异步任务的唯一标识符。用于通过 [查询任务结果 API](/docs/models/reference-get-async-task-result) 获取最终的生成结果。 |