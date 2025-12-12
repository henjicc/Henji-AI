# MiniMax Speech-2.6-hd 异步语音合成

该 API 支持基于文本到语音的异步生成，单次文本生成传输最大支持 100 万字符，生成的完整音频结果支持异步的方式进行检索。支持 100+系统音色、复刻音色自主选择；支持语调、语速、音量、比特率、采样率、输出格式自主调整。

提交长文本语音合成请求后，需要注意的是返回的 url 的有效期为自 url 返回开始的 24 个小时，请注意下载信息的时间。

适用于整本书籍等长文本的语音生成，任务排队耗时可能会较长。短句生成、语音聊天、在线社交等场景，建议使用 [同步调用语音合成](/docs/models/reference-minimax-speech-2.6-hd)。

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
*   **描述**: 待合成的文本，限制最长 5 万字符。

### voice_setting
*   **类型**: `object`
*   **必需**: 是

#### speed
*   **类型**: `number`
*   **默认值**: `1`
*   **范围**: `[0.5, 2]`
*   **描述**: 生成声音的语速，可选，取值越大，语速越快。

#### vol
*   **类型**: `number`
*   **默认值**: `1`
*   **范围**: `(0, 10]`
*   **描述**: 生成声音的音量，可选，取值越大，音量越高。

#### pitch
*   **类型**: `number`
*   **默认值**: `0`
*   **范围**: `[-12, 12]`
*   **描述**: 生成声音的语调，可选，（0 为原音色输出，取值需为整数）。

#### voice_id
*   **类型**: `string`
*   **描述**: 请求的音色编号。支持系统音色(id)以及复刻音色（id）两种类型，其中系统音色（ID）如下：
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

#### text_normalization
*   **类型**: `bool`
*   **默认值**: `false`
*   **描述**: 该参数支持英语文本规范化，可提升数字阅读场景的性能，但会略微增加延迟。如果未提供，则默认值为 false。

### audio_setting
*   **类型**: `object`

#### sample_rate
*   **类型**: `number`
*   **默认值**: `32000`
*   **范围**: `[8000, 16000, 22050, 24000, 32000, 44100]`
*   **描述**: 生成声音的采样率。可选，默认为 32000。

#### bitrate
*   **类型**: `number`
*   **默认值**: `128000`
*   **范围**: `[32000, 64000, 128000, 256000]`
*   **描述**: 生成声音的比特率。可选，默认值为 128000。该参数仅对 mp3 格式的音频生效。

#### format
*   **类型**: `string`
*   **默认值**: `mp3`
*   **描述**: 生成的音频格式。默认 mp3。可选：`mp3`, `pcm`, `flac`, `wav`。wav 仅在非流式输出下支持。

#### channel
*   **类型**: `number`
*   **默认值**: `1`
*   **描述**: 生成音频的声道数.默认 1：单声道，可选：1：单声道2：双声道

### pronunciation_dict
*   **类型**: `object`

#### tone
*   **类型**: `list`
*   **描述**: 替换需要特殊标注的文字、符号及对应的注音。替换发音（调整声调/替换其他字符发音），格式如下：`["燕少飞/(yan4)(shao3)(fei1)","达菲/(da2)(fei1)"，"omg/oh my god"]`声调用数字代替，一声（阴平）为 1，二声（阳平）为 2，三声（上声）为 3，四声（去声）为 4），轻声为 5。

### language_boost
*   **类型**: `string`
*   **默认值**: `null`
*   **描述**: 增强对指定的小语种和方言的识别能力，设置后可以提升在指定小语种/方言场景下的语音表现。如果不明确小语种类型，则可以选择”auto”，模型将自主判断小语种类型。支持以下取值：`'Chinese', 'Chinese,Yue', 'English', 'Arabic', 'Russian', 'Spanish', 'French', 'Portuguese', 'German', 'Turkish', 'Dutch', 'Ukrainian', 'Vietnamese', 'Indonesian', 'Japanese', 'Italian', 'Korean', 'Thai', 'Polish', 'Romanian', 'Greek', 'Czech', 'Finnish', 'Hindi', 'auto'`

### voice_modify
*   **类型**: `object`
*   **描述**: 声音效果器设置，该参数支持的音频格式：mp3, wav, flac

#### pitch
*   **类型**: `integer`
*   **范围**: `[-100, 100]`
*   **描述**: 音高调整（低沉/明亮），数值接近 -100，声音更低沉；接近 100，声音更明亮

#### intensity
*   **类型**: `integer`
*   **范围**: `[-100, 100]`
*   **描述**: 强度调整（力量感/柔和），数值接近 -100，声音更刚劲；接近 100，声音更轻柔

#### timbre
*   **类型**: `integer`
*   **范围**: `[-100, 100]`
*   **描述**: 音色调整（磁性/清脆），数值接近 -100，声音更浑厚；数值接近 100，声音更清脆

#### sound_effects
*   **类型**: `string`
*   **描述**: 音效设置，单次仅能选择一种，可选值：
    *   `spacious_echo`（空旷回音）
    *   `auditorium_echo`（礼堂广播）
    *   `lofi_telephone`（电话失真）
    *   `robotic`（电音）

## 响应参数

### task_id
*   **类型**: `string`
*   **必需**: 是
*   **描述**: 异步任务的 task_id。您应该使用该 task_id 请求 [查询任务结果 API](/docs/models/reference-get-async-task-result) 以获取生成结果。

## 示例

以下是如何使用 Minimax Speech-2.6-hd 异步请求 API 的示例。

1.  通过向 Minimax Speech-2.6-hd API 发送 POST 请求来生成 task_id。

**请求：**

```bash
curl -X POST https://api.ppinfra.com/v3/async/minimax-speech-2.6-hd \
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

2.  使用 task_id 获取输出音频。
    2xx 范围内的 HTTP 状态码表示请求已成功接受，而 5xx 范围内的状态码表示内部服务器错误。
    您可以在响应的 audios 字段中获取音频 audio_url。

**响应：**

```json
{
  "extra": {},
  "task": {
    "task_id": "64af7aae-6fbe-41ca-87b8-2445fd8dba4a",
    "task_type": "MINIMAX_SPEECH_2.6_HD",
    "status": "TASK_STATUS_SUCCEED",
    "reason": "",
    "eta": 0,
    "progress_percent": 0
  },
  "images": [],
  "videos": [],
  "audios": [
    {
      "audio_url": "https://faas-minimax-video-1312767721.cos.ap-shanghai.myqcloud.com/test/288760077820325-fd8778e1-22f1-441e-b65c-5523720e55e4.mp3?q-sign-algorithm=sha1&q-ak=AKIDHOHvKVnrgHkyxhCTyOdeSjoiRxGPSJ0V&q-sign-time=1752052448%3B1752056048&q-key-time=1752052448%3B1752056048&q-header-list=host&q-url-param-list=&q-signature=fa6c73418a10aadcdec434cadcf2242af65fc170",
      "audio_url_ttl": "0",
      "audio_type": "mp3",
      "audio_metadata": null
    }
  ]
}
```

**音频文件：**
[示例音频](https://static-ppinfra-com-1312767721.cos.ap-shanghai.myqcloud.com/docs/assets/minimax-speech-2.6-hd-result.mp3)