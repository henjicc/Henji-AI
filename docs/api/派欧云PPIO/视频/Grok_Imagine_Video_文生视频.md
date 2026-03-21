---
title: "Grok Imagine Video 文生视频 - PPIO 派欧云文档中心"
url: "https://ppio.com/docs/models/reference-grok-imagine-video-t2v"
captured_at: "2026-03-19T16:26:18.190Z"
---
# Grok Imagine Video 文生视频

## 接口信息
- **方法**: POST
- **路径**: `/v3/async/grok-imagine-video-t2v`
- **类型**: 异步 API

## 描述
使用 xAI 的 Grok Imagine Video 模型根据文本提示生成视频。支持 6 秒或 10 秒时长、多种宽高比，以及最高 720p 分辨率。

这是一个异步 API，只会返回异步任务的 `task_id`。您应该使用该 `task_id` 请求 **查询任务结果 API** 来检索视频生成结果。

## 请求头
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `Content-Type` | string | 是 | 枚举值: `application/json` |
| `Authorization` | string | 是 | Bearer 身份验证格式，例如：`Bearer {{API 密钥}}` |

## 请求体
| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `prompt` | string | 是 | - | 要生成的视频的文本描述。支持丰富、详细的提示词以生成高质量视频，涵盖电影场景、自然风光、角色动画等多种风格。长度限制：1 - 4096 |
| `duration` | integer | 否 | 6 | 视频时长，单位为秒（6-10）。视频越长费用越高，按秒计费。取值范围：[6, 10] |
| `resolution` | string | 否 | `"720p"` | 输出视频分辨率。720p 画质更高，480p 生成更快。可选值：`720p`, `480p` |
| `aspect_ratio` | string | 否 | `"16:9"` | 生成视频的宽高比。16:9 适用于宽屏，9:16 适用于手机竖屏，1:1 适用于社交媒体。可选值：`16:9`, `1:1`, `9:16` |

## 响应
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `task_id` | string | 是 | 异步任务的 `task_id`。您应该使用该 `task_id` 请求 **查询任务结果 API** 以获取生成结果 |

## 示例
### cURL
```bash
curl --request POST \
 --url https://api.ppio.com/v3/async/grok-imagine-video-t2v \
 --header 'Authorization: <authorization>' \
 --header 'Content-Type: <content-type>' \
 --data '
{
 "prompt": "<string>",
 "duration": 123,
 "resolution": "<string>",
 "aspect_ratio": "<string>"
}
'
```

### 响应示例 (200)
```json
{
 "task_id": "<string>"
}
```

## 相关接口
- Grok Imagine Video 图生视频
- Grok Imagine Video 视频编辑
- 查询任务结果 API