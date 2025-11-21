# Kling V2.5 Turbo 文生视频

Kling 2.5 Turbo 是一款先进的文本生成视频模型，能够生成超流畅的动作、电影级画面，并高度贴合提示词内容。


> **Tip**: 这是一个异步API，只会返回异步任务的 task_id。您应该使用该 task_id 请求 查询任务结果 API 来检索视频生成结果。


## ​
请求头


**Content-Type**: 枚举值: application/json


**Authorization**: Bearer 身份验证格式，例如：Bearer {{API 密钥}}。


## ​
请求体


**prompt**: 指导生成的正向文本提示词。长度不超过 2500 字符。


**duration**: 生成视频的时长（秒）。
可选值：5、10


**aspect_ratio**: 输出视频的宽高比。
可选值：16:9、9:16、1:1


**cfg_scale**: 控制视频生成的灵活性，数值越高，模型生成内容对提示词的贴合度越高，创意自由度越低。
取值范围：0 到 1


**mode**: 视频生成模式。可选值：
pro：专业模式


**negative_prompt**: 反向提示词，用于规避不希望出现的内容；长度不超过 2500 字符。


## ​
响应


**task_id**: 异步任务的 task_id。您应该使用该 task_id 请求 查询任务结果 API 以获取生成结果

---

## 请求示例

```bash
curl --request POST \
  --url https://api.ppinfra.com/v3/async/kling-2.5-turbo-t2v \
  --header 'Authorization: <authorization>' \
  --header 'Content-Type: <content-type>' \
  --data '{
  "prompt": "<string>",
  "duration": "<string>",
  "aspect_ratio": "<string>",
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