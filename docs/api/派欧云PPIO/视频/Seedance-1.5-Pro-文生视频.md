# Seedance 1.5 Pro 文生视频
seedance-v1.5-pro-t2v
Seedance 1.5 Pro 文生视频
```
curl --request POST \
  --url https://api.ppio.com/v3/async/seedance-v1.5-pro-t2v \
  --header 'Authorization: <authorization>' \
  --header 'Content-Type: <content-type>' \
  --data '
{
  "fps": 123,
  "seed": 123,
  "ratio": "<string>",
  "prompt": "<string>",
  "duration": 123,
  "watermark": true,
  "resolution": "<string>",
  "camera_fixed": true,
  "service_tier": "<string>",
  "generate_audio": true,
  "execution_expires_after": 123
}
'
```

```
{
  "task_id": "<string>"
}
```

Seedance 1.5 pro 文生视频 API。
这是一个**异步** API，只会返回异步任务的 task_id。您应该使用该 task_id 请求 [查询任务结果 API](https://ppio.com/docs/models/reference-get-async-task-result) 来检索视频生成结果。

请求头

Content-Type
string
必填
枚举值: `application/json`

Authorization
string
必填
Bearer 身份验证格式，例如：Bearer {{API 密钥}}。

请求体

fps
integer
默认值:24
帧率（每秒帧数）。仅支持 24 fps。可选值：`24`

seed
integer
默认值:-1
用于控制随机性的种子整数。范围：[-1, 2^32-1]。-1 表示使用随机种子。相同种子和相同请求会产生相似（但不完全相同）的结果。取值范围：[-1, 4294967295]

ratio
string
默认值:"adaptive"
生成视频的宽高比。‘adaptive’：文生视频时，模型根据提示词智能选择最佳比例；图生视频时，根据上传的首帧图像比例自动选择。可选值：`16:9`, `4:3`, `1:1`, `3:4`, `9:16`, `21:9`, `adaptive`

prompt
string
必填
描述预期视频内容的文本提示词。支持中英文。建议不超过 500 个字符。如需生成带对话的音频，请将语音内容放在双引号内以获得更好的音频生成效果。

duration
integer
默认值:5
视频时长，单位为秒。支持 [4, 12] 范围内的指定时长。注意：时长会影响计费。取值范围：[4, 12]

watermark
boolean
默认值:false
生成的视频是否包含水印。true：带水印。false：不带水印。

resolution
string
默认值:"720p"
视频分辨率。Seedance 1.5 pro 支持 480p 和 720p（暂不支持 1080p）。可选值：`480p`, `720p`

camera_fixed
boolean
默认值:false
是否固定摄像机位置。true：平台在提示词中追加固定摄像机指令（效果不保证）。false：不固定摄像机。

service_tier
string
默认值:"default"
处理请求的服务层级。‘default’：在线推理模式，RPM 和并发配额较低，适用于时效性要求高的场景。‘flex’：离线推理模式，TPD 配额更高，价格为在线模式的 50%，适用于对延迟不敏感的场景。可选值：`default`, `flex`

generate_audio
boolean
默认值:true
生成的视频是否包含同步音频。true：视频包含基于提示词和视觉内容自动生成的语音、音效和背景音乐。false：输出无声视频。

execution_expires_after
integer
默认值:172800
任务超时阈值，单位为秒，从 created_at 时间戳开始计算。默认值：172800（48 小时）。范围：[3600, 259200]。超过此时间的任务将被自动终止并标记为 ‘expired’。取值范围：[3600, 259200]

响应

task_id
string
必填
异步任务的 task_id。您应该使用该 task_id 请求 [查询任务结果 API](https://ppio.com/docs/models/reference-get-async-task-result) 以获取生成结果