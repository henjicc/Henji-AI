# MiniMax Speech-02-hd 同步语音合成

该 API 支持基于文本到语音的同步生成，单次文本传输最大 10000 字符。支持 100+系统音色、复刻音色自主选择；支持音量、语调、语速、输出格式调整；支持按比例混音功能、固定间隔时间控制；支持多种音频规格、格式，包括：mp3, pcm, flac, wav，支持流式输出。


提交长文本语音合成请求后，需要注意的是返回的 url 的有效期为自 url 返回开始的 24 个小时，请注意下载信息的时间。


> **Tip**: 适用于短句生成、语音聊天、在线社交等场景，耗时短但文本长度限制小于 10000 字符。长文本建议使用 异步调用语音合成。


## ​
请求头


**Content-Type**: 枚举值: application/json


**Authorization**: Bearer 身份验证格式，例如：Bearer {{API 密钥}}。


## ​
请求体


**text**: 待合成的文本，长度限制小于 10000 字符，段落切换用换行符替代。（如需要控制语音中间隔时间，在字间增加 <#x#>,x 单位为秒，支持 0.01-99.99，最多两位小数）。支持自定义文本与文本之间的语音时间间隔，以实现自定义文本语音停顿时间的效果。需要注意的是文本间隔时间需设置在两个可以语音发音的文本之间，且不能设置多个连续的时间间隔。


**voice_setting**: Show properties


**audio_setting**: Show properties


**pronunciation_dict**: Show properties


**timbre_weights**: 与 voice_id 二选一必填

Show properties


**stream**: 是否流式。默认 false，即不开启流式。


**stream_options**: Show properties


**language_boost**: 增强对指定的小语种和方言的识别能力，设置后可以提升在指定小语种/方言场景下的语音表现。如果不明确小语种类型，则可以选择”auto”，模型将自主判断小语种类型。支持以下取值：
'Chinese', 'Chinese,Yue', 'English', 'Arabic', 'Russian', 'Spanish', 'French', 'Portuguese', 'German', 'Turkish', 'Dutch', 'Ukrainian', 'Vietnamese', 'Indonesian', 'Japanese', 'Italian', 'Korean', 'Thai', 'Polish', 'Romanian', 'Greek', 'Czech', 'Finnish', 'Hindi', 'auto'


**output_format**: 控制输出结果形式的参数。可选值为 url hex。默认值为 hex。该参数仅在非流式场景生效，流式场景仅支持返回 hex 形式。返回的 url 有效期为 24 小时。


## ​
响应


**audio**: 合成后的音频片段，采用 hex 编码，按照输入定义的格式 (audio_setting.format) 进行生成（mp3/pcm/flac）。返回形式根据 output_format 的定义返回，stream 为 true 时只支持 hex 的返回形式。


**status**: 当前音频流状态，仅 stream 为 true 时返回。1 表示合成中，2 表示合成结束。


## ​
示例


以下是如何使用 Minimax Speech-02-hd 同步请求 API 的示例。


1. 非流式（stream 为 false）


> **Tip**: 如果不指定 output_format 为 url，默认会以 hex 形式返回


请求：


Copy```
curl \
-X POST https://api.ppinfra.com/v3/minimax-speech-02-hd \
-H "Authorization: Bearer $your_api_key" \
-H "Content-Type: application/json" \
-d '{
  "text": "近年来，人工智能在国内迎来高速发展期，技术创新与产业应用齐头并进。从基础的大模型研发到语音识别、图像处理、自然语言理解等关键技术突破，AI 正在深度赋能医疗、金融、制造、交通等多个领域。同时，政策支持和资本推动加速了技术落地，众多科技企业、创业团队和科研机构持续投入，形成了活跃的创新生态。AI 正逐步从实验室走向实际生产力，成为推动数字中国建设和经济高质量发展的重要引擎，未来发展潜力巨大。",
  "stream": false,
  "output_format": "url",
  "voice_setting": {
    "speed": 1.1,
    "voice_id": "male-qn-jingying",
    "emotion": "happy"
  }
}'

```


响应:


Copy```
{
  "audio": "https://faas-minimax-video-1312767721.cos.ap-shanghai.myqcloud.com/test/f9dd3abf-a708-4567-9099-db7356f0f77e-4245f063-6985-477b-bfff-c693b85bdba7.mp3?q-sign-algorithm=sha1&q-ak=AKIDHOHvKVnrgHkyxhCTyOdeSjoiRxGPSJ0V&q-sign-time=1752118598%3B1752122198&q-key-time=1752118598%3B1752122198&q-header-list=host&q-url-param-list=&q-signature=10266eb2e1e54fd26647994fae7edad1f2b12c58"
}

```


音频文件:



1. 流式（stream 为 true）


请求：


Copy```
curl \
-X POST https://api.ppinfra.com/v3/minimax-speech-02-hd \
-H "Authorization: Bearer $your_api_key" \
-H "Content-Type: application/json" \
-d '{
  "text": "近年来，人工智能在国内迎来高速发展期，技术创新与产业应用齐头并进。从基础的大模型研发到语音识别、图像处理、自然语言理解等关键技术突破，AI 正在深度赋能医疗、金融、制造、交通等多个领域。同时，政策支持和资本推动加速了技术落地，众多科技企业、创业团队和科研机构持续投入，形成了活跃的创新生态。AI 正逐步从实验室走向实际生产力，成为推动数字中国建设和经济高质量发展的重要引擎，未来发展潜力巨大。",
  "stream": true,
  "voice_setting": {
    "speed": 1.1,
    "voice_id": "male-qn-jingying",
    "emotion": "happy"
  }
}'

```


响应:


Copy```
data: {"audio": "fffb98c4d8 ... e12fc5be", "status": 1}
...
data: {"audio": "4944330453 ... 34505005", "status": 1}
...
data: {"audio": "fffb98c45f ... 04f61e30", "status": 1}
...
data: {"status": 2}

```

---

## 请求示例

```bash
curl --request POST \
  --url https://api.ppinfra.com/v3/minimax-speech-02-hd \
  --header 'Authorization: <authorization>' \
  --header 'Content-Type: <content-type>' \
  --data '{
  "text": "<string>",
  "voice_setting": {
    "speed": 123,
    "vol": 123,
    "pitch": 123,
    "voice_id": "<string>",
    "emotion": "<string>",
    "latex_read": true,
    "text_normalization": true
  },
  "audio_setting": {
    "sample_rate": 123,
    "bitrate": 123,
    "format": "<string>",
    "channel": 123
  },
  "pronunciation_dict": {
    "tone": [
      {}
    ]
  },
  "timbre_weights": [
    {
      "voice_id": "<string>",
      "weight": 123
    }
  ],
  "stream": true,
  "stream_options": {
    "exclude_aggregated_audio": true
  },
  "language_boost": "<string>",
  "output_format": "<string>"
}'
```

## 响应示例

```json
{
  "audio": "<string>",
  "status": 123
}
```