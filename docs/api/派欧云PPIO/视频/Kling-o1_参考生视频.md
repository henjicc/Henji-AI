# Kling-o1 参考生视频

Kling Omni Video O1 参考视频生成功能，可利用角色、道具或场景参考，从多个视角生成创意视频。它提取主体特征并创建新的视频内容，同时保持帧与帧之间的一致性。

这是一个**异步**API，只会返回异步任务的 `task_id`。您应该使用该 `task_id` 请求 [查询任务结果 API](/docs/models/reference-get-async-task-result) 来检索视频生成结果。

## 接口信息

**请求方法：** POST
**请求地址：** `https://api.ppinfra.com/v3/async/kling-o1-ref2v`

## 请求示例

```bash
curl --request POST \
  --url https://api.ppinfra.com/v3/async/kling-o1-ref2v \
  --header 'Authorization: <authorization>' \
  --header 'Content-Type: application/json' \
  --data '
{
  "video": "<string>",
  "images": [
    {}
  ],
  "prompt": "<string>",
  "duration": 123,
  "aspect_ratio": "<string>",
  "keep_original_sound": true
}
'
```

## 响应示例

```json
{
  "task_id": "<string>"
}
```

## 请求头

| 参数 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `Content-Type` | string | 是 | 固定值：`application/json` |
| `Authorization` | string | 是 | Bearer 身份验证格式，例如：`Bearer {{API 密钥}}` |

## 请求体

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- | :--- |
| `video` | string | 是 | - | 参考视频的URL |
| `images` | array | 否 | `[]` | 包含元素、场景、风格等的参考图片数组。最多7张，数组长度：0 - 7 |
| `prompt` | string | 是 | - | 正向提示词 |
| `duration` | integer | 否 | `5` | 生成媒体的持续时间（秒）。可选值：`3`, `4`, `5`, `6`, `7`, `8`, `9`, `10` |
| `aspect_ratio` | string | 否 | `"16:9"` | 生成视频的宽高比。可选值：`16:9`, `9:16`, `1:1` |
| `keep_original_sound` | boolean | 否 | `true` | 选择是否通过参数保留视频原始声音 |

## 响应参数

| 参数 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `task_id` | string | 是 | 异步任务的 task_id。您应该使用该 task_id 请求 [查询任务结果 API](/docs/models/reference-get-async-task-result) 以获取生成结果 |

[Kling-o1 图生视频](/docs/models/reference-kling-o1-i2v) [Kling-o1 文生视频](/docs/models/reference-kling-o1-t2v)