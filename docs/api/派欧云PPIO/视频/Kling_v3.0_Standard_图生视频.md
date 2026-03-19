---
title: "Kling v3.0 Standard 图生视频 - PPIO 派欧云文档中心"
url: "https://ppio.com/docs/models/reference-kling-v3.0-std-i2v"
captured_at: "2026-03-19T02:33:46.707Z"
---
# Kling v3.0 Standard 图生视频

## 接口信息
- **方法**: POST
- **路径**: `/v3/async/kling-v3.0-std-i2v`
- **描述**: Kling v3.0 Standard 图像转视频工具可将静态图像转换为动态视频，在保持主体一致性的同时，生成自然运动与流畅的场景动态效果，支持音频同步生成和多段提示词组合。
- **类型**: 异步 API，返回异步任务的 `task_id`，需使用该 `task_id` 请求查询任务结果 API 来检索视频生成结果。

## 请求头
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| Content-Type | string | 是 | 枚举值: `application/json` |
| Authorization | string | 是 | Bearer 身份验证格式，例如：`Bearer {{API 密钥}}` |

## 请求体
| 字段 | 类型 | 必填/默认 | 说明 |
|------|------|-----------|------|
| image | string | 是 | 视频首帧图片；支持 `.jpg`、`.jpeg`、`.png`。图片文件大小不得超过 10MB；宽高均需 ≥ 300px；宽高比需在 1:2.5 与 2.5:1 之间。 |
| sound | boolean | 默认: `false` | 是否在生成视频时同时生成音频。 |
| prompt | string | 是 | 生成视频的正向提示词文本，描述场景运动、镜头移动、动作、声音风格、氛围和音效；不可超过 2500 个字符。 |
| duration | integer | 默认: `5` | 生成视频的持续时间（秒），范围 3-15。可选值：3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15。 |
| cfg_scale | number | 默认: `0.5` | 控制视频生成的灵活性。数值越低运动越自然；数值越高，生成内容对提示词的贴合度越高。取值范围：[0, 1]。 |
| end_image | string | 可选 | 尾帧图片 URL，用于引导起始帧与结束帧之间的过渡。格式约束与 `image` 相同。不可与 `multi_prompt` 同时使用。 |
| multi_prompt | array | 可选 | 多段提示词数组，用于多镜头视频组合。每项包含一个提示词和该段的时长。不可与 `end_image` 同时使用。 |
| negative_prompt | string | 可选 | 反向提示词，指定要在画面和音频中避免的元素；长度不超过 2500 字符。 |

### `multi_prompt` 子字段
| 字段 | 类型 | 必填/默认 | 说明 |
|------|------|-----------|------|
| prompt | string | 是 | 该视频段落的运动描述。 |
| duration | integer | 默认: `5` | 该段落的持续时间（秒），范围 3-15。取值范围：[3, 15]。 |

## 响应
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| task_id | string | 是 | 异步任务的 `task_id`。需使用该 `task_id` 请求查询任务结果 API 以获取生成结果。 |

## 示例请求
```bash
curl --request POST \
  --url https://api.ppio.com/v3/async/kling-v3.0-std-i2v \
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
    {
      "prompt": "<string>",
      "duration": 123
    }
  ],
  "negative_prompt": "<string>"
}
'
```

## 示例响应
```json
{
  "task_id": "<string>"
}
```