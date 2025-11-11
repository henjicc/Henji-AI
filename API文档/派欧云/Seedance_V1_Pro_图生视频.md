# Seedance V1 Pro 图生视频

Seedance V1 Pro 是一个 AI 视频模型，专为生成连贯的多镜头视频而设计，提供流畅的运动和对详细提示的精确遵循。它支持 480p、720p 和 1080p 的分辨率。


> **Warning**: 本接口支持个人认证及企业认证用户调用。请参见 实名认证，完成个人用户认证或企业用户认证，以确保可以正常使用本功能。


## ​
请求头


**Content-Type**: 枚举值: application/json


**Authorization**: Bearer 身份验证格式，例如：Bearer {{API 密钥}}。


## ​
请求体


**prompt**: 视频生成的文本提示；正面文本提示；支持中英文，建议不超过500字。


**image**: 输入图像支持 URL 和 Base64 格式；支持的图像格式包括 .jpg、.jpeg、.png；图像文件大小不能超过 10MB，图像分辨率不应小于 300*300px。


**resolution**: 视频质量。可接受的值：480p，720p，1080p


**aspect_ratio**: 生成视频的长宽比。 可接受的值：21:9，16:9，4:3，1:1，3:4，9:16，9:21


**camera_fixed**: 确定相机位置是否应保持固定。


**seed**: 用于生成的随机种子。-1 表示将使用随机种子。


**duration**: 指定生成视频的长度（以秒为单位）。可用选项：5，10


## ​
响应


**task_id**: 异步任务的 task_id。您应该使用该 task_id 请求 查询任务结果 API 以获取生成结果

---

## 请求示例

```bash
curl --request POST \
  --url https://api.ppinfra.com/v3/async/seedance-v1-pro-i2v \
  --header 'Authorization: <authorization>' \
  --header 'Content-Type: <content-type>' \
  --data '{
  "prompt": "<string>",
  "image": "<string>",
  "resolution": "<string>",
  "aspect_ratio": "<string>",
  "camera_fixed": true,
  "seed": 123,
  "duration": 123
}'
```

## 响应示例

```json
{
  "task_id": "<string>"
}
```