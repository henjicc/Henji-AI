---
title: "Kling v3.0 Pro 图生视频 - PPIO 派欧云文档中心"
url: "https://ppio.com/docs/models/reference-kling-v3.0-pro-i2v"
captured_at: "2026-03-19T02:33:53.785Z"
---
# Kling v3.0 Pro 图生视频

## 接口信息

- **方法**: POST
- **路径**: `/v3/async/kling-v3.0-pro-i2v`
- **类型**: 异步 API

## 描述

Kling v3.0 Pro 图像转视频工具可将静态图像转换为动态视频，在保持主体一致性的同时，生成自然运动与更流畅的场景动态效果。支持 3 至 15 秒灵活时长、音视频同步生成、尾帧控制及多镜头视频生成。

这是一个异步 API，只会返回异步任务的 `task_id`。您应该使用该 `task_id` 请求 **查询任务结果 API** 来检索视频生成结果。

## 请求头

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `Content-Type` | string | 是 | 枚举值: `application/json` |
| `Authorization` | string | 是 | Bearer 身份验证格式，例如：`Bearer {{API 密钥}}` |

## 请求体

| 字段 | 类型 | 必填/默认 | 说明 |
|------|------|------------|------|
| `image` | string | 必填 | 视频首帧图片；支持 `.jpg`、`.jpeg`、`.png`。图片文件大小不得超过 10MB；宽高均需 >= 300px；宽高比需在 1:2.5 与 2.5:1 之间。 |
| `sound` | boolean | 默认值: `false` | 是否在生成视频时同时生成音频。 |
| `prompt` | string | 必填 | 生成视频的正向提示词文本，可描述场景运动、镜头移动、动作、语音风格、氛围及音效；不可超过 2500 个字符。 |
| `duration` | integer | 默认值: `5` | 生成视频的持续时间（秒）。支持 3 至 15 秒灵活时长。取值范围：`[3, 15]` |
| `cfg_scale` | number | 默认值: `0.5` | 控制视频生成的灵活性。数值越高，模型生成内容对提示词的贴合度越高；数值越低，运动效果越自然。取值范围：`[0, 1]` |
| `end_image` | string | 可选 | 尾帧图片 URL，用于引导过渡效果。与 `multi_prompt` 不兼容。支持 `.jpg`、`.jpeg`、`.png`。 |
| `multi_prompt` | array | 可选 | 多镜头视频生成的提示词列表。将视频分为多个镜头。与 `prompt` 互斥。 |
| `negative_prompt` | string | 可选 | 反向提示词，指定在画面和音频中需要避免的元素；长度不超过 2500 字符。 |

## 响应

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `task_id` | string | 是 | 异步任务的 `task_id`。您应该使用该 `task_id` 请求 **查询任务结果 API** 以获取生成结果。 |

## 示例

### cURL 请求

```bash
curl --request POST \
  --url https://api.ppio.com/v3/async/kling-v3.0-pro-i2v \
  --header 'Authorization: <authorization>' \
  --header 'Content-Type: application/json' \
  --data '
{
  "image": "<string>",
  "sound": true,
  "prompt": "<string>",
  "duration": 123,
  "cfg_scale": 123,
  "end_image": "<string>",
  "multi_prompt": [
    {}
  ],
  "negative_prompt": "<string>"
}
'
```

### 响应示例

```json
{
  "task_id": "<string>"
}
```

## 相关接口

- Kling v3.0 Standard 文字生成视频
- Kling v3.0 Pro 文生视频