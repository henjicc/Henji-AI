# Vidu Q1 图生视频

Vidu Q1 图生视频将静态图像转换为动态视频，融入创意故事叙述和动画效果。

这是一个**异步**API，调用后只会返回异步任务的 `task_id`。您需要使用该 `task_id` 请求 [查询任务结果 API](/docs/models/reference-get-async-task-result) 来检索视频生成结果。

## 接口调用示例

**请求示例**
```bash
curl --request POST \
  --url https://api.ppinfra.com/v3/async/vidu-q1-img2video \
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
  "resolution": "<string>",
  "movement_amplitude": "<string>",
  "bgm": true
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

| 参数 | 类型 | 是否必需 | 说明 |
| :--- | :--- | :--- | :--- |
| `Content-Type` | string | 是 | 必须为 `application/json`。 |
| `Authorization` | string | 是 | Bearer 身份验证格式，例如：`Bearer {{API 密钥}}`。 |

## 请求体

| 参数 | 类型 | 是否必需 | 说明 |
| :--- | :--- | :--- | :--- |
| `images` | string[] | 是 | 用作生成视频起始帧的图像。<br>**要求：**<br>• 仅接受 1 张图像。<br>• 支持公共 URL 或 Base64 格式。<br>• 支持格式：png、jpeg、jpg、webp。<br>• 图像宽高比必须小于 1:4 或 4:1。<br>• 所有图像限制为 50MB。<br>• Base64 字符串解码后的长度必须小于 10MB，且必须包含适当的内容类型前缀，例如：`data:image/png;base64,{base64_encode}`。 |
| `prompt` | string | 是 | 视频生成的文本提示词，最大长度为 1500 个字符。 |
| `duration` | integer | 否 | 视频持续时间（秒）。<br>**默认值：** `5`<br>**当前支持选项：** `5` |
| `seed` | integer | 否 | 视频生成的随机种子。<br>**默认值：** 随机生成<br>手动设置的值将覆盖默认的随机种子。 |
| `resolution` | string | 否 | 输出视频分辨率。<br>**默认值：** `1080p`<br>**当前支持选项：** `1080p` |
| `movement_amplitude` | string | 否 | 画面中物体的运动幅度。<br>**默认值：** `auto`<br>**可选值：** `auto`、`small`、`medium`、`large` |
| `bgm` | boolean | 否 | 是否为生成的视频添加背景音乐。<br>**默认值：** `false`<br>**可选值：** `true`、`false`<br>当设置为 `true` 时，系统将自动添加合适的 BGM。BGM 无时长限制，系统会自动适配。 |

## 响应

| 参数 | 类型 | 是否必需 | 说明 |
| :--- | :--- | :--- | :--- |
| `task_id` | string | 是 | 异步任务的 ID。您需要使用此 ID 请求 [查询任务结果 API](/docs/models/reference-get-async-task-result) 以获取生成结果。 |

[Vidu Q1 文生视频](/docs/models/reference-vidu-q1-txt2video) | [Vidu Q1 首末帧](/docs/models/reference-vidu-q1-startend2video)