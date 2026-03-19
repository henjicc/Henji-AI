---
title: "VIDU Q2 参考生视频 - PPIO 派欧云文档中心"
url: "https://ppio.com/docs/models/reference-vidu-q2-reference2video"
captured_at: "2026-03-19T05:08:06.794Z"
---
# VIDU Q2 参考生视频

## 接口信息
- **路径**: `POST /v3/async/vidu-q2-reference2video`
- **描述**: VIDU Q2 参考图片转视频 API，支持多种分辨率选项。根据参考图片生成新的视频内容。
- **类型**: 异步 API，返回异步任务的 `task_id`，需使用该 ID 调用查询任务结果 API 获取视频生成结果。

## 请求头
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| Content-Type | string | 是 | 枚举值: `application/json` |
| Authorization | string | 是 | Bearer 身份验证格式，例如: `Bearer {{API 密钥}}` |

## 请求体
| 字段 | 类型 | 默认值 | 必填 | 说明 |
|------|------|--------|------|------|
| bgm | boolean | false | 否 | 是否添加背景音乐 |
| seed | integer | - | 否 | 随机种子，用于控制生成结果的随机性。相同种子会产生相似的结果。 |
| audio | boolean | false | 否 | 是否生成音频 |
| prompt | string | - | 是 | 文本提示词，可以使用 `@1`、`@2` 等占位符引用主体 |
| duration | integer | 5 | 是 | 视频时长（秒），支持 1-10 秒。可选值: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 |
| subjects | array | - | 是 | 主体列表，每个主体包含 `id`、`images` 和 `voice_id`。数组长度: 1 - 无限制 |
| watermark | boolean | false | 否 | 是否添加水印 |
| resolution | string | "720p" | 否 | 输出视频的分辨率。可选值: `540p`, `720p`, `1080p` |
| aspect_ratio | string | - | 否 | 视频宽高比，例如 `16:9`、`9:16`、`1:1` 等 |
| movement_amplitude | string | - | 否 | 运动幅度，控制视频中物体的运动强度。可选值: `auto`, `small`, `medium`, `high` |

### subjects 数组元素结构
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | 是 | 主体 ID，在 prompt 中使用 `@id` 引用 |
| images | array | 是 | 主体图片 URL 列表。数组长度: 1 - 无限制 |
| voice_id | string | "" (默认) | 否 | 语音 ID，可选 |

## 响应
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| task_id | string | 是 | 异步任务的 task_id。需使用该 ID 调用查询任务结果 API 获取生成结果 |
| provider_request_id | string | 否 | Provider request ID |

## 示例代码
### cURL
```bash
curl --request POST \
 --url https://api.ppio.com/v3/async/vidu-q2-reference2video \
 --header 'Authorization: <authorization>' \
 --header 'Content-Type: <content-type>' \
 --data '
{
 "bgm": true,
 "seed": 123,
 "audio": true,
 "prompt": "<string>",
 "duration": 123,
 "subjects": [
 {
 "id": "<string>",
 "images": [
 {}
 ],
 "voice_id": "<string>"
 }
 ],
 "watermark": true,
 "resolution": "<string>",
 "aspect_ratio": "<string>",
 "movement_amplitude": "<string>"
}
'
```

### 响应示例
```json
{
 "task_id": "<string>",
 "provider_request_id": "<string>"
}
```