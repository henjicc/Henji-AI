---
title: "Grok Imagine Video 图生视频 - PPIO 派欧云文档中心"
url: "https://ppio.com/docs/models/reference-grok-imagine-video-i2v"
captured_at: "2026-03-19T16:26:15.625Z"
---
# Grok Imagine Video 图生视频

## 接口信息
- **方法**: POST
- **路径**: `/v3/async/grok-imagine-video-i2v`
- **描述**: 使用 xAI 的 Grok Imagine Video 模型根据图片生成视频。支持 6-10 秒时长，最高 720p 分辨率。
- **类型**: 异步 API，返回异步任务的 `task_id`，需使用该 `task_id` 请求查询任务结果 API 来检索视频生成结果。

## 请求头
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| Content-Type | string | 是 | 枚举值: `application/json` |
| Authorization | string | 是 | Bearer 身份验证格式，例如：`Bearer {{API 密钥}}` |

## 请求体
| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| image | string | 是 | - | 用于视频生成的输入图片 URL。支持公开可访问的图片 URL 或 base64 编码的 data URI（例如 `data:image/jpeg;base64,…`）。 |
| prompt | string | 是 | - | 描述要对输入图片施加的运动或变化的文本提示。支持描述场景动态、角色动作和镜头运动等详细提示词。长度限制：1 - 4096。 |
| duration | integer | 否 | 6 | 视频时长，单位为秒（6-10）。视频越长费用越高，按秒计费。取值范围：[6, 10]。 |
| resolution | string | 否 | "720p" | 输出视频分辨率。720p 画质更高，480p 生成更快。可选值：`720p`、`480p`。 |

## 响应
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| task_id | string | 是 | 异步任务的 `task_id`。您应该使用该 `task_id` 请求查询任务结果 API 以获取生成结果。 |

## 示例
### cURL
```bash
curl --request POST \
 --url https://api.ppio.com/v3/async/grok-imagine-video-i2v \
 --header 'Authorization: <authorization>' \
 --header 'Content-Type: application/json' \
 --data '
{
 "image": "<string>",
 "prompt": "<string>",
 "duration": 123,
 "resolution": "<string>"
}
'
```

### 响应示例
```json
{
 "task_id": "<string>"
}
```