# PixVerse V4.5 文生视频

使用 PixVerse 最新的 v4.5 模型从文本描述生成高质量视频。支持多种分辨率、纵横比和运动模式，以实现多样化的视频创作。


> **Tip**: 这是一个异步API，只会返回异步任务的 task_id。您应该使用该 task_id 请求 查询任务结果 API 来检索视频生成结果。


## ​
请求头


**Content-Type**: 枚举值: application/json


**Authorization**: Bearer 身份验证格式，例如：Bearer {{API 密钥}}。


## ​
请求体


**prompt**: 视频生成的文本提示。
最大长度：2048 个字符
清晰描述所需场景和动作


**aspect_ratio**: 视频的宽高比。默认值：16:9
可接受的值：16:9、4:3、1:1、3:4、9:16


**resolution**: 视频质量。默认值：540p
可接受的值：
fast_mode 为 false：360p、540p、720p、1080p
fast_mode 为 true：360p、540p、720p


**negative_prompt**: 生成的负面提示。
最大长度：2048 个字符


**fast_mode**: 是否启用快速模式，该模式将更快地生成视频，但可能降低质量并降低价格。
默认值：false。


**style**: 风格预设（仅限 v3.5）。
可接受的值：anime、3d_animation、clay、comic、cyberpunk


（当前应用未使用随机种子参数）


## ​
响应


**task_id**: 异步任务的 task_id。您应该使用该 task_id 请求 查询任务结果 API 以获取生成结果

---

## 请求示例

```bash
curl --request POST \
  --url https://api.ppinfra.com/v3/async/pixverse-v4.5-t2v \
  --header 'Authorization: <authorization>' \
  --header 'Content-Type: <content-type>' \
  --data '{
  "prompt": "<string>",
  "aspect_ratio": "<string>",
  "resolution": "<string>",
  "negative_prompt": "<string>",
  "fast_mode": true,
  "style": "<string>",
  "seed": 123
}'
```

## 响应示例

```json
{
  "task_id": "<string>"
}
```
