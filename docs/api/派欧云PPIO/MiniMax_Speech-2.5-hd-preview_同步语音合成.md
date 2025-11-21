# MiniMax Speech-2.5-hd-preview 同步语音合成

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

---

## 请求示例

```bash
curl --request POST \
  --url https://api.ppinfra.com/v3/minimax-speech-2.5-hd-preview \
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