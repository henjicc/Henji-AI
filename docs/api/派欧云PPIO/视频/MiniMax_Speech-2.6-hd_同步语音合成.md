# MiniMax Speech-2.6-hd 同步语音合成

该 API 支持基于文本到语音的同步生成，单次文本传输最大 10000 字符。支持 100+系统音色、复刻音色自主选择；支持音量、语调、语速、输出格式调整；支持按比例混音功能、固定间隔时间控制；支持多种音频规格、格式，包括：mp3, pcm, flac, wav，支持流式输出。

提交长文本语音合成请求后，需要注意的是返回的 url 的有效期为自 url 返回开始的 24 个小时，请注意下载信息的时间。

适用于短句生成、语音聊天、在线社交等场景，耗时短但文本长度限制小于 10000 字符。长文本建议使用 [异步调用语音合成](/docs/models/reference-minimax-speech-2.6-hd-async)。

## 请求头

### Content-Type
*   **类型**: `string`
*   **必需**: 是
*   **枚举值**: `application/json`

### Authorization
*   **类型**: `string`
*   **必需**: 是
*   **描述**: Bearer 身份验证格式，例如：`Bearer {{API 密钥}}`。

## 请求体

### text
*   **类型**: `string`
*   **必需**: 是
*   **描述**: 待合成的文本，长度限制小于 10000 字符，段落切换用换行符替代。（如需要控制语音中间隔时间，在字间增加 `<#x#>`, x 单位为秒，支持 0.01-99.99，最多两位小数）。支持自定义文本与文本之间的语音时间间隔，以实现自定义文本语音停顿时间的效果。需要注意的是文本间隔时间需设置在两个可以语音发音的文本之间，且不能设置多个连续的时间间隔。

### voice_setting
*   **类型**: `object`
*   **必需**: 是

#### speed
*   **类型**: `float`
*   **默认值**: `"1.0"`
*   **范围**: `[0.5, 2]`
*   **描述**: 生成声音的语速，可选，取值越大，语速越快。

#### vol
*   **类型**: `float`
*   **默认值**: `"1.0"`
*   **范围**: `(0, 10]`
*   **描述**: 生成声音的音量，可选，取值越大，音量越高。

#### pitch
*   **类型**: `int`
*   **默认值**: `"0"`
*   **范围**: `[-12, 12]`
*   **描述**: 生成声音的语调，可选，（0 为原音色输出，取值需为整数）。

#### voice_id
*   **类型**: `string`
*   **描述**: 请求的音色编号。与 `timbre_weights` 二选一必填。支持系统音色(id)以及复刻音色（id）两种类型，其中系统音色（ID）如下：
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

#### emotion
*   **类型**: `string`
*   **描述**: 控制合成语音的情绪；当前支持 7 种情绪：高兴，悲伤，愤怒，害怕，厌恶，惊讶，中性；参数范围：`["happy", "sad", "angry", "fearful", "disgusted", "surprised", "neutral"]`

#### latex_read
*   **类型**: `bool`
*   **默认值**: `"false"`
*   **描述**: 控制是否支持朗读 latex 公式，默认为 false。需注意：
    1.  请求中的公式需要在公式的首尾加上`$$`；
    2.  请求中公式若有`""`，需转义成`\"`。
    *   **示例**: 导数的基本公式是 `$$\\frac{d}{dx}(x^n) = nx^{n-1}$$`

#### text_normalization
*   **类型**: `bool`
*   **默认值**: `"false"`
*   **描述**: 该参数支持英语文本规范化，可提升数字阅读场景的性能，但会略微增加延迟。如果未提供，则默认值为 false。

### audio_setting
*   **类型**: `object`

#### sample_rate
*   **类型**: `int`
*   **默认值**: `"32000"`
*   **范围**: `[8000, 16000, 22050, 24000, 32000, 44100]`
*   **描述**: 生成声音的采样率。可选，默认为 32000。

#### bitrate
*   **类型**: `int`
*   **默认值**: `"128000"`
*   **范围**: `[32000, 64000, 128000, 256000]`
*   **描述**: 生成声音的比特率。可选，默认值为 128000。该参数仅对 mp3 格式的音频生效。

#### format
*   **类型**: `string`
*   **默认值**: `"mp3"`
*   **范围**: `[mp3, pcm, flac, wav]`
*   **描述**: 生成的音频格式。默认 mp3。wav 仅在非流式输出下支持。

#### channel
*   **类型**: `int`
*   **默认值**: `"1"`
*   **描述**: 生成音频的声道数。默认 1：单声道，可选：1：单声道，2：双声道。

### pronunciation_dict
*   **类型**: `object`

#### tone
*   **类型**: `list`
*   **描述**: 替换需要特殊标注的文字、符号及对应的注音。替换发音（调整声调/替换其他字符发音），格式如下：`["燕少飞/(yan4)(shao3)(fei1)","达菲/(da2)(fei1)"，"omg/oh my god"]`。声调用数字代替，一声（阴平）为 1，二声（阳平）为 2，三声（上声）为 3，四声（去声）为 4），轻声为 5。

### timbre_weights
*   **类型**: `object[]`
*   **描述**: 与 `voice_id` 二选一必填。

