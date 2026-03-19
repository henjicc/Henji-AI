---
title: "Grok Imagine Image 图片编辑 - PPIO 派欧云文档中心"
url: "https://ppio.com/docs/models/reference-grok-imagine-image-edit"
captured_at: "2026-03-19T01:45:17.441Z"
---
# Grok Imagine Image 图片编辑

## 接口信息

- **方法**: POST
- **路径**: `/v3/async/grok-imagine-image-edit`
- **描述**: 使用 xAI 的 Grok Imagine Image 模型通过文本指令编辑图片。提供源图片和描述所需编辑的文本提示，模型能理解图片内容并应用所请求的修改，支持多轮编辑和风格迁移。
- **类型**: 异步 API，只会返回异步任务的 `task_id`。您应该使用该 `task_id` 请求 **查询任务结果 API** 来检索视频生成结果。

## 请求头

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| Content-Type | string | 是 | 枚举值: `application/json` |
| Authorization | string | 是 | Bearer 身份验证格式，例如：`Bearer {{API 密钥}}` |

## 请求体

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| image | string | 是 | 要编辑的源图片，以公开 URL 或 base64 数据 URI（例如 `data:image/jpeg;base64,...`）提供。模型会分析图片内容并应用所请求的编辑。 |
| prompt | string | 是 | 描述对源图片所需编辑的文本指令。模型能理解图片内容并进行修改，包括风格迁移、物体修改、场景更改以及迭代优化。长度限制：1 - 无限制 |

## 响应

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| task_id | string | 是 | 异步任务的 `task_id`。您应该使用该 `task_id` 请求 **查询任务结果 API** 以获取生成结果 |

## 示例

### cURL 请求

```bash
curl --request POST \
 --url https://api.ppio.com/v3/async/grok-imagine-image-edit \
 --header 'Authorization: <authorization>' \
 --header 'Content-Type: <content-type>' \
 --data '
{
 "image": "<string>",
 "prompt": "<string>"
}
'
```

### 响应示例

```json
{
 "task_id": "<string>"
}
```