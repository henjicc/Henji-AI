---
title: "MiniMax Speech 2.8 HD 异步语音合成 - PPIO 派欧云文档中心"
url: "https://ppio.com/docs/models/reference-minimax-speech-2.8-hd-async"
captured_at: "2026-03-22T16:15:06.191Z"
---
# MiniMax Speech 2.8 HD 异步语音合成

## 接口信息
- **方法**: POST
- **路径**: `/v3/async/minimax-speech-2.8-hd`
- **描述**: MiniMax 异步语音合成 API，支持多种音色、情绪、语速等参数设置，文本长度限制最长 5 万字符，支持文件输入（最长 10 万字符）。这是一个异步 API，只会返回异步任务的 `task_id`，您应该使用该 `task_id` 请求查询任务结果 API 来检索生成结果。

## 请求头
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| Content-Type | string | 是 | 枚举值: `application/json` |
| Authorization | string | 是 | Bearer 身份验证格式，例如：`Bearer {{API 密钥}}` |

## 请求体
### 必填参数
- **voice_setting** (object): 音频设置
  - **voice_id** (string, 必填): 合成音频的音色编号。支持系统音色、复刻音色以及文生音色三种类型。部分系统音色 ID 示例：
    - 中文: `moss_audio_ce44fc67-7ce3-11f0-8de5-96e35d26fb85`, `moss_audio_aaa1346a-7ce7-11f0-8e61-2e6e3c7ee85d`, `Chinese (Mandarin)_Lyrical_Voice`, `Chinese (Mandarin)_HK_Flight_Attendant`
    - 英文: `English_Graceful_Lady`, `English_Insightful_Speaker`, `English_radiant_girl`, `English_Persuasive_Man`, `moss_audio_6dc281eb-713c-11f0-a447-9613c873494c`, `moss_audio_570551b1-735c-11f0-b236-0adeeecad052`, `moss_audio_ad5baf92-735f-11f0-8263-fe5a2fe98ec8`, `English_Lucky_Robot`
    - 日文: `Japanese_Whisper_Belle`, `moss_audio_24875c4a-7be4-11f0-9359-4e72c55db738`, `moss_audio_7f4ee608-78ea-11f0-bb73-1e2a4cfcd245`, `moss_audio_c1a6a3ac-7be6-11f0-8e8e-36b92fbb4f95`

### 可选参数
- **text** (string): 待合成音频的文本，限制最长 5 万字符。和 `text_file_id` 二选一必填。
  - **语气词标签**: 仅当模型选择 `speech-2.8-hd` 或 `speech-2.8-turbo` 时，支持在文本中插入语气词标签。支持的语气词：`(laughs)`（笑声）、`(chuckle)`（轻笑）、`(coughs)`（咳嗽）、`(clear-throat)`（清嗓子）、`(groans)`（呻吟）、`(breath)`（正常换气）、`(pant)`（喘气）、`(inhale)`（吸气）、`(exhale)`（呼气）、`(gasps)`（倒吸气）、`(sniffs)`（吸鼻子）、`(sighs)`（叹气）、`(snorts)`（喷鼻息）、`(burps)`（打嗝）、`(lip-smacking)`（咂嘴）、`(humming)`（哼唱）、`(hissing)`（嘶嘶声）、`(emm)`（嗯）、`(whistles)`（口哨）、`(sneezes)`（喷嚏）、`(crying)`（抽泣）、`(applause)`（鼓掌）
- **text_file_id** (integer): 待合成音频的文本文件 ID，单个文件长度限制小于 10 万字符，支持的文件格式：`txt`、`zip`。和 `text` 二选一必填，传入后自动校验格式。
  - **txt 文件**: 长度限制 <100000 字符。支持使用 `<#x#>` 标记自定义停顿。`x` 为停顿时长（单位：秒），范围 `[0.01, 99.99]`，最多保留两位小数。注意停顿需设置在两个可以语音发音的文本之间，不可连续使用多个停顿标记。
  - **zip 文件**: 压缩包内需包含同一格式的 `txt` 或 `json` 文件。`json` 文件格式：支持 `[title, content, extra]` 三个字段，分别表示标题、正文、附加信息。若三个字段都存在，则产出 3 组结果，共 9 个文件，统一存放在一个文件夹中。若某字段不存在或内容为空，则该字段不会生成对应结果。
- **voice_modify** (object): 音色调整
  - **pitch** (integer): 音高调整（低沉/明亮），范围 `[-100, 100]`，数值接近 `-100`，声音更低沉；接近 `100`，声音更明亮。
  - **timbre** (integer): 音色调整（磁性/清脆），范围 `[-100, 100]`，数值接近 `-100`，声音更浑厚；数值接近 `100`，声音更清脆。
  - **intensity** (integer): 强度调整（力量感/柔和），范围 `[-100, 100]`，数值接近 `-100`，声音更刚劲；接近 `100`，声音更轻柔。
  - **sound_effects** (string): 音效设置，单次仅能选择一种，可选值：`spacious_echo`（空旷回音）、`auditorium_echo`（礼堂广播）、`lofi_telephone`（电话失真）、`robotic`（电音）。