#### voice_id
*   **类型**: `string`
*   **描述**: 请求的音色 id。须和 weight 参数同步填写。

#### weight
*   **类型**: `int`
*   **范围**: `[1, 100]`
*   **描述**: 权重，须与 voice_id 同步填写。最多支持 4 种音色混合，取值为整数，单一音色取值占比越高，合成音色越像。

### stream
*   **类型**: `boolean`
*   **默认值**: `"false"`
*   **描述**: 是否流式。默认 false，即不开启流式。

### stream_options
*   **类型**: `object`

#### exclude_aggregated_audio
*   **类型**: `boolean`
*   **默认值**: `"false"`
*   **描述**: 当本参数设置为 True 时，在流式的最后一个 chunk 中，将不包含拼接后的完整语音 hex 数据。默认为 False，即最后一个 chunk 中包含拼接后的完整语音 hex 数据。

### language_boost
*   **类型**: `string`
*   **默认值**: `"null"`
*   **描述**: 增强对指定的小语种和方言的识别能力，设置后可以提升在指定小语种/方言场景下的语音表现。如果不明确小语种类型，则可以选择 `"auto"`，模型将自主判断小语种类型。支持以下取值：`'Chinese'`, `'Chinese,Yue'`, `'English'`, `'Arabic'`, `'Russian'`, `'Spanish'`, `'French'`, `'Portuguese'`, `'German'`, `'Turkish'`, `'Dutch'`, `'Ukrainian'`, `'Vietnamese'`, `'Indonesian'`, `'Japanese'`, `'Italian'`, `'Korean'`, `'Thai'`, `'Polish'`, `'Romanian'`, `'Greek'`, `'Czech'`, `'Finnish'`, `'Hindi'`, `'auto'`

### output_format
*   **类型**: `string`
*   **默认值**: `"hex"`
*   **描述**: 控制输出结果形式的参数。可选值为 `url` `hex`。默认值为 `hex`。该参数仅在非流式场景生效，流式场景仅支持返回 hex 形式。返回的 url 有效期为 24 小时。

### voice_modify
*   **类型**: `object`
*   **描述**: 声音效果器设置，该参数支持的音频格式：
    *   非流式：mp3, wav, flac
    *   流式：mp3

#### pitch
*   **类型**: `integer`
*   **范围**: `[-100, 100]`
*   **描述**: 音高调整（低沉/明亮），数值接近 -100，声音更低沉；接近 100，声音更明亮。

#### intensity
*   **类型**: `integer`
*   **范围**: `[-100, 100]`
*   **描述**: 强度调整（力量感/柔和），数值接近 -100，声音更刚劲；接近 100，声音更轻柔。

#### timbre
*   **类型**: `integer`
*   **范围**: `[-100, 100]`
*   **描述**: 音色调整（磁性/清脆），数值接近 -100，声音更浑厚；数值接近 100，声音更清脆。

#### sound_effects
*   **类型**: `string`
*   **描述**: 音效设置，单次仅能选择一种，可选值：
    *   `spacious_echo`（空旷回音）
    *   `auditorium_echo`（礼堂广播）
    *   `lofi_telephone`（电话失真）
    *   `robotic`（电音）

## 响应

### audio
*   **类型**: `string`
*   **描述**: 合成后的音频片段，采用 hex 编码，按照输入定义的格式 (`audio_setting.format`) 进行生成（mp3/pcm/flac）。返回形式根据 `output_format` 的定义返回，`stream` 为 true 时只支持 hex 的返回形式。

### status
*   **类型**: `number`
*   **描述**: 当前音频流状态，仅 `stream` 为 true 时返回。1 表示合成中，2 表示合成结束。

## 示例

以下是如何使用 Minimax Speech-2.6-hd 同步请求 API 的示例。

### 1. 非流式（`stream` 为 false）
如果不指定 `output_format` 为 url，默认会以 hex 形式返回。

**请求：**
```bash
curl \
-X POST https://api.ppinfra.com/v3/minimax-speech-2.6-hd \
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

**响应：**
```json
{
  "audio": "https://faas-minimax-video-1312767721.cos.ap-shanghai.myqcloud.com/test/f9dd3abf-a708-4567-9099-db7356f0f77e-4245f063-6985-477b-bfff-c693b85bdba7.mp3?q-sign-algorithm=sha1&q-ak=AKIDHOHvKVnrgHkyxhCTyOdeSjoiRxGPSJ0V&q-sign-time=1752118598%3B1752122198&q-key-time=1752118598%3B1752122198&q-header-list=host&q-url-param-list=&q-signature=12.666eb2e1e54fd26647994fae7edad1f2b12c58"
}
```

### 2. 流式（`stream` 为 true）

**请求：**
```bash
curl \
-X POST https://api.ppinfra.com/v3/minimax-speech-2.6-hd \
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

**响应：**
```
data: {"audio": "fffb98c4d8 ... e12fc5be", "status": 1}
...
data: {"audio": "4944330453 ... 34505005", "status": 1}
...
data: {"audio": "fffb98c45f ... 04f61e30", "status": 1}
...
data: {"status": 2}
```