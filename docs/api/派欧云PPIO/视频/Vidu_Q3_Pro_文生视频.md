---
title: "Vidu Q3 Pro 文生视频 - PPIO 派欧云文档中心"
url: "https://ppio.com/docs/models/reference-vidu-q3-pro-t2v"
captured_at: "2026-03-19T15:49:29.061Z"
---
# Vidu Q3 Pro 文生视频

## 描述
Vidu Q3 Pro 文生视频可根据文本描述生成带同步音频的高质量视频，支持最高 1080p 分辨率和 1-16 秒时长。

这是一个异步 API，只会返回异步任务的 task_id。您应该使用该 task_id 请求查询任务结果 API 来检索视频生成结果。

## 请求

### 请求头
- **Content-Type**  
  必填，枚举值：`application/json`

- **Authorization**  
  必填，Bearer 身份验证格式，例如：`Bearer {{API 密钥}}`

### 请求体
- **seed**  
  整数，随机种子，用于结果可复现。使用 0 表示随机。  
  取值范围：`[0, 2147483647]`

- **audio**  
  布尔值，默认值：`true`  
  是否使用音视频直出能力（包括台词和音效）。仅 Q3 模型支持该参数。

- **prompt**  
  字符串，必填  
  视频生成的文本描述，最多 2000 个字符。  
  长度限制：`0 - 2000`

- **wm_url**  
  字符串，水印图片 URL。

- **duration**  
  整数，默认值：`5`  
  视频时长（秒），范围 1-16。  
  取值范围：`[1, 16]`

- **off_peak**  
  布尔值，默认值：`false`  
  使用错峰模式。任务将在 48 小时内处理，费用更低。

- **watermark**  
  布尔值，默认值：`false`  
  是否添加水印。

- **resolution**  
  字符串，默认值：`"720p"`  
  输出视频画质。可选值：`540p`、`720p`、`1080p`

- **wm_position**  
  整数，水印位置：1=左上, 2=右上, 3=左下, 4=右下。  
  取值范围：`[1, 4]`

- **aspect_ratio**  
  字符串，默认值：`"16:9"`  
  输出视频宽高比。可选值：`16:9`、`9:16`、`4:3`、`3:4`、`1:1`

## 响应
- **task_id**  
  字符串，必填  
  异步任务的 task_id。您应该使用该 task_id 请求查询任务结果 API 以获取生成结果。

## 示例

### cURL
```bash
curl --request POST \
 --url https://api.ppio.com/v3/async/vidu-q3-pro-t2v \
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

### 响应示例
```json
{
 "task_id": "<string>"
}
```