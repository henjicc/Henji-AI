# MiniMax 音频快速复刻

本接口支持个人认证及企业认证用户调用。请参见 实名认证，完成个人用户认证或企业用户认证，以确保可以正常使用本功能。本接口支持单、双声道复刻声音，支持按照指定音频文件快速复刻相同音色的语音。 本接口产出的快速复刻音色为临时音色，如您希望永久保留某复刻音色，请于 168 小时（7 天）内在任意 T2A 语音合成接口中调用该音色（不包含本接口内的试听行为）；否则，该音色将被删除。


本接口适用场景：IP 复刻、音色克隆等需要快速复刻某一音色的相关场景。


说明：


- 上传的音频文件格式需为：mp3、m4a、wav 格式；
- 上传的音频文件的时长最少应不低于 10 秒，最长应不超过 5 分钟；
- 上传的音频文件大小需不超过 20mb。


## ​
请求头


**Content-Type**: 枚举值: application/json


**Authorization**: Bearer 身份验证格式，例如：Bearer {{API 密钥}}。


## ​
请求体


**audio_url**: 需要复刻音色的音频文件 url。支持 mp3、m4a、wav 格式。


**clone_prompt**: 音色复刻参数，提供本参数将有助于增强语音合成的音色相似度和稳定性。
若使用本参数，需同时上传一小段示例音频（时长小于 8s）及音频对应文本，音频支持 mp3、m4a、wav 格式。

Show properties


**text_validation**: 音频复刻参数。上传字符数限制为 200，若上传该字段，服务会对比音频与该文本的差异，若差异过大会返回错误码 1043。


**text**: 复刻试听参数。模型将使用复刻后的音色念诵本段文本内容，并以链接的形式将音频合成结果返回，供试听复刻效果。限制 2000 字符以内。注：试听将根据字符数正常收取语音合成费用，定价与 T2A 各接口一致。


**model**: 复刻试听参数。指定试听使用的语音模型，传”text”字段时必传该字段。
可选项：speech-02-hd, speech-02-turbo, speech-2.5-hd-preview, speech-2.5-turbo-preview


**accuracy**: 音频复刻参数。取值范围[0,1]。上传该字段会设置文本校验准确率阈值，不传时该字段值默认 0.7。


**need_noise_reduction**: 音频复刻参数。是否开启降噪。不传时默认取 false。


**need_volume_normalization**: 音频复刻参数。是否开启音量归一化。不传时默认取 false。


## ​
响应


**demo_audio_url**: 如果请求体中传入了试听文本 text 以及试听模型 model，那么本参数将以链接形式返回试听音频。


**voice_id**: 生成的 voice_id


## ​
示例


以下是如何使用 Minimax Voice Cloning API 复刻声音的示例。


请求：


Copy```
curl \
-X POST https://api.ppinfra.com/v3/minimax-voice-cloning \
-H "Authorization: Bearer $your_api_key" \
-H "Content-Type: application/json" \
-d '{
  "audio_url": "https://example.com/voice.mp3",
  "text": "近年来，人工智能在国内迎来高速发展期，技术创新与产业应用齐头并进。从基础的大模型研发到语音识别、图像处理、自然语言理解等关键技术突破，AI 正在深度赋能医疗、金融、制造、交通等多个领域。同时，政策支持和资本推动加速了技术落地，众多科技企业、创业团队和科研机构持续投入，形成了活跃的创新生态。AI 正逐步从实验室走向实际生产力，成为推动数字中国建设和经济高质量发展的重要引擎，未来发展潜力巨大。",
  "model": "speech-01-hd",
  "need_noise_reduction": true,
  "need_volume_normalization": true
}'

```


响应:


Copy```
{
  "demo_audio_url": "https://demo.com/audio.mp3", // 音频样例
  "voice_id": "xxxxxxx" // 生成的 voice_id
}

```

---

## 请求示例

```bash
curl --request POST \
  --url https://api.ppinfra.com/v3/minimax-voice-cloning \
  --header 'Authorization: <authorization>' \
  --header 'Content-Type: <content-type>' \
  --data '{
  "audio_url": "<string>",
  "text_validation": "<string>",
  "text": "<string>",
  "model": "<string>",
  "accuracy": 123,
  "need_noise_reduction": true,
  "need_volume_normalization": true
}'
```

## 响应示例

```json
{
  "demo_audio_url": "<string>",
  "voice_id": "<string>"
}
```