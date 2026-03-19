---
title: "Vidu Q3 Turbo 文生视频 - PPIO 派欧云文档中心"
url: "https://ppio.com/docs/models/reference-vidu-q3-turbo-t2v"
captured_at: "2026-03-19T15:49:38.788Z"
---
# Vidu Q3 Turbo 文生视频

## 接口信息
- **方法**: POST
- **路径**: `/v3/async/vidu-q3-turbo-t2v`
- **描述**: Vidu Q3 Turbo 文生视频可根据文本描述生成带同步音频的高质量视频，支持最高 1080p 分辨率和 1-16 秒时长。
- **类型**: 异步 API，返回异步任务的 `task_id`，需使用该 ID 调用查询任务结果 API 获取视频生成结果。

## 请求头
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| Content-Type | string | 是 | 枚举值: `application/json` |
| Authorization | string | 是 | Bearer 身份验证格式，例如：`Bearer {{API 密钥}}` |

## 请求体
| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| seed | integer | - | 随机种子，用于结果可复现。不传或传 0 时使用随机数。取值范围：[0, 2147483647] |
| audio | boolean | `true` | 是否使用音视频直出能力（包括台词和音效）。`false`：输出静音视频；`true`：输出声音的视频。仅 Q3 系列模型支持该参数。 |
| prompt | string | 必填 | 视频生成的文本描述，最多 5000 个字符。长度限制：0 - 5000 |
| wm_url | string | - | 水印内容图片 URL。不传时使用默认水印（内容由 AI 生成）。 |
| duration | integer | `5` | 视频时长（秒），范围 1-16，默认 5 秒。取值范围：[1, 16] |
| off_peak | boolean | `false` | 错峰模式。`true`：错峰生成视频，消耗积分更低，任务在 48 小时内生成；`false`：即时生成视频。 |
| watermark | boolean | `false` | 是否添加水印。`true`：添加水印；`false`：不添加水印。默认不加水印。 |
| resolution | string | `"720p"` | 输出视频分辨率。可选值：`540p`、`720p`、`1080p` |
| wm_position | integer | `3` | 水印位置：1=左上角, 2=右上角, 3=右下角, 4=左下角。默认 3（右下角）。取值范围：[1, 4] |
| aspect_ratio | string | `"16:9"` | 输出视频宽高比。可选值：`16:9`、`9:16`、`4:3`、`3:4`、`1:1` |

## 响应
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| task_id | string | 是 | 异步任务的 task_id。您应该使用该 task_id 请求查询任务结果 API 以获取生成结果 |

## 示例请求（cURL）
```bash
curl --request POST \
 --url https://api.ppio.com/v3/async/vidu-q3-turbo-t2v \
 --header 'Authorization: <authorization>' \
 --header 'Content-Type: <content-type>' \
 --data '
{
 "seed": 123,
 "audio": true,
 "prompt": "<string>",
 "wm_url": "<string>",
 "duration": 123,
 "off_peak": true,
 "watermark": true,
 "resolution": "<string>",
 "wm_position": 123,
 "aspect_ratio": "<string>"
}
'
```

## 示例响应
```json
{
 "task_id": "<string>"
}
```

## 相关链接
- Vidu Q3 Pro 首尾帧生成视频
- Vidu Q3 Turbo 图生视频