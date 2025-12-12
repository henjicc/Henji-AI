# MiniMax Speech-2.5-hd-preview 异步语音合成

该 API 支持基于文本到语音的异步生成，单次文本生成传输最大支持 100 万字符，生成的完整音频结果支持异步的方式进行检索。支持 100+系统音色、复刻音色自主选择；支持语调、语速、音量、比特率、采样率、输出格式自主调整。

适用于整本书籍等长文本的语音生成，任务排队耗时可能会较长。短句生成、语音聊天、在线社交等场景，建议使用 [同步调用语音合成](/docs/models/reference-minimax-speech-2.5-hd)。

提交长文本语音合成请求后，返回的 URL 有效期为自 URL 返回开始的 24 小时，请注意及时下载。

## 请求示例

**请求方法:** POST
**请求地址:** `https://api.ppinfra.com/v3/async/minimax-speech-2.5-hd-preview`

**cURL 示例:**
```bash
curl --request POST \
  --url https://api.ppinfra.com/v3/async/minimax-speech-2.5-hd-preview \
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

**响应示例:**
```json
{
  "task_id": "<string>"
}
```

## 请求头

| 参数名 | 类型 | 是否必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `Content-Type` | string | 是 | 固定为 `application/json`。 |
| `Authorization` | string | 是 | Bearer 身份验证格式，例如：`Bearer {{API 密钥}}`。 |

## 请求体

| 参数名 | 类型 | 是否必填 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- | :--- |
| `text` | string | 是 | - | 待合成的文本，限制最长 5 万字符。 |
| `voice_setting` | object | 是 | - | 语音设置。 |
| `audio_setting` | object | 否 | - | 音频设置。 |
| `pronunciation_dict` | object | 否 | - | 发音词典。 |
| `language_boost` | string | 否 | `null` | 增强对指定小语种和方言的识别能力。 |
| `voice_modify` | object | 否 | - | 声音效果器设置，支持音频格式：mp3, wav, flac。 |

### voice_setting 对象属性

| 参数名 | 类型 | 是否必填 | 默认值 | 范围 | 说明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `speed` | number | 否 | 1 | [0.5, 2] | 生成声音的语速，取值越大，语速越快。 |
| `vol` | number | 否 | 1 | (0, 10] | 生成声音的音量，取值越大，音量越高。 |
| `pitch` | number | 否 | 0 | [-12, 12] | 生成声音的语调，0 为原音色输出，取值需为整数。 |
| `voice_id` | string | 是 | - | - | 请求的音色编号。支持系统音色(id)以及复刻音色（id）两种类型。 |
| `emotion` | string | 否 | - | `["happy", "sad", "angry", "fearful", "disgusted", "surprised", "neutral"]` | 控制合成语音的情绪。 |
| `text_normalization` | bool | 否 | false | - | 英语文本规范化，可提升数字阅读场景的性能，但会略微增加延迟。 |

#### voice_id 可选值（系统音色）
*   青涩青年音色：`male-qn-qingse`
*   精英青年音色：`male-qn-jingying`
*   霸道青年音色：`male-qn-badao`
*   青年大学生音色：`male-qn-daxuesheng`
*   少女音色：`female-shaonv`
*   御姐音色：`female-yujie`
*   成熟女性音色：`female-chengshu`
*   甜美女性音色：`female-tianmei`
*   男性主持人：`presenter_male`
*   女性主持人：`presenter_female`
*   男性有声书 1：`audiobook_male_1`
*   男性有声书 2：`audiobook_male_2`
*   女性有声书 1：`audiobook_female_1`
*   女性有声书 2：`audiobook_female_2`
*   青涩青年音色-beta：`male-qn-qingse-jingpin`
*   精英青年音色-beta：`male-qn-jingying-jingpin`
*   霸道青年音色-beta：`male-qn-badao-jingpin`
*   青年大学生音色-beta：`male-qn-daxuesheng-jingpin`
*   少女音色-beta：`female-shaonv-jingpin`
*   御姐音色-beta：`female-yujie-jingpin`
*   成熟女性音色-beta：`female-chengshu-jingpin`
*   甜美女性音色-beta：`female-tianmei-jingpin`
*   聪明男童：`clever_boy`
*   可爱男童：`cute_boy`
*   萌萌女童：`lovely_girl`
*   卡通猪小琪：`cartoon_pig`
*   病娇弟弟：`bingjiao_didi`
*   俊朗男友：`junlang_nanyou`
*   纯真学弟：`chunzhen_xuedi`
*   冷淡学长：`lengdan_xiongzhang`
*   霸道少爷：`badao_shaoye`
*   甜心小玲：`tianxin_xiaoling`
*   俏皮萌妹：`qiaopi_mengmei`
*   妩媚御姐：`wumei_yujie`
*   嗲嗲学妹：`diadia_xuemei`
*   淡雅学姐：`danya_xuejie`
*   Santa Claus：`Santa_Claus`
*   Grinch：`Grinch`
*   Rudolph：`Rudolph`
*   Arnold：`Arnold`
*   Charming Santa：`Charming_Santa`
*   Charming Lady：`Charming_Lady`
*   Sweet Girl：`Sweet_Girl`
*   Cute Elf：`Cute_Elf`
*   Attractive Girl：`Attractive_Girl`
*   Serene Woman：`Serene_Woman`

### audio_setting 对象属性

| 参数名 | 类型 | 是否必填 | 默认值 | 可选值/范围 | 说明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `sample_rate` | number | 否 | 32000 | 8000, 16000, 22050, 24000, 32000, 44100 | 生成声音的采样率。 |
| `bitrate` | number | 否 | 128000 | 32000, 64000, 128000, 256000 | 生成声音的比特率。该参数仅对 mp3 格式的音频生效。 |
| `format` | string | 否 | `mp3` | `mp3`, `pcm`, `flac`, `wav` | 生成的音频格式。wav 仅在非流式输出下支持。 |
| `channel` | number | 否 | 1 | 1, 2 | 生成音频的声道数。1：单声道，2：双声道。 |

### pronunciation_dict 对象属性

| 参数名 | 类型 | 是否必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `tone` | list | 否 | 替换需要特殊标注的文字、符号及对应的注音。格式：`["燕少飞/(yan4)(shao3)(fei1)","达菲/(da2)(fei1)"，"omg/oh my god"]`。声调用数字代替：一声（阴平）为 1，二声（阳平）为 2，三声（上声）为 3，四声（去声）为 4，轻声为 5。 |

### language_boost 可选值
`'Chinese'`, `'Chinese,Yue'`, `'English'`, `'Arabic'`, `'Russian'`, `'Spanish'`, `'French'`, `'Portuguese'`, `'German'`, `'Turkish'`, `'Dutch'`, `'Ukrainian'`, `'Vietnamese'`, `'Indonesian'`, `'Japanese'`, `'Italian'`, `'Korean'`, `'Thai'`, `'Polish'`, `'Romanian'`, `'Greek'`, `'Czech'`, `'Finnish'`, `'Hindi'`, `'auto'`

如果不明确小语种类型，则可以选择 `"auto"`，模型将自主判断。

### voice_modify 对象属性

| 参数名 | 类型 | 是否必填 | 范围 | 说明 |
| :--- | :--- | :--- | :--- | :--- |
| `pitch` | integer | 否 | [-100, 100] | 音高调整（低沉/明亮）。数值接近 -100，声音更低沉；接近 100，声音更明亮。 |
| `intensity` | integer | 否 | [-100, 100] | 强度调整（力量感/柔和）。数值接近 -100，声音更刚劲；接近 100，声音更轻柔。 |
| `timbre` | integer | 否 | [-100, 100] | 音色调整（磁性/清脆）。数值接近 -100，声音更浑厚；接近 100，声音更清脆。 |
| `sound_effects` | string | 否 | - | 音效设置，单次仅能选择一种。 |

#### sound_effects 可选值
*   `spacious_echo`（空旷回音）
*   `auditorium_echo`（礼堂广播）
*   `lofi_telephone`（电话失真）
*   `robotic`（电音）

## 响应参数

| 参数名 | 类型 | 是否必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `task_id` | string | 是 | 异步任务的 task_id。您应该使用该 task_id 请求 [查询任务结果 API](/docs/models/reference-get-async-task-result) 以获取生成结果。 |