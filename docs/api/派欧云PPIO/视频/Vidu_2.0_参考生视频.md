# Vidu 2.0 参考生视频

Vidu 2.0 参考生视频使用参考图像和文本描述生成视频。支持各种主体，如角色和物体。通过上传主体的多个视角，您可以创建保持视觉一致性的视频。

这是一个**异步**API，只会返回异步任务的 `task_id`。您应该使用该 `task_id` 请求 [查询任务结果 API](/docs/models/reference-get-async-task-result) 来检索视频生成结果。

## 请求

**端点**
```
POST https://api.ppinfra.com/v3/async/vidu-2.0-reference2video
```

**cURL 示例**
```bash
curl --request POST \
  --url https://api.ppinfra.com/v3/async/vidu-2.0-reference2video \
  --header 'Authorization: <authorization>' \
  --header 'Content-Type: application/json' \
  --data '
{
  "images": [
    "<string>"
  ],
  "prompt": "<string>",
  "duration": 123,
  "seed": 123,
  "aspect_ratio": "<string>",
  "resolution": "<string>",
  "movement_amplitude": "<string>",
  "bgm": true
}
'
```

## 请求头

| 参数 | 类型 | 是否必需 | 描述 |
| :--- | :--- | :--- | :--- |
| `Authorization` | string | 是 | Bearer 身份验证格式，例如：`Bearer {{API 密钥}}`。 |
| `Content-Type` | string | 是 | 必须为 `application/json`。 |

## 请求体

| 参数 | 类型 | 是否必需 | 描述 |
| :--- | :--- | :--- | :--- |
| `images` | string[] | 是 | 模型将使用提供的图像作为参考，生成具有一致主体的视频。图像字段要求：<br>• 接受 1 至 3 张图像<br>• 图像资源可通过 URL 或 Base64 编码提供<br>• 必须使用以下格式之一：PNG、JPEG、JPG、WebP<br>• 图像尺寸必须至少为 128x128 像素<br>• 图像宽高比必须小于 1:4 或 4:1<br>• 所有图像限制为 50MB<br>• base64 解码后的长度必须小于 10MB，且必须包含适当的内容类型字符串。例如：`data:image/png;base64,{base64_encode}` |
| `prompt` | string | 是 | 视频生成的文本提示词，最大长度为 1500 个字符。 |
| `duration` | integer | 否 | 视频持续时间（秒）。默认：`4` 秒。当前仅支持 `4`。 |
| `seed` | integer | 否 | 视频生成的随机种子。默认为随机种子数值；手动设置的值将覆盖默认的随机种子。 |
| `aspect_ratio` | string | 否 | 输出视频的宽高比。默认值：`16:9`。<br>可选值：`16:9`、`9:16`、`1:1` |
| `resolution` | string | 否 | 分辨率参数。默认值：`360p`。<br>可选值：`360p`、`720p` |
| `movement_amplitude` | string | 否 | 画面中物体的运动幅度。默认值：`auto`。<br>可选值：`auto`、`small`、`medium`、`large` |
| `bgm` | boolean | 否 | 是否为生成的视频添加背景音乐。默认值：`false`。<br>可选值：`true`、`false`<br>当设置为 `true` 时，系统将自动添加合适的 BGM。BGM 无时长限制，系统会自动适配。 |

## 响应

**响应示例**
```json
{
  "task_id": "<string>"
}
```

| 参数 | 类型 | 是否必需 | 描述 |
| :--- | :--- | :--- | :--- |
| `task_id` | string | 是 | 异步任务的 `task_id`。您应该使用该 `task_id` 请求 [查询任务结果 API](/docs/models/reference-get-async-task-result) 以获取生成结果。 |