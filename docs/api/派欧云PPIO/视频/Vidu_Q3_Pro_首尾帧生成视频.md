---
title: "Vidu Q3 Pro 首尾帧生成视频 - PPIO 派欧云文档中心"
url: "https://ppio.com/docs/models/reference-vidu-q3-pro-f2v"
captured_at: "2026-03-19T15:49:35.536Z"
---
# Vidu Q3 Pro 首尾帧生成视频

## 描述
Vidu Q3 Pro 首尾帧生成视频可根据首帧和尾帧图片生成高质量视频，通过文本引导运动插值，支持最高 1080p 分辨率。

这是一个异步 API，只会返回异步任务的 task_id。您应该使用该 task_id 请求查询任务结果 API 来检索视频生成结果。

## 请求

### 请求头
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| Content-Type | string | 是 | 枚举值: `application/json` |
| Authorization | string | 是 | Bearer 身份验证格式，例如：`Bearer {{API 密钥}}` |

### 请求体
| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| seed | integer | 否 | - | 随机种子，用于结果可复现。传 0 表示随机。 |
| audio | boolean | 否 | true | 是否在生成视频时同时生成音频。 |
| images | array | 是 | - | 两张图片 URL 或 Base64 编码图片。第一张为首帧图，第二张为尾帧图。支持 png、jpeg、jpg、webp 格式，单张不超过 50MB，像素不小于 128x128，宽高比需小于 1:4 或大于 4:1。首尾帧两张图的分辨率需相近（首帧/尾帧比例在 0.8-1.25 之间）。数组长度：2 - 2 |
| is_rec | boolean | 否 | - | 是否启用推荐模式。 |
| prompt | string | 否 | - | 描述首尾帧之间期望的视频运动效果的文本。长度限制：0 - 1500 |
| wm_url | string | 否 | - | 自定义水印图片 URL。 |
| duration | integer | 否 | 5 | 生成视频的时长（秒），范围 1-16。取值范围：[1, 16] |
| off_peak | boolean | 否 | false | 是否使用错峰模式，费用更低。 |
| watermark | boolean | 否 | - | 是否添加水印。 |
| resolution | string | 否 | "720p" | 生成视频的分辨率。可选值：540p, 720p, 1080p |
| wm_position | integer | 否 | 3 | 水印位置：1=左上角，2=右上角，3=右下角，4=左下角。取值范围：[1, 4] |

## 响应
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| task_id | string | 是 | 异步任务的 task_id。您应该使用该 task_id 请求查询任务结果 API 以获取生成结果 |

## 示例

### cURL
```bash
curl --request POST \
 --url https://api.ppio.com/v3/async/vidu-q3-pro-f2v \
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
 "wm_url": "<string>",
 "duration": 123,
 "off_peak": true,
 "watermark": true,
 "resolution": "<string>",
 "wm_position": 123
}
'
```

### 响应示例
```json
{
 "task_id": "<string>"
}
```

## 相关链接
- Vidu Q3 Pro 图生视频
- Vidu Q3 Turbo 文生视频