---
title: "VIDU Q2 Turbo 图生视频 - PPIO 派欧云文档中心"
url: "https://ppio.com/docs/models/reference-vidu-q2-turbo-img2video"
captured_at: "2026-03-19T05:07:59.042Z"
---
# VIDU Q2 Turbo 图生视频

## 接口信息
- **方法**: POST
- **路径**: `/v3/async/vidu-q2-turbo-img2video`
- **类型**: 异步 API

## 描述
VIDU Q2 Turbo 图像转视频 API，支持多种分辨率选项。根据参考图像生成新的视频内容，Turbo 版本在速度和性能之间取得平衡。

这是一个异步 API，只会返回异步任务的 `task_id`。您应该使用该 `task_id` 请求 **查询任务结果 API** 来检索视频生成结果。

## 请求头
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| Content-Type | string | 是 | 枚举值: `application/json` |
| Authorization | string | 是 | Bearer 身份验证格式，例如：`Bearer {{API 密钥}}` |

## 请求体
| 字段 | 类型 | 默认值 | 必填 | 说明 |
|------|------|--------|------|------|
| bgm | boolean | `false` | 否 | 是否添加背景音乐 |
| seed | integer | - | 否 | 随机种子，用于控制生成结果的随机性。相同种子会产生相似的结果。 |
| audio | boolean | `false` | 否 | 是否生成音频 |
| images | array | - | 是 | 输入图片 URL 列表，数组长度：1 - 无限制 |
| prompt | string | - | 是 | 文本提示词，详细描述期望生成的视频内容 |
| duration | integer | `5` | 是 | 视频时长（秒），支持 1-10 秒。可选值：1, 2, 3, 4, 5, 6, 7, 8, 9, 10 |
| off_peak | boolean | `false` | 否 | 是否开启离峰任务模式 |
| voice_id | string | - | 否 | 语音 ID，可选 |
| watermark | boolean | `false` | 否 | 是否添加水印 |
| resolution | string | `"720p"` | 否 | 输出视频的分辨率。默认值为 720p。可选值：540p, 720p, 1080p |
| movement_amplitude | string | `"auto"` | 否 | 运动幅度，控制视频中物体的运动强度。可选值：auto, small, medium, high |

## 响应
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| task_id | string | 是 | 异步任务的 task_id。您应该使用该 task_id 请求 **查询任务结果 API** 以获取生成结果 |
| provider_request_id | string | 否 | Provider request ID |

## 示例

### cURL 请求
```bash
curl --request POST \
 --url https://api.ppio.com/v3/async/vidu-q2-turbo-img2video \
 --header 'Authorization: <authorization>' \
 --header 'Content-Type: <content-type>' \
 --data '
{
 "bgm": true,
 "seed": 123,
 "audio": true,
 "images": [
 {}
 ],
 "prompt": "<string>",
 "duration": 123,
 "off_peak": true,
 "voice_id": "<string>",
 "watermark": true,
 "resolution": "<string>",
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

## 状态码
- `200`: 请求成功，返回异步任务 ID。