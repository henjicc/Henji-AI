# Vidu Q1 首末帧

Vidu Q1 首末帧通过起始帧和结束帧生成动态视频，融入创意故事叙述和动画效果。

这是一个**异步**API，只会返回异步任务的 `task_id`。您应该使用该 `task_id` 请求 [查询任务结果 API](/docs/models/reference-get-async-task-result) 来检索视频生成结果。

## 接口调用

**请求方法**: POST
**请求地址**: `https://api.ppinfra.com/v3/async/vidu-q1-startend2video`

### 请求示例

```bash
curl --request POST \
  --url https://api.ppinfra.com/v3/async/vidu-q1-startend2video \
  --header 'Authorization: <authorization>' \
  --header 'Content-Type: <content-type>' \
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

### 响应示例

```json
{
  "task_id": "<string>"
}
```

## 请求头

| 参数 | 类型 | 是否必需 | 说明 |
| :--- | :--- | :--- | :--- |
| `Content-Type` | string | 是 | 固定值 `application/json`。 |
| `Authorization` | string | 是 | Bearer 身份验证格式，例如：`Bearer {{API 密钥}}`。 |

## 请求体

| 参数 | 类型 | 是否必需 | 说明 |
| :--- | :--- | :--- | :--- |
| `images` | string[] | 是 | 两张图像：第一张为起始帧，第二张为结束帧。<br>**注意事项**：<br>1. 支持公共 URL 或 Base64 格式。<br>2. 宽高比必须接近：起始帧与结束帧的比例必须在 0.8~1.25 之间。<br>3. 支持格式：png、jpeg、jpg、webp。<br>4. 最大尺寸：50MB。<br>5. base64 解码后的长度必须小于 10MB，且必须包含适当的内容类型字符串。例如：`data:image/png;base64,{base64_encode}`。 |
| `prompt` | string | 是 | 提示词描述，最大 1500 个字符。 |
| `duration` | integer | 否 | 视频持续时间（秒）。默认为 5 秒，目前仅支持 `5` 秒选项。 |
| `seed` | integer | 否 | 视频生成的随机种子。<br>- 默认为随机种子数值。<br>- 手动设置的值将覆盖默认的随机种子。 |
| `resolution` | string | 否 | 输出视频分辨率。默认为 1080p，目前仅支持 `1080p` 选项。 |
| `movement_amplitude` | string | 否 | 画面中物体的运动幅度。<br>**默认值**：`auto`<br>**可选值**：`auto`、`small`、`medium`、`large` |
| `bgm` | boolean | 否 | 是否为生成的视频添加背景音乐。<br>**默认值**：`false`<br>**可选值**：`true`、`false`<br>当设置为 `true` 时，系统将自动添加合适的 BGM。BGM 无时长限制，系统会自动适配。 |

## 响应

| 参数 | 类型 | 是否必需 | 说明 |
| :--- | :--- | :--- | :--- |
| `task_id` | string | 是 | 异步任务的 `task_id`。您应该使用该 `task_id` 请求 [查询任务结果 API](/docs/models/reference-get-async-task-result) 以获取生成结果。 |

## 相关接口
- [Vidu Q1 图生视频](/docs/models/reference-vidu-q1-img2video)
- [Vidu Q1 参考生视频](/docs/models/reference-vidu-q1-reference2video)