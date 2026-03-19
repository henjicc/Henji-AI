---
title: "Grok Imagine Image 文生图 - PPIO 派欧云文档中心"
url: "https://ppio.com/docs/models/reference-grok-imagine-image-t2i"
captured_at: "2026-03-19T01:45:20.941Z"
---
# Grok Imagine Image 文生图

## 接口信息
- **方法**: POST
- **路径**: `/v3/async/grok-imagine-image-t2i`
- **描述**: 使用 xAI 的 Grok Imagine Image 模型根据文本提示生成图片。支持多种宽高比、输出格式，以及每次请求最多生成 4 张图片。
- **类型**: 异步 API，返回异步任务的 `task_id`，需使用该 `task_id` 请求查询任务结果 API 来检索生成结果。

## 请求头
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| Content-Type | string | 是 | 枚举值: `application/json` |
| Authorization | string | 是 | Bearer 身份验证格式，例如：`Bearer {{API 密钥}}` |

## 请求体
| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| prompt | string | 是 | - | 要生成的图片的文本描述。模型支持丰富、详细的提示词以生成高质量图片，支持多种视觉风格，包括超写实摄影、动漫、油画、铅笔素描等。长度限制：1 - 无限制 |
| aspect_ratio | string | 否 | `"1:1"` | 生成图片的宽高比。常见用途：1:1 适用于社交媒体和缩略图，16:9/9:16 适用于宽屏和手机竖屏，4:3/3:4 适用于演示文稿和肖像，3:2/2:3 适用于摄影，2:1/1:2 适用于横幅和标题图，20:9/9:20 适用于超宽屏显示。<br>可选值：`2:1`, `20:9`, `16:9`, `4:3`, `3:2`, `1:1`, `2:3`, `3:4`, `9:16`, `9:20`, `1:2` |
| output_format | string | 否 | `"jpeg"` | 输出图片格式。<br>可选值：`jpeg`, `png` |

## 响应
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| task_id | string | 是 | 异步任务的 `task_id`。您应该使用该 `task_id` 请求查询任务结果 API 以获取生成结果 |

## 示例
### cURL
```bash
curl --request POST \
 --url https://api.ppio.com/v3/async/grok-imagine-image-t2i \
 --header 'Authorization: <authorization>' \
 --header 'Content-Type: <content-type>' \
 --data '
{
 "prompt": "<string>",
 "aspect_ratio": "<string>",
 "output_format": "<string>"
}
'
```

### 响应示例 (200)
```json
{
 "task_id": "<string>"
}
```