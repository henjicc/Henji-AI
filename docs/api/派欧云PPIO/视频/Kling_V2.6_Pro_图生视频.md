# Kling V2.6 Pro 图生视频

Kling v2.6 Pro 图像转视频工具可将静态图像转换为动态视频，在保持主体一致性的同时，生成自然运动与更流畅的场景动态效果。

这是一个**异步**API，只会返回异步任务的 `task_id`。您应该使用该 `task_id` 请求 [查询任务结果 API](/docs/models/reference-get-async-task-result) 来检索视频生成结果。

## 请求头

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `Content-Type` | string | 是 | 枚举值: `application/json` |
| `Authorization` | string | 是 | Bearer 身份验证格式，例如：Bearer {{API 密钥}}。 |

## 请求体

| 参数名 | 类型 | 必填 | 默认值 | 说明与约束 |
| :--- | :--- | :--- | :--- | :--- |
| `image` | string | 是 | - | 视频首帧图片；支持 `.jpg`、`.jpeg`、`.png`。<br>图片文件大小不得超过 10MB；宽高均需 >= 300px；宽高比需在 1:2.5 与 2.5:1 之间。 |
| `sound` | boolean | 否 | `true` | 是否在生成视频时同时生成音频。 |
| `prompt` | string | 是 | - | 生成视频的正向提示词文本；不可超过 2500 个字符。 |
| `duration` | integer | 否 | `5` | 生成媒体的持续时间（秒）可选值：`5`, `10` |
| `cfg_scale` | number | 否 | - | 控制视频生成的灵活性，数值越高，模型生成内容对提示词的贴合度越高。取值范围：[0, 1] |
| `voice_list` | array | 否 | - | 语音 ID 列表（最多 2 个）。数组长度：0 - 2 |
| `aspect_ratio` | string | 否 | `"16:9"` | 生成视频的宽高比可选值：`16:9`, `9:16`, `1:1` |
| `negative_prompt` | string | 否 | - | 反向提示词；长度不超过 2500 字符。 |

## 响应

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `task_id` | string | 是 | 异步任务的 task_id。您应该使用该 task_id 请求 [查询任务结果 API](/docs/models/reference-get-async-task-result) 以获取生成结果 |

## 调用示例

**请求**
```bash
curl --request POST \
  --url https://api.ppinfra.com/v3/async/kling-v2.6-pro-i2v \
  --header 'Authorization: <authorization>' \
  --header 'Content-Type: application/json' \
  --data '
{
  "image": "<string>",
  "sound": true,
  "prompt": "<string>",
  "duration": 5,
  "cfg_scale": 0.7,
  "voice_list": [
    {}
  ],
  "aspect_ratio": "16:9",
  "negative_prompt": "<string>"
}
'
```

**响应**
```json
{
  "task_id": "<string>"
}
```