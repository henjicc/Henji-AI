# Wan 2.5 Preview 图生视频

Wan 2.5 Preview 图生视频模型支持根据首帧图片和文本生成 5 秒或 10 秒的视频。新增音频能力：支持自动配音，也可自定义音频文件。

本接口支持个人认证及企业认证用户调用。请参见 [实名认证](/docs/support/identity-verification)，完成个人用户认证或企业用户认证，以确保可以正常使用本功能。

这是一个**异步**API，只会返回异步任务的 `task_id`。您应该使用该 `task_id` 请求 [查询任务结果 API](/docs/models/reference-get-async-task-result) 来检索视频生成结果。

## 请求

**端点**
```
POST https://api.ppinfra.com/v3/async/wan-2.5-i2v-preview
```

**cURL 示例**
```bash
curl --request POST \
  --url https://api.ppinfra.com/v3/async/wan-2.5-i2v-preview \
  --header 'Authorization: <authorization>' \
  --header 'Content-Type: application/json' \
  --data '
{
  "input": {
    "prompt": "<string>",
    "negative_prompt": "<string>",
    "img_url": "<string>",
    "audio_url": "<string>"
  },
  "parameters": {
    "resolution": "<string>",
    "duration": 123,
    "prompt_extend": true,
    "watermark": true,
    "audio": true,
    "seed": 123
  }
}
'
```

## 请求头

| 参数 | 类型 | 是否必需 | 说明 |
| :--- | :--- | :--- | :--- |
| `Authorization` | string | 是 | Bearer 身份验证格式，例如：`Bearer {{API 密钥}}`。 |
| `Content-Type` | string | 是 | 必须为 `application/json`。 |

## 请求体

### `input` (object, required)
基础输入信息。

| 字段 | 类型 | 是否必需 | 说明 |
| :--- | :--- | :--- | :--- |
| `prompt` | string | 否 | 文本正向提示词。支持中英文，最长 2000 个字符，超出部分自动截断。<br>示例值：`一只小猫在草地上奔跑`。 |
| `negative_prompt` | string | 否 | 反向提示词，用于描述生成视频时需要避开的内容，可对画面进行规避或限制。支持中英文，最长500字符，超出部分自动截断。<br>示例值：`低分辨率、错误、最差质量、低质量、残缺、多余的手指、比例不良等`。 |
| `img_url` | string | 是 | 用于视频生成的起始帧图片的URL。要求URL可公开访问，并支持HTTP或HTTPS协议。<br>**图片要求**：<br>- 格式：JPEG、JPG、PNG（不支持透明）、BMP、WEBP。<br>- 尺寸：宽高需在 `[360, 2000]` 像素范围内。<br>- 大小：不得超过 10MB。 |
| `audio_url` | string | 否 | 用于视频生成的音频文件URL。<br>**音频要求**：<br>- 格式：wav、mp3。<br>- 时长：3-30秒。<br>- 大小：不超过 15MB。<br>**超长处理**：若音频时长超过目标视频时长（如5秒或10秒），仅保留前5秒或前10秒，其余部分自动舍弃；若音频时长短于视频时长，超出部分为无声视频。例如音频为3秒，视频为5秒，则输出视频前3秒有声音，后2秒为静音。 |

### `parameters` (object, required)
视频处理参数。

| 字段 | 类型 | 是否必需 | 说明 |
| :--- | :--- | :--- | :--- |
| `resolution` | string | 否 | 生成视频的分辨率档位。<br>可选值：`480P`、`720P`、`1080P`。<br>默认值：`1080P`。 |
| `duration` | integer | 否 | 指定生成视频的时长，支持值：`5` 或 `10`（单位：秒）。<br>默认值：`5`。 |
| `prompt_extend` | bool | 否 | 是否开启prompt智能改写。开启后，将使用大模型对输入prompt进行智能改写，对较短提示词可显著提升生成效果，但处理时长也会增加。<br>- `true`：默认，开启智能改写。<br>- `false`：不改写。<br>示例值：`true`。 |
| `watermark` | bool | 否 | 是否添加水印标识，水印位于图片右下角，文案为”AI 生成”。<br>- `false`：默认值，不添加水印。<br>- `true`：添加水印。 |
| `audio` | boolean | 否 | 是否添加音频。参数优先级：`audio_url` > `audio`，仅当 `audio_url` 为空时有效。<br>- `true`：默认，自动为视频添加配音。<br>- `false`：不添加音频，输出为静音视频。<br>示例值：`true`。 |
| `seed` | integer | 否 | 随机种子，用于控制模型生成内容的随机性，取值范围：`[0, 2147483647]`。不填写时将自动生成随机数。若期望生成结果较为稳定，可传入相同seed值。<br>示例值：`12345`。 |

## 返回结果

**响应示例**
```json
{
  "task_id": "<string>"
}
```

| 字段 | 类型 | 是否必需 | 说明 |
| :--- | :--- | :--- | :--- |
| `task_id` | string | 是 | 异步任务的 `task_id`。您应该使用该 `task_id` 请求 [查询任务结果 API](/docs/models/reference-get-async-task-result) 以获取生成结果。 |