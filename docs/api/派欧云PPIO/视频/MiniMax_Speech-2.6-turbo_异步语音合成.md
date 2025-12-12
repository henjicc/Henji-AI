# MiniMax Speech-2.6-turbo 异步语音合成

该 API 支持基于文本到语音的异步生成，单次文本生成传输最大支持 100 万字符，生成的完整音频结果支持异步检索。支持 100+ 系统音色、复刻音色自主选择；支持语调、语速、音量、比特率、采样率、输出格式自主调整。

提交长文本语音合成请求后，返回的 URL 有效期为自 URL 返回开始的 24 小时，请注意及时下载。

适用于整本书籍等长文本的语音生成，任务排队耗时可能较长。对于短句生成、语音聊天、在线社交等场景，建议使用 [同步调用语音合成](/docs/models/reference-minimax-speech-2.6-turbo)。

## 请求示例

```bash
curl --request POST \
  --url https://api.ppinfra.com/v3/async/minimax-speech-2.6-turbo \
  --header 'Authorization: <authorization>' \
  --header 'Content-Type: application/json' \
  --data '
{
  "text": "<string>",
  "voice_setting": {
    "speed": 123,
    "vol": 123,
    "pitch": 123,
    "voice_id": "<string>",
    "emotion": "<string>",
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
  "language_boost": "<string>",
  "voice_modify": {
    "pitch": 123,
    "intensity": 123,
    "timbre": 123,
    "sound_effects": "<string>"
  }
}
'
```

## 响应示例

```json
{
  "task_id": "<string>"
}
```

## 请求头

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `Content-Type` | string | 是 | 固定为 `application/json`。 |
| `Authorization` | string | 是 | Bearer 身份验证格式，例如：`Bearer {{API 密钥}}`。 |

## 请求体

| 参数名 | 类型 | 必填 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- | :--- |
| `text` | string | 是 | - | 待合成的文本，限制最长 5 万字符。 |
| `voice_setting` | object | 是 | - | 语音设置。 |
| `audio_setting` | object | 否 | - | 音频设置。 |
| `pronunciation_dict` | object | 否 | - | 发音词典。 |
| `language_boost` | string | 否 | `null` | 增强对指定小语种和方言的识别能力。 |
| `voice_modify` | object | 否 | - | 声音效果器设置，支持的音频格式：mp3, wav, flac。 |

### `voice_setting` 对象属性

| 参数名 | 类型 | 必填 | 默认值 | 范围/枚举 | 说明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `speed` | number | 否 | 1 | [0.5, 2] | 语速，取值越大，语速越快。 |
| `vol` | number | 否 | 1 | (0, 10] | 音量，取值越大，音量越高。 |
| `pitch` | number | 否 | 0 | [-12, 12] | 语调，0 为原音色输出，取值需为整数。 |
| `voice_id` | string | 是 | - | - | 请求的音色编号。支持系统音色和复刻音色。 |
| `emotion` | string | 否 | - | `["happy", "sad", "angry", "fearful", "disgusted", "surprised", "neutral"]` | 合成语音的情绪。 |
| `text_normalization` | bool | 否 | false | - | 英语文本规范化，可提升数字阅读场景性能，但会略微增加延迟。 |

#### 系统音色列表
*   `male-qn-qingse` (青涩青年音色)
*   `male-qn-jingying` (精英青年音色)
*   `male-qn-badao` (霸道青年音色)
*   `male-qn-daxuesheng` (青年大学生音色)
*   `female-shaonv` (少女音色)
*   `female-yujie` (御姐音色)
*   `female-chengshu` (成熟女性音色)
*   `female-tianmei` (甜美女性音色)
*   `presenter_male` (男性主持人)
*   `presenter_female` (女性主持人)
*   `audiobook_male_1` (男性有声书 1)
*   `audiobook_male_2` (男性有声书 2)
*   `audiobook_female_1` (女性有声书 1)
*   `audiobook_female_2` (女性有声书 2)
*   `male-qn-qingse-jingpin` (青涩青年音色-beta)
*   `male-qn-jingying-jingpin` (精英青年音色-beta)
*   `male-qn-badao-jingpin` (霸道青年音色-beta)
*   `male-qn-daxuesheng-jingpin` (青年大学生音色-beta)
*   `female-shaonv-jingpin` (少女音色-beta)
*   `female-yujie-jingpin` (御姐音色-beta)
*   `female-chengshu-jingpin` (成熟女性音色-beta)
*   `female-tianmei-jingpin` (甜美女性音色-beta)
*   `clever_boy` (聪明男童)
*   `cute_boy` (可爱男童)
*   `lovely_girl` (萌萌女童)
*   `cartoon_pig` (卡通猪小琪)
*   `bingjiao_didi` (病娇弟弟)
*   `junlang_nanyou` (俊朗男友)
*   `chunzhen_xuedi` (纯真学弟)
*   `lengdan_xiongzhang` (冷淡学长)
*   `badao_shaoye` (霸道少爷)
*   `tianxin_xiaoling` (甜心小玲)
*   `qiaopi_mengmei` (俏皮萌妹)
*   `wumei_yujie` (妩媚御姐)
*   `diadia_xuemei` (嗲嗲学妹)
*   `danya_xuejie` (淡雅学姐)
*   `Santa_Claus` (Santa Claus)
*   `Grinch` (Grinch)
*   `Rudolph` (Rudolph)
*   `Arnold` (Arnold)
*   `Charming_Santa` (Charming Santa)
*   `Charming_Lady` (Charming Lady)
*   `Sweet_Girl` (Sweet Girl)
*   `Cute_Elf` (Cute Elf)
*   `Attractive_Girl` (Attractive Girl)
*   `Serene_Woman` (Serene Woman)

