---
title: "Grok Imagine Video 视频编辑 - PPIO 派欧云文档中心"
url: "https://ppio.com/docs/models/reference-grok-imagine-video-edit"
captured_at: "2026-03-19T16:26:20.621Z"
---
# Grok Imagine Video 视频编辑

## 接口信息
- **方法**: POST
- **路径**: `/v3/async/grok-imagine-video-edit`
- **类型**: 异步 API

## 描述
使用 xAI 的 Grok Imagine Video 模型通过文本指令编辑视频。支持对已有视频进行风格变换和内容编辑。输入视频上限为 8 秒，最大分辨率 854x480 像素，输出保留原始视频时长，最高支持 720p。

这是一个异步 API，只会返回异步任务的 `task_id`。您应该使用该 `task_id` 请求 **查询任务结果 API** 来检索视频生成结果。

## 请求头
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| Content-Type | string | 是 | 枚举值: `application/json` |
| Authorization | string | 是 | Bearer 身份验证格式，例如：`Bearer {{API 密钥}}` |

## 请求体
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| video | string | 是 | 要编辑的输入视频 URL。视频将被缩放至最大 854x480 像素，并截断至 8 秒。输入时长上限为 8.7 秒，输出保留原始视频的时长。必须为可公开访问的 URL。 |
| prompt | string | 是 | 期望的编辑效果的文本描述。描述要应用到输入视频的风格变换或内容更改，例如「将视频改为动漫风格」或「使其看起来像水彩画」。长度限制：1 - 4096 |
| resolution | string | 否 | 默认值: `"480p"`。输出视频分辨率。480p 生成更快，720p 画质更高。输出分辨率匹配输入分辨率，最高不超过所选值。可选值：`480p` , `720p` |

## 响应
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| task_id | string | 是 | 异步任务的 task_id。您应该使用该 task_id 请求 **查询任务结果 API** 以获取生成结果 |

## 示例
### cURL
```bash
curl --request POST \
 --url https://api.ppio.com/v3/async/grok-imagine-video-edit \
 --header 'Authorization: <authorization>' \
 --header 'Content-Type: <content-type>' \
 --data '
{
 "video": "<string>",
 "prompt": "<string>",
 "resolution": "<string>"
}
'
```

### 响应示例 (200)
```json
{
 "task_id": "<string>"
}
```