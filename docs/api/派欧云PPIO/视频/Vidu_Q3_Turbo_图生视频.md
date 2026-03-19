---
title: "Vidu Q3 Turbo 图生视频 - PPIO 派欧云文档中心"
url: "https://ppio.com/docs/models/reference-vidu-q3-turbo-i2v"
captured_at: "2026-03-19T15:49:42.113Z"
---
# Vidu Q3 Turbo 图生视频

## 接口信息
- **方法**: POST
- **路径**: `/v3/async/vidu-q3-turbo-i2v`
- **类型**: 异步 API

## 描述
Vidu Q3 Turbo 图像转视频工具，可将静态图像转换为动态视频，支持文本引导运动生成，提供多种分辨率和宽高比选择。

这是一个异步 API，只会返回异步任务的 `task_id`。您应该使用该 `task_id` 请求 **查询任务结果 API** 来检索视频生成结果。

## 请求头
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| Content-Type | string | 是 | 枚举值: `application/json` |
| Authorization | string | 是 | Bearer 身份验证格式，例如：`Bearer {{API 密钥}}` |

## 请求体
| 字段 | 类型 | 必填/默认 | 说明 |
|------|------|-----------|------|
| seed | integer | 可选 | 随机种子，用于可重复生成；0 或不传则随机生成。取值范围：`[0, 2147483647]` |
| audio | boolean | 默认: `true` | 是否使用音视频直出能力。设为 `true` 时，输出带台词以及背景音的视频。Q3 模型默认为 `true`。 |
| images | array | 是 | 参考图片 URL 数组；支持 `.jpg`、`.jpeg`、`.png`、`.webp`。每张图片大小不超过 50MB；宽高比需在 1:4 与 4:1 之间。 |
| is_rec | boolean | 默认: `false` | 启用音画匹配；设为 `true` 时，音频节奏与视频动态同步。 |
| prompt | string | 可选 | 视频生成的运动描述；描述场景运动、动作和动态效果。长度限制：0 - 5000 |
| duration | integer | 默认: `5` | 视频时长（秒）。取值范围：`[1, 16]` |
| off_peak | boolean | 默认: `false` | 使用非高峰时段定价；设为 `true` 时，任务排队等待非高峰时段处理以降低成本。 |
| audio_type | string | 默认: `"all"` | 音频类型，`audio` 为 `true` 时生效。`all` = 音效+人声，`speech_only` = 仅人声，`sound_effect_only` = 仅音效。可选值：`all`、`speech_only`、`sound_effect_only` |
| resolution | string | 默认: `"720p"` | 输出视频分辨率。可选值：`540p`、`720p`、`1080p` |

## 响应
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| task_id | string | 是 | 异步任务的 `task_id`。您应该使用该 `task_id` 请求 **查询任务结果 API** 以获取生成结果 |

## 示例请求
```bash
curl --request POST \
 --url https://api.ppio.com/v3/async/vidu-q3-turbo-i2v \
 --header 'Authorization: <authorization>' \
 --header 'Content-Type: <content-type>' \
 --data '
{
 "seed": 123,
 "audio": true,
 "images": [
 {}
 ],
 "is_rec": true,
 "prompt": "<string>",
 "duration": 123,
 "off_peak": true,
 "audio_type": "<string>",
 "resolution": "<string>"
}
'
```

## 示例响应
```json
{
 "task_id": "<string>"
}
```