### `audio_setting` 对象属性

| 参数名 | 类型 | 必填 | 默认值 | 范围/枚举 | 说明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `sample_rate` | number | 否 | 32000 | [8000, 16000, 22050, 24000, 32000, 44100] | 采样率。 |
| `bitrate` | number | 否 | 128000 | [32000, 64000, 128000, 256000] | 比特率。该参数仅对 mp3 格式的音频生效。 |
| `format` | string | 否 | `mp3` | `mp3`, `pcm`, `flac`, `wav` | 生成的音频格式。wav 仅在非流式输出下支持。 |
| `channel` | number | 否 | 1 | 1, 2 | 声道数。1：单声道，2：双声道。 |

### `pronunciation_dict` 对象属性

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `tone` | list | 否 | 替换需要特殊标注的文字、符号及对应的注音。格式：`["燕少飞/(yan4)(shao3)(fei1)", "达菲/(da2)(fei1)", "omg/oh my god"]`。声调用数字表示：一声（阴平）为1，二声（阳平）为2，三声（上声）为3，四声（去声）为4，轻声为5。 |

### `language_boost` 参数取值
支持以下取值：`'Chinese'`, `'Chinese,Yue'`, `'English'`, `'Arabic'`, `'Russian'`, `'Spanish'`, `'French'`, `'Portuguese'`, `'German'`, `'Turkish'`, `'Dutch'`, `'Ukrainian'`, `'Vietnamese'`, `'Indonesian'`, `'Japanese'`, `'Italian'`, `'Korean'`, `'Thai'`, `'Polish'`, `'Romanian'`, `'Greek'`, `'Czech'`, `'Finnish'`, `'Hindi'`, `'auto'`。如果不明确小语种类型，可选择 `auto`，模型将自主判断。

### `voice_modify` 对象属性

| 参数名 | 类型 | 必填 | 范围 | 说明 |
| :--- | :--- | :--- | :--- | :--- |
| `pitch` | integer | 否 | [-100, 100] | 音高调整。接近 -100 声音更低沉；接近 100 声音更明亮。 |
| `intensity` | integer | 否 | [-100, 100] | 强度调整。接近 -100 声音更刚劲；接近 100 声音更轻柔。 |
| `timbre` | integer | 否 | [-100, 100] | 音色调整。接近 -100 声音更浑厚；接近 100 声音更清脆。 |
| `sound_effects` | string | 否 | - | 音效设置，单次仅能选择一种。 |

#### `sound_effects` 可选值
*   `spacious_echo` (空旷回音)
*   `auditorium_echo` (礼堂广播)
*   `lofi_telephone` (电话失真)
*   `robotic` (电音)

## 响应参数

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `task_id` | string | 是 | 异步任务的 ID。请使用此 `task_id` 请求 [查询任务结果 API](/docs/models/reference-get-async-task-result) 以获取生成结果。 |

## 示例

### 1. 提交异步语音合成请求

**请求：**

```bash
curl \
-X POST https://api.ppinfra.com/v3/async/minimax-speech-2.6-turbo \
-H "Authorization: Bearer $your_api_key" \
-H "Content-Type: application/json" \
-d '{
  "text": "近年来，人工智能在国内迎来高速发展期，技术创新与产业应用齐头并进。从基础的大模型研发到语音识别、图像处理、自然语言理解等关键技术突破，AI 正在深度赋能医疗、金融、制造、交通等多个领域。同时，政策支持和资本推动加速了技术落地，众多科技企业、创业团队和科研机构持续投入，形成了活跃的创新生态。AI 正逐步从实验室走向实际生产力，成为推动数字中国建设和经济高质量发展的重要引擎，未来发展潜力巨大。",
  "voice_setting": {
    "speed": 1.1,
    "voice_id": "male-qn-jingying",
    "emotion": "happy"
  }
}'
```

**响应：**

```json
{
    "task_id": "{返回的 Task ID}"
}
```

### 2. 使用 task_id 查询结果

使用上一步获取的 `task_id` 调用 [查询任务结果 API](/docs/models/reference-get-async-task-result)。2xx 状态码表示请求成功，5xx 表示服务器内部错误。

**响应示例：**

```json
{
  "extra": {},
  "task": {
    "task_id": "abb22f2c-e493-4795-b542-f8d7f17e193d",
    "task_type": "MINIMAX_SPEECH_2.6_TURBO",
    "status": "TASK_STATUS_SUCCEED",
    "reason": "",
    "eta": 0,
    "progress_percent": 0
  },
  "images": [],
  "videos": [],
  "audios": [
    {
      "audio_url": "https://faas-minimax-video-1312767721.cos.ap-shanghai.myqcloud.com/test/288778355781984-c70616a1-8e73-43e2-ad2a-6863359f15da.mp3?q-sign-algorithm=sha1&q-ak=AKIDHOHvKVnrgHkyxhCTyOdeSjoiRxGPSJ0V&q-sign-time=1752062752%3B1752066352&q-key-time=1752062752%3B1752066352&q-header-list=host&q-url-param-list=&q-signature=2d1dcc503e1006c824c5220ba5f930ddc4562c1e",
      "audio_url_ttl": "0",
      "audio_type": "mp3",
      "audio_metadata": null
    }
  ]
}
```

生成的音频文件 URL 位于 `audios[0].audio_url` 字段中。