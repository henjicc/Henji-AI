# Minimax Hailuo 2.3 Fast 图生视频

Minimax Hailuo 2.3 Fast 在保持优异画质与表现力的同时，大幅提升了生成速度，具备更高性价比。


> **Tip**: 这是一个异步API，只会返回异步任务的 task_id。您应该使用该 task_id 请求 查询任务结果 API 来检索视频生成结果。


## ​
请求头


**Content-Type**: 枚举值: application/json


**Authorization**: Bearer 身份验证格式，例如：Bearer {{API 密钥}}。


## ​
请求体


**prompt**: 指导生成所需的提示词文本。
范围: 1 <= x <= 2000。


**image**: 用于视频生成的图片。支持公网 URL 或 Base64 编码（如 data:image/jpeg;base64,...）。


**duration**: 生成视频的时长（秒）。默认值：6
可选值：6、10


**resolution**: 生成视频的分辨率。默认值：768P
6 秒视频支持：768P、1080P
10 秒视频仅支持：768P


**enable_prompt_expansion**: 是否启用提示词优化。
默认值: true。


## ​
响应


**task_id**: 异步任务的 task_id。您应该使用该 task_id 请求 查询任务结果 API 以获取生成结果

---

## 请求示例

```bash
curl --request POST \
  --url https://api.ppinfra.com/v3/async/minimax-hailuo-2.3-fast-i2v \
  --header 'Authorization: <authorization>' \
  --header 'Content-Type: <content-type>' \
  --data '{
  "prompt": "<string>",
  "image": "<string>",
  "duration": 123,
  "resolution": "<string>",
  "enable_prompt_expansion": true
}'
```

## 响应示例

```json
{
  "task_id": "<string>"
}
```