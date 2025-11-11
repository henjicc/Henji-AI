# Vidu Q1 文生视频

Vidu Q1 文生视频通过利用关键帧技术生成流畅无缝的视频，保持一致的主题风格。


> **Tip**: 这是一个异步API，只会返回异步任务的 task_id。您应该使用该 task_id 请求 查询任务结果 API 来检索视频生成结果。


## ​
请求头


**Content-Type**: 枚举值: application/json


**Authorization**: Bearer 身份验证格式，例如：Bearer {{API 密钥}}。


## ​
请求体


**prompt**: 视频生成的文本提示词，最大长度为 1500 个字符。


**style**: 输出视频的风格。默认值：general
可选值：general、anime
general：通用风格。允许通过提示词控制风格
anime：动漫风格。针对动漫美学优化，对动漫相关提示词有更好的表现


**duration**: 视频持续时间（秒）。默认为 5 秒，目前仅支持 5 秒选项。


**seed**: 视频生成的随机种子。
默认为随机种子数值
手动设置的值将覆盖默认的随机种子


**aspect_ratio**: 输出视频的宽高比。默认值：16:9
可选值：16:9、9:16、1:1


**resolution**: 输出视频分辨率。默认为 1080p，目前仅支持 1080p 选项。


**movement_amplitude**: 画面中物体的运动幅度。默认值：auto
可选值：auto、small、medium、large


**bgm**: 是否为生成的视频添加背景音乐。默认值：false
可选值：true、false
当设置为 true 时，系统将自动添加合适的 BGM。BGM 无时长限制，系统会自动适配。


## ​
响应


**task_id**: 异步任务的 task_id。您应该使用该 task_id 请求 查询任务结果 API 以获取生成结果

---

## 请求示例

```bash
curl --request POST \
  --url https://api.ppinfra.com/v3/async/vidu-q1-text2video \
  --header 'Authorization: <authorization>' \
  --header 'Content-Type: <content-type>' \
  --data '{
  "prompt": "<string>",
  "style": "<string>",
  "duration": 123,
  "seed": 123,
  "aspect_ratio": "<string>",
  "resolution": "<string>",
  "movement_amplitude": "<string>",
  "bgm": true
}'
```

## 响应示例

```json
{
  "task_id": "<string>"
}
```