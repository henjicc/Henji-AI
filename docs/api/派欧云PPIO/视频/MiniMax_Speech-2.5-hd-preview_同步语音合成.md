# MiniMax Speech-2.5-hd-preview 同步语音合成

该 API 支持基于文本到语音的同步生成，单次文本传输最大 10000 字符。支持 100+系统音色、复刻音色自主选择；支持音量、语调、语速、输出格式调整；支持按比例混音功能、固定间隔时间控制；支持多种音频规格、格式，包括：mp3, pcm, flac, wav，支持流式输出。

适用于短句生成、语音聊天、在线社交等场景，耗时短但文本长度限制小于 10000 字符。长文本建议使用 [异步调用语音合成](/docs/models/reference-minimax-speech-2.5-hd-async)。

**注意**：提交长文本语音合成请求后，返回的 url 的有效期为自 url 返回开始的 24 个小时，请注意下载信息的时间。

## 请求示例

**请求方法**: `POST`
**端点**: `https://api.ppinfra.com/v3/minimax-speech-2.5-hd-preview`

**cURL 示例**:
```bash
curl --request POST \
  --url https://api.ppinfra.com/v3/minimax-speech-2.5-hd-preview \
  --header 'Authorization: <authorization>' \
  --header 'Content-Type: application/json' \
  --data '
{
  "text": "<string>",
  "voice_setting": {
    "speed": 1.0,
    "vol": 1.0,
    "pitch": 0,
    "voice_id": "<string>",
    "emotion": "<string>",
    "latex_read": false,
    "text_normalization": false
  },
  "audio_setting": {
    "sample_rate": 32000,
    "bitrate": 128000,
    "format": "mp3",
    "channel": 1
  },
  "pronunciation_dict": {
    "tone": []
  },
  "timbre_weights": [
    {
      "voice_id": "<string>",
      "weight": 50
    }
  ],
  "stream": false,
  "stream_options": {
    "exclude_aggregated_audio": false
  },
  "language_boost": "auto",
  "output_format": "hex",
  "voice_modify": {
    "pitch": 0,
    "intensity": 0,
    "timbre": 0,
    "sound_effects": "<string>"
  }
}
'
```

**响应示例**:
```json
{
  "audio": "<string>",
  "status": 123
}
```

## 请求头

| 参数 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `Content-Type` | string | 是 | 固定为 `application/json`。 |
| `Authorization` | string | 是 | Bearer 身份验证格式，例如：`Bearer {{API 密钥}}`。 |

## 请求体

### `text`
*   **类型**: `string`
*   **必填**: 是
*   **说明**: 待合成的文本，长度限制小于 10000 字符。
*   **格式说明**:
    *   段落切换用换行符替代。
    *   如需控制语音中间隔时间，在字间增加 `<#x#>`，`x` 单位为秒，支持 0.01-99.99，最多两位小数。
    *   **注意**: 文本间隔时间需设置在两个可以语音发音的文本之间，且不能设置多个连续的时间间隔。

### `voice_setting`
*   **类型**: `object`
*   **必填**: 是
*   **说明**: 语音基础设置。

| 参数 | 类型 | 默认值 | 范围/枚举 | 说明 |
| :--- | :--- | :--- | :--- | :--- |
| `speed` | float | `1.0` | `[0.5, 2]` | 生成声音的语速，取值越大，语速越快。 |
| `vol` | float | `1.0` | `(0, 10]` | 生成声音的音量，取值越大，音量越高。 |
| `pitch` | int | `0` | `[-12, 12]` | 生成声音的语调，0 为原音色输出，取值需为整数。 |
| `voice_id` | string | - | - | **与 `timbre_weights` 二选一必填**。请求的音色编号。支持系统音色(id)以及复刻音色（id）两种类型。 |
| `emotion` | string | - | `["happy", "sad", "angry", "fearful", "disgusted", "surprised", "neutral"]` | 控制合成语音的情绪。 |
| `latex_read` | bool | `false` | - | 控制是否支持朗读 latex 公式。<br>**注意**：<br>1. 请求中的公式需要在公式的首尾加上 `$$`。<br>2. 请求中公式若有 `"`，需转义成 `\"`。<br>**示例**：`导数的基本公式是 $$\\frac{d}{dx}(x^n) = nx^{n-1}$$` |
| `text_normalization` | bool | `false` | - | 支持英语文本规范化，可提升数字阅读场景的性能，但会略微增加延迟。 |

**系统音色（ID）列表**:
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

### `audio_setting`
*   **类型**: `object`
*   **必填**: 否
*   **说明**: 音频输出设置。

| 参数 | 类型 | 默认值 | 范围/枚举 | 说明 |
| :--- | :--- | :--- | :--- | :--- |
| `sample_rate` | int | `32000` | `[8000, 16000, 22050, 24000, 32000, 44100]` | 生成声音的采样率。 |
| `bitrate` | int | `128000` | `[32000, 64000, 128000, 256000]` | 生成声音的比特率。**该参数仅对 mp3 格式的音频生效**。 |
| `format` | string | `mp3` | `["mp3", "pcm", "flac", "wav"]` | 生成的音频格式。**注意**: `wav` 仅在非流式输出下支持。 |
| `channel` | int | `1` | `[1, 2]` | 生成音频的声道数。`1`: 单声道，`2`: 双声道。 |

