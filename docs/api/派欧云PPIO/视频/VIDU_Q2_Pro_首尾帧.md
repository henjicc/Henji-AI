---
title: "VIDU Q2 Pro 首尾帧 - PPIO 派欧云文档中心"
url: "https://ppio.com/docs/models/reference-vidu-q2-pro-startend2video"
captured_at: "2026-03-19T05:08:10.971Z"
---
# VIDU Q2 Pro 首尾帧

## 接口信息
- **方法**: POST
- **路径**: `/v3/async/vidu-q2-pro-startend2video`
- **描述**: VIDU Q2 Pro 支尾帧转视频 API，支持多种分辨率选项。根据首尾两帧图像生成连贯的视频内容。
- **类型**: 异步 API，返回异步任务的 `task_id`，需使用该 ID 查询任务结果。

## 请求头
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| Content-Type | string | 是 | 枚举值: `application/json` |
| Authorization | string | 是 | Bearer 身份验证格式，例如：`Bearer {{API 密钥}}` |

## 请求体
| 字段 | 类型 | 默认值 | 必填 | 说明 |
|------|------|--------|------|------|
| bgm | boolean | false | 否 | 是否为生成的视频添加背景音乐。`true`: 系统自动挑选音乐；`false`: 不添加。BGM 时长自动适配视频。 |
| seed | integer | - | 否 | 随机种子。默认或传 0 时使用随机数；手动设置则使用指定种子。 |
| images | array | - | 是 | 图像数组，第一张为首帧，第二张为尾帧。支持输入两张图。注：<br>1. 首尾帧分辨率需相近，比例在 0.8～1.25 之间；<br>2. 支持 Base64 编码或图片 URL（确保可访问）；<br>3. 支持格式：png、jpeg、jpg、webp；<br>4. 图片大小不超过 50M；<br>5. Base64 编码需包含内容类型字符串，如 `data:image/png;base64,`；<br>数组长度：2 - 2 |
| is_rec | boolean | false | 否 | 是否使用推荐提示词。`true`: 系统自动推荐提示词（每任务多消耗 10 积分）；`false`: 根据输入的 `prompt` 生成视频。 |
| prompt | string | - | 否 | 文本提示词，生成视频的文本描述。注：字符长度不超过 2000；若 `is_rec=true`，此参数无效。长度限制：0 - 2000 |
| wm_url | string | - | 否 | 水印内容（图片 URL）。不传时使用默认水印：“内容由AI生成”。 |
| payload | string | - | 否 | 透传参数，不做处理，仅数据传输。最多 1048576 个字符。长度限制：0 - 1048576 |
| duration | integer | 5 | 否 | 视频时长（秒），支持 1-8 秒。可选值：1, 2, 3, 4, 5, 6, 7, 8 |
| off_peak | boolean | false | 否 | 错峰模式。`true`: 错峰生成（消耗积分更低，48 小时内生成）；`false`: 即时生成。错峰任务未完成会自动取消并返还积分。 |
| meta_data | string | - | 否 | 元数据标识，JSON 格式字符串，透传字段。为空时使用默认生成的元数据。 |
| watermark | boolean | false | 否 | 是否添加水印。默认不加。可通过 `watermarked_url` 参数查询带水印的视频。 |
| resolution | string | "720p" | 否 | 输出视频分辨率。默认值：720p。可选值：540p, 720p, 1080p |
| wm_position | integer | 3 | 否 | 水印位置。1: 左上角；2: 右上角；3: 右下角（默认）；4: 左下角。可选值：1, 2, 3, 4 |
| movement_amplitude | string | "auto" | 否 | 运动幅度，控制视频中物体的运动强度。可选值：auto, small, medium, large |

## 响应
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| task_id | string | 是 | 异步任务的 ID，用于查询任务结果。 |
| provider_request_id | string | 否 | Provider request ID（可选）。 |

## 示例请求（cURL）
```bash
curl --request POST \
 --url https://api.ppio.com/v3/async/vidu-q2-pro-startend2video \
 --header 'Authorization: <authorization>' \
 --header 'Content-Type: application/json' \
 --data '
{
 "bgm": true,
 "seed": 123,
 "images": [
   {}
 ],
 "is_rec": true,
 "prompt": "<string>",
 "wm_url": "<string>",
 "payload": "<string>",
 "duration": 123,
 "off_peak": true,
 "meta_data": "<string>",
 "watermark": true,
 "resolution": "<string>",
 "wm_position": 123,
 "movement_amplitude": "<string>"
}
'
```

## 示例响应
```json
{
 "task_id": "<string>",
 "provider_request_id": "<string>"
}
```

## 说明
- 这是一个异步 API，仅返回 `task_id`。需使用该 ID 调用“查询任务结果 API”获取视频生成结果。
- 技术支持：本文档由 Mintlify 构建和托管。