- **audio_setting** (object): 音频格式设置
  - **format** (string, 默认值: `"mp3"`): 生成音频的格式。可选范围 `[mp3, pcm, flac]`。
  - **bitrate** (integer, 默认值: `128000`): 生成音频的比特率。可选范围 `[32000, 64000, 128000, 256000]`，该参数仅对 `mp3` 格式的音频生效。
  - **channel** (integer, 默认值: `2`): 生成音频的声道数。可选范围：`[1, 2]`，其中 `1` 为单声道，`2` 为双声道。
  - **audio_sample_rate** (integer, 默认值: `32000`): 生成音频的采样率。可选范围 `[8000, 16000, 22050, 24000, 32000, 44100]`。
- **voice_setting** (object, 必填): 音频设置
  - **vol** (number, 默认值: `1`): 合成音频的音量，取值越大，音量越高。取值范围 `(0, 10]`。
  - **pitch** (integer, 默认值: `0`): 合成音频的语调，取值范围 `[-12, 12]`，`0` 为原音色输出。
  - **speed** (number, 默认值: `1`): 合成音频的语速，取值越大，语速越快。取值范围 `[0.5, 2]`。
  - **emotion** (string): 控制合成语音的情绪，参数范围 `["happy", "sad", "angry", "fearful", "disgusted", "surprised", "calm", "fluent", "whisper"]`，分别对应 8 种情绪：高兴、悲伤、愤怒、害怕、厌恶、惊讶、中性、生动、低语。模型会根据输入文本自动匹配合适的情绪，一般无需手动指定。该参数仅对 `speech-2.6-hd`、`speech-2.6-turbo`、`speech-02-hd`、`speech-02-turbo`、`speech-01-hd`、`speech-01-turbo` 模型生效。选项 `fluent`、`whisper` 仅对 `speech-2.6-turbo`、`speech-2.6-hd` 模型生效。
  - **english_normalization** (boolean, 默认值: `false`): 支持英语文本规范化，开启后可提升数字阅读场景的性能，但会略微增加延迟。
- **aigc_watermark** (boolean, 默认值: `false`): 控制在合成音频的末尾添加音频节奏标识，该参数仅对非流式合成生效。
- **language_boost** (string): 是否增强对指定的小语种和方言的识别能力。默认值为 `null`，可设置为 `auto` 让模型自主判断。可选值：`Chinese`、`Chinese,Yue`、`English`、`Arabic`、`Russian`、`Spanish`、`French`、`Portuguese`、`German`、`Turkish`、`Dutch`、`Ukrainian`、`Vietnamese`、`Indonesian`、`Japanese`、`Italian`、`Korean`、`Thai`、`Polish`、`Romanian`、`Greek`、`Czech`、`Finnish`、`Hindi`、`Bulgarian`、`Danish`、`Hebrew`、`Malay`、`Persian`、`Slovak`、`Swedish`、`Croatian`、`Filipino`、`Hungarian`、`Norwegian`、`Slovenian`、`Catalan`、`Nynorsk`、`Tamil`、`Afrikaans`、`auto`。
- **continuous_sound** (boolean, 默认值: `false`): 启用该参数，使得子句衔接处更自然，仅支持 `speech-2.8-hd` 和 `speech-2.8-turbo` 模型。
- **pronunciation_dict** (object): 发音字典
  - **tone** (array): 定义需要特殊标注的文字或符号对应的注音或发音替换规则。在中文文本中，声调用数字表示：一声为 `1`，二声为 `2`，三声为 `3`，四声为 `4`，轻声为 `5`。示例如下：`["燕少飞/(yan4)(shao3)(fei1)", "omg/oh my god"]`。

## 响应
### 成功响应 (200)
```json
{
  "file_id": 123,
  "task_id": "<string>",
  "base_resp": {
    "status_msg": "<string>",
    "status_code": 123
  },
  "task_token": "<string>",
  "usage_characters": 123
}
```
- **file_id** (integer): 任务创建成功后返回的对应音频文件的 ID。当任务完成后，可通过 `file_id` 查询。当请求出错时，不返回该字段。注意：返回的下载 URL 自生成起 9 小时（32400 秒）内有效，过期后文件将失效，生成的信息便会丢失，请注意下载信息的时间。
- **task_id** (string): 异步任务的 `task_id`。您应该使用该 `task_id` 请求查询任务结果 API 以获取生成结果。
- **base_resp** (object):
  - **status_msg** (string, 必填): 状态详情。
  - **status_code** (integer, 必填): 状态码。
    - `0`: 正常
    - `1002`: 限流
    - `1004`: 鉴权失败
    - `1039`: 触发 TPM 限流
    - `1042`: 非法字符超 10%
    - `2013`: 参数错误
- **task_token** (string): 完成当前任务使用的密钥信息。
- **usage_characters** (integer): 计费字符数。

## cURL 示例
```bash
curl --request POST \
  --url https://api.ppio.com/v3/async/minimax-speech-2.8-hd \
  --header 'Authorization: <authorization>' \
  --header 'Content-Type: <content-type>' \
  --data '
{
  "text": "<string>",
  "text_file_id": 123,
  "voice_modify": {
    "pitch": 123,
    "timbre": 123,
    "intensity": 123,
    "sound_effects": "<string>"
  },
  "audio_setting": {
    "format": "<string>",
    "bitrate": 123,
    "channel": 123,
    "audio_sample_rate": 123
  },
  "voice_setting": {
    "vol": 123,
    "pitch": 123,
    "speed": 123,
    "emotion": "<string>",
    "voice_id": "<string>",
    "english_normalization": true
  },
  "aigc_watermark": true,
  "language_boost": "<string>",
  "continuous_sound": true,
  "pronunciation_dict": {
    "tone": [
      {}
    ]
  }
}
'
```