### `pronunciation_dict`
*   **类型**: `object`
*   **必填**: 否
*   **说明**: 发音字典，用于替换需要特殊标注的文字、符号及对应的注音。

| 参数 | 类型 | 说明 |
| :--- | :--- | :--- |
| `tone` | list | 替换发音（调整声调/替换其他字符发音），格式如下：`["燕少飞/(yan4)(shao3)(fei1)","达菲/(da2)(fei1)"，"omg/oh my god"]`<br>**声调用数字代替**：一声（阴平）为 1，二声（阳平）为 2，三声（上声）为 3，四声（去声）为 4，轻声为 5。 |

### `timbre_weights`
*   **类型**: `object[]`
*   **必填**: 否 (与 `voice_id` 二选一必填)
*   **说明**: 音色混合权重设置。最多支持 4 种音色混合，取值为整数，单一音色取值占比越高，合成音色越像。

| 参数 | 类型 | 范围 | 说明 |
| :--- | :--- | :--- | :--- |
| `voice_id` | string | - | 请求的音色 id。须和 `weight` 参数同步填写。 |
| `weight` | int | `[1, 100]` | 权重，须与 `voice_id` 同步填写。 |

### `stream`
*   **类型**: `boolean`
*   **默认值**: `false`
*   **说明**: 是否启用流式输出。默认 `false`，即不开启流式。

### `stream_options`
*   **类型**: `object`
*   **必填**: 否
*   **说明**: 流式输出选项。

| 参数 | 类型 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `exclude_aggregated_audio` | boolean | `false` | 当本参数设置为 `true` 时，在流式的最后一个 chunk 中，将不包含拼接后的完整语音 hex 数据。默认为 `false`，即最后一个 chunk 中包含拼接后的完整语音 hex 数据。 |

### `language_boost`
*   **类型**: `string`
*   **默认值**: `null`
*   **说明**: 增强对指定的小语种和方言的识别能力，设置后可以提升在指定小语种/方言场景下的语音表现。如果不明确小语种类型，则可以选择 `"auto"`，模型将自主判断小语种类型。
*   **支持取值**: `'Chinese'`, `'Chinese,Yue'`, `'English'`, `'Arabic'`, `'Russian'`, `'Spanish'`, `'French'`, `'Portuguese'`, `'German'`, `'Turkish'`, `'Dutch'`, `'Ukrainian'`, `'Vietnamese'`, `'Indonesian'`, `'Japanese'`, `'Italian'`, `'Korean'`, `'Thai'`, `'Polish'`, `'Romanian'`, `'Greek'`, `'Czech'`, `'Finnish'`, `'Hindi'`, `'auto'`

### `output_format`
*   **类型**: `string`
*   **默认值**: `hex`
*   **说明**: 控制输出结果形式的参数。可选值为 `url` 或 `hex`。默认值为 `hex`。<br>**注意**: 该参数仅在非流式场景生效，流式场景仅支持返回 `hex` 形式。返回的 `url` 有效期为 24 小时。

### `voice_modify`
*   **类型**: `object`
*   **必填**: 否
*   **说明**: 声音效果器设置。
*   **支持的音频格式**:
    *   非流式：mp3, wav, flac
    *   流式：mp3

| 参数 | 类型 | 范围 | 说明 |
| :--- | :--- | :--- | :--- |
| `pitch` | integer | `[-100, 100]` | 音高调整（低沉/明亮）。数值接近 -100，声音更低沉；接近 100，声音更明亮。 |
| `intensity` | integer | `[-100, 100]` | 强度调整（力量感/柔和）。数值接近 -100，声音更刚劲；接近 100，声音更轻柔。 |
| `timbre` | integer | `[-100, 100]` | 音色调整（磁性/清脆）。数值接近 -100，声音更浑厚；数值接近 100，声音更清脆。 |
| `sound_effects` | string | - | 音效设置，单次仅能选择一种。<br>**可选值**:<br>`spacious_echo` (空旷回音)<br>`auditorium_echo` (礼堂广播)<br>`lofi_telephone` (电话失真)<br>`robotic` (电音) |

## 响应

### `audio`
*   **类型**: `string`
*   **说明**: 合成后的音频片段，采用 hex 编码，按照输入定义的格式 (`audio_setting.format`) 进行生成（mp3/pcm/flac）。返回形式根据 `output_format` 的定义返回，`stream` 为 `true` 时只支持 `hex` 的返回形式。

### `status`
*   **类型**: `number`
*   **说明**: 当前音频流状态，仅 `stream` 为 `true` 时返回。`1` 表示合成中，`2` 表示合成结束。