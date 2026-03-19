---
title: "Vidu Q3 Turbo 首尾帧生成视频 - PPIO 派欧云文档中心"
url: "https://ppio.com/docs/models/reference-vidu-q3-turbo-f2v"
captured_at: "2026-03-19T15:49:45.271Z"
---
# Vidu Q3 Turbo 首尾帧生成视频

## 描述
Vidu Q3 Turbo 首尾帧生成视频可根据首帧和尾帧图片生成高质量视频，通过文本引导运动插值，支持最高 1080p 分辨率。

这是一个异步 API，只会返回异步任务的 task_id。您应该使用该 task_id 请求查询任务结果 API 来检索视频生成结果。

## 请求

### 请求头
- **Content-Type**  
  必填，枚举值: `application/json`

- **Authorization**  
  必填，Bearer 身份验证格式，例如：`Bearer {{API 密钥}}`

### 请求体
- **seed**  
  整数，随机种子，用于结果可复现。传 0 表示随机。

- **audio**  
  布尔值，默认值: `true`  
  是否使用音视频直出能力。false 输出静音视频，true 输出音画同步视频（包括台词和音效）。仅 Q3 系列模型支持。

- **images**  
  数组，必填  
  两张图片 URL 或 Base64 编码图片。第一张为首帧图，第二张为尾帧图。支持 png、jpeg、jpg、webp 格式，单张不超过 50MB。首尾帧两张图的分辨率需相近（首帧/尾帧比例在 0.8-1.25 之间）。宽高比需小于 1:4 或大于 4:1。  
  数组长度：2 - 2

- **is_rec**  
  布尔值，是否使用推荐 prompt。开启后系统自动生成 prompt。

- **prompt**  
  字符串，描述首尾帧之间期望的视频运动效果的文本，最多 1500 个字符。  
  长度限制：0 - 1500

- **duration**  
  整数，默认值: `5`  
  视频时长（秒），范围 1-16。  
  取值范围：[1, 16]

- **off_peak**  
  布尔值，默认值: `false`  
  是否使用错峰模式，任务将在 48 小时内处理，费用更低。

- **resolution**  
  字符串，默认值: `"720p"`  
  输出视频分辨率。  
  可选值：540p, 720p, 1080p

## 响应
- **task_id**  
  字符串，必填  
  异步任务的 task_id。您应该使用该 task_id 请求查询任务结果 API 以获取生成结果。

## 示例

### cURL
```bash
curl --request POST \
 --url https://api.ppio.com/v3/async/vidu-q3-turbo-f2v \
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
 "resolution": "<string>"
}
'
```

### 响应示例
```json
{
 "task_id": "<string>"
}
```