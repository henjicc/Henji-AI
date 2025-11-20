# Kling V2.5 Turbo 图生视频

Kling 2.5 Turbo 图生视频可以将单张图片和提示词生成具有电影感的视频，动作流畅、内容高度贴合所需意图。全新的文本-时序引擎、增强的运动表现和更快的推理速度。


> **Tip**: 这是一个异步API，只会返回异步任务的 task_id。您应该使用该 task_id 请求 查询任务结果 API 来检索视频生成结果。


## ​请求头


**Content-Type**: 枚举值: application/json


**Authorization**: Bearer 身份验证格式，例如：Bearer {{API 密钥}}。


## ​请求体


**image**: 视频的首帧图片；支持的图片格式包括 .jpg、.jpeg、.png；图片文件大小不得超过 10MB，分辨率不小于 300*300 像素。


**prompt**: 生成视频的正向提示词文本；不可超过 2500 个字符。


**duration**: 生成视频的时长（单位：秒）。可选值：5、10


**cfg_scale**: 控制视频生成的灵活性，数值越高，模型生成内容对提示词的贴合度越高，创意自由度越低。取值范围：0 到 1


**mode**: 视频生成模式。可选值：
pro：专业模式


**negative_prompt**: 反向提示词，用于规避不希望出现的内容；长度不超过 2500 字符。


## ​响应


**task_id**: 异步任务的 task_id。您应该使用该 task_id 请求 查询任务结果 API 以获取生成结果

---

## 请求示例

```bash
curl --request POST \
  --url https://api.ppinfra.com/v3/async/kling-2.5-turbo-i2v \
  --header 'Authorization: <authorization>' \
  --header 'Content-Type: <content-type>' \
  --data '{
  "image": "<string>",
  "prompt": "<string>",
  "duration": "<string>",
  "cfg_scale": 123,
  "mode": "<string>",
  "negative_prompt": "<string>"
}'
```

## 响应示例

```json
{
  "task_id": "<string>"
}
```