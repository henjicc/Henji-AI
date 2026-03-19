---
title: "VIDU Q2 Turbo 智能多帧 - PPIO 派欧云文档中心"
url: "https://ppio.com/docs/models/reference-vidu-q2-turbo-multiframe"
captured_at: "2026-03-19T05:07:55.640Z"
---
# VIDU Q2 Turbo 智能多帧

## 接口信息
- **方法**: POST
- **路径**: `/v3/async/vidu-q2-turbo-multiframe`
- **描述**: VIDU Q2 Turbo 多帧图像转视频 API，Turbo 版本在生成速度和视频质量之间取得平衡。通过多张关键帧图像快速生成连贯视频内容。
- **类型**: 异步 API，返回异步任务的 `task_id`，需使用该 `task_id` 请求查询任务结果 API 来检索视频生成结果。

## 请求头
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| Content-Type | string | 是 | 枚举值: `application/json` |
| Authorization | string | 是 | Bearer 身份验证格式，例如：`Bearer {{API 密钥}}` |

## 请求体
| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| wm_url | string | 否 | - | 水印图片URL。启用水印但不传自定义水印URL时，使用默认水印。不添加水印则该参数无效。 |
| payload | string | 否 | - | 透传参数。不做任何处理，仅数据传输。最多 1048576 个字符。 |
| meta_data | string | 否 | - | 元数据标识，JSON格式字符串。透传字段。 |
| watermark | boolean | 否 | `false` | 是否添加水印。`true`：添加水印；`false`：不添加水印。默认不添加。 |
| resolution | string | 否 | `"720p"` | 视频分辨率。可选值：`540p`、`720p`、`1080p`。 |
| start_image | string | 是 | - | 首帧图像。支持传入图片 Base64 编码或图片URL。只支持输入 1 张图。支持 png、jpeg、jpg、webp 格式。图片比例需要小于 1:4 或者 4:1。图片大小不超过 50 MB。 |
| wm_position | string | 否 | `"bottom_left"` | 水印位置。默认为左下。不添加水印则该参数无效。可选值：`top_left`、`top_right`、`bottom_right`、`bottom_left`。 |
| image_settings | array | 是 | - | 关键帧配置数组，每个任务最少 2 个关键帧，最多 9 个关键帧。数组长度：2 - 9。 |

### image_settings 子字段
| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| prompt | string | 否 | - | 上一张图像继续延长的提示词，用来控制延长的视频内容。 |
| duration | integer | 否 | `5` | 多帧时长。不同关键帧之间的视频时长。默认 5s，可选项为 2～7s。取值范围：[2, 7]。 |
| key_image | string | 是 | - | 中间帧的参考图像。模型将此参数中的图片作为尾帧生成视频。支持传入图片 Base64 编码或图片URL。只支持输入 1 张图。输入顺序即为时间轴顺序（从首帧到尾帧）。支持 png、jpeg、jpg、webp 格式。图片比例需要小于 1:4 或者 4:1。图片大小不超过 50 MB。 |

## 响应
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| task_id | string | 是 | 异步任务的 task_id。您应该使用该 task_id 请求 查询任务结果 API 以获取生成结果。 |
| provider_request_id | string | 否 | Provider request ID (optional)。 |

## 示例
### cURL 请求
```bash
curl --request POST \
 --url https://api.ppio.com/v3/async/vidu-q2-turbo-multiframe \
 --header 'Authorization: <authorization>' \
 --header 'Content-Type: <content-type>' \
 --data '
{
 "wm_url": "<string>",
 "payload": "<string>",
 "meta_data": "<string>",
 "watermark": true,
 "resolution": "<string>",
 "start_image": "<string>",
 "wm_position": "<string>",
 "image_settings": [
 {
 "prompt": "<string>",
 "duration": 123,
 "key_image": "<string>"
 }
 ]
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