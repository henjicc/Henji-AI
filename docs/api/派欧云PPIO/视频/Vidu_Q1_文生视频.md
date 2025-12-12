# Vidu Q1 文生视频

这是一个**异步**API，通过关键帧技术生成流畅无缝、主题风格一致的视频。调用后返回异步任务的 `task_id`，您需要使用该 `task_id` 请求 [查询任务结果 API](/docs/models/reference-get-async-task-result) 来获取视频生成结果。

## 请求示例

**请求**
```bash
curl --request POST \
  --url https://api.ppinfra.com/v3/async/vidu-q1-text2video \
  --header 'Authorization: <authorization>' \
  --header 'Content-Type: application/json' \
  --data '
{
  "prompt": "<string>",
  "style": "<string>",
  "duration": 123,
  "seed": 123,
  "aspect_ratio": "<string>",
  "resolution": "<string>",
  "movement_amplitude": "<string>",
  "bgm": true
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

| 参数 | 类型 | 是否必需 | 描述 |
| :--- | :--- | :--- | :--- |
| `Content-Type` | string | 是 | 必须为 `application/json`。 |
| `Authorization` | string | 是 | Bearer 身份验证格式，例如：`Bearer {{API 密钥}}`。 |

## 请求体

| 参数 | 类型 | 是否必需 | 描述 |
| :--- | :--- | :--- | :--- |
| `prompt` | string | 是 | 视频生成的文本提示词，最大长度为 1500 个字符。 |
| `style` | string | 否 | 输出视频的风格。<br>**默认值**：`general`<br>**可选值**：<br>- `general`：通用风格。允许通过提示词控制风格。<br>- `anime`：动漫风格。针对动漫美学优化，对动漫相关提示词有更好的表现。 |
| `duration` | integer | 否 | 视频持续时间（秒）。<br>**默认值**：`5`<br>**当前仅支持**：`5` |
| `seed` | integer | 否 | 视频生成的随机种子。<br>- 默认为随机种子数值。<br>- 手动设置的值将覆盖默认的随机种子。 |
| `aspect_ratio` | string | 否 | 输出视频的宽高比。<br>**默认值**：`16:9`<br>**可选值**：`16:9`、`9:16`、`1:1` |
| `resolution` | string | 否 | 输出视频分辨率。<br>**默认值**：`1080p`<br>**当前仅支持**：`1080p` |
| `movement_amplitude` | string | 否 | 画面中物体的运动幅度。<br>**默认值**：`auto`<br>**可选值**：`auto`、`small`、`medium`、`large` |
| `bgm` | boolean | 否 | 是否为生成的视频添加背景音乐。<br>**默认值**：`false`<br>**可选值**：`true`、`false`<br>当设置为 `true` 时，系统将自动添加合适的 BGM。BGM 无时长限制，系统会自动适配。 |

## 响应

| 参数 | 类型 | 是否必需 | 描述 |
| :--- | :--- | :--- | :--- |
| `task_id` | string | 是 | 异步任务的 `task_id`。您应该使用该 `task_id` 请求 [查询任务结果 API](/docs/models/reference-get-async-task-result) 以获取生成结果。 |