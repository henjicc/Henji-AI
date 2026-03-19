---
title: "Kling v3.0 Pro 文生视频 - PPIO 派欧云文档中心"
url: "https://ppio.com/docs/models/reference-kling-v3.0-pro-t2v"
captured_at: "2026-03-19T02:33:57.455Z"
---
# Kling v3.0 Pro 文生视频

## 接口信息
- **方法**: POST
- **路径**: `/v3/async/kling-v3.0-pro-t2v`
- **描述**: Kling v3.0 Pro 文本转视频可根据文字提示生成高质量视频，具有自然运动与流畅的场景动态效果。支持 3 至 15 秒灵活时长、音视频同步生成及多镜头视频生成。
- **类型**: 异步 API，返回异步任务的 `task_id`，需使用该 `task_id` 请求查询任务结果 API 来检索视频生成结果。

## 请求头
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| Content-Type | string | 是 | 枚举值: `application/json` |
| Authorization | string | 是 | Bearer 身份验证格式，例如：`Bearer {{API 密钥}}` |

## 请求体
| 字段 | 类型 | 默认值 | 必填 | 说明 |
|------|------|--------|------|------|
| sound | boolean | `false` | 否 | 是否在生成视频时同时生成音频。 |
| prompt | string | - | 是 | 生成视频的正向提示词文本，可描述场景运动、镜头移动、动作、语音风格、氛围及音效；不可超过 2500 个字符。与 `multi_prompt` 互斥。长度限制：0 - 2500 |
| duration | integer | `5` | 否 | 生成视频的持续时间（秒）。支持 3 至 15 秒灵活时长。取值范围：[3, 15] |
| cfg_scale | number | `0.5` | 否 | 控制视频生成的灵活性。数值越高，模型生成内容对提示词的贴合度越高；数值越低，运动效果越自然。取值范围：[0, 1] |
| aspect_ratio | string | `"16:9"` | 否 | 生成视频的宽高比。可选值：`16:9`、`9:16`、`1:1` |
| multi_prompt | array | - | 否 | 多镜头视频生成的提示词列表。将视频分为多个镜头。与 `prompt` 互斥。 |
| negative_prompt | string | - | 否 | 反向提示词，指定在画面和音频中需要避免的元素；长度不超过 2500 字符。长度限制：0 - 2500 |

## 响应
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| task_id | string | 是 | 异步任务的 `task_id`。您应该使用该 `task_id` 请求查询任务结果 API 以获取生成结果。 |

## 示例
### cURL 请求
```bash
curl --request POST \
 --url https://api.ppio.com/v3/async/kling-v3.0-pro-t2v \
 --header 'Authorization: <authorization>' \
 --header 'Content-Type: application/json' \
 --data '
{
 "sound": true,
 "prompt": "<string>",
 "duration": 123,
 "cfg_scale": 123,
 "aspect_ratio": "<string>",
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