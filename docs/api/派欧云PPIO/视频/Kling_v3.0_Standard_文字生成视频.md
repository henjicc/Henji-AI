---
title: "Kling v3.0 Standard 文字生成视频 - PPIO 派欧云文档中心"
url: "https://ppio.com/docs/models/reference-kling-v3.0-std-t2v"
captured_at: "2026-03-19T02:33:49.728Z"
---
# Kling v3.0 Standard 文字生成视频

## 接口信息

- **方法**: POST
- **路径**: `/v3/async/kling-v3.0-std-t2v`
- **类型**: 异步 API

## 描述

Kling v3.0 Standard 文字生成视频可根据文本提示生成高质量视频，具备流畅的运动效果、电影级画面、精准的提示词遵循能力，并支持可选的原生音频共同生成。支持 3-15 秒时长和多种画面比例。

这是一个异步 API，只会返回异步任务的 `task_id`。您应该使用该 `task_id` 请求 **查询任务结果 API** 来检索视频生成结果。

## 请求头

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| Content-Type | string | 是 | 枚举值: `application/json` |
| Authorization | string | 是 | Bearer 身份验证格式，例如：`Bearer {{API 密钥}}` |

## 请求体

| 字段 | 类型 | 默认值 | 必填 | 说明 |
|------|------|--------|------|------|
| sound | boolean | `false` | 否 | 是否在生成视频时同时生成音频。支持中文和英文语音输出。 |
| prompt | string | - | 是 | 生成视频的正向提示词文本；不可超过 2500 个字符。长度限制：0 - 2500 |
| duration | integer | `5` | 否 | 生成视频的持续时间（秒）。可选值：3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15 |
| cfg_scale | number | `0.5` | 否 | 控制视频生成的灵活性。设为 0 可获得最大创意自由，0.5（默认）为平衡效果，设为 1 则严格遵循提示词。取值范围：[0, 1] |
| aspect_ratio | string | `"16:9"` | 否 | 生成视频的宽高比。可选值：`16:9`, `9:16`, `1:1` |
| negative_prompt | string | - | 否 | 反向提示词，描述需要在生成视频中避免的元素；长度不超过 2500 字符。长度限制：0 - 2500 |

## 响应

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| task_id | string | 是 | 异步任务的 `task_id`。您应该使用该 `task_id` 请求 **查询任务结果 API** 以获取生成结果 |

## 示例

### cURL 请求

```bash
curl --request POST \
 --url https://api.ppio.com/v3/async/kling-v3.0-std-t2v \
 --header 'Authorization: <authorization>' \
 --header 'Content-Type: <content-type>' \
 --data '
{
 "sound": true,
 "prompt": "<string>",
 "duration": 123,
 "cfg_scale": 123,
 "aspect_ratio": "<string>",
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

## 相关链接

- Kling v3.0 Standard 图生视频
- Kling v3.0 Pro 图生视频