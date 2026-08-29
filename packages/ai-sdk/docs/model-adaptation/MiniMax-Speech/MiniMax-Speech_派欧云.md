# MiniMax Speech · 派欧云 PPIO

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-30 |
| 模态 | 音频（语音合成 + 声音克隆） |
| 供应商 | 派欧云 PPIO |
| 平台路由 | `/v3/[async/]minimax-speech-2.8-{hd,turbo}`、`/v3/minimax-voice-cloning` |
| 接口形态 | 同步与异步双版本；声音克隆为同步 |
| 文档可见性 | 公开，无需登录 |
| 价格可见性 | 公开，无需登录 |

供应商公共协议见 [供应商/派欧云.md](../供应商/派欧云.md)。

## 1. 能力与价格

| 接口 | 路由 | 价格 |
|---|---|---|
| Speech 2.8 HD 同步 | `POST /v3/minimax-speech-2.8-hd` | ¥3.5 / 万字符 |
| Speech 2.8 HD 异步 | `POST /v3/async/minimax-speech-2.8-hd` | ¥3.5 / 万字符 |
| Speech 2.8 Turbo 同步 | `POST /v3/minimax-speech-2.8-turbo` | ¥2.0 / 万字符 |
| Speech 2.8 Turbo 异步 | `POST /v3/async/minimax-speech-2.8-turbo` | ¥2.0 / 万字符 |
| 声音克隆 | `POST /v3/minimax-voice-cloning` | **¥9.9 / 音色**（试听另计） |

定价页还列着 `MiniMax speech-2.6-hd` ¥3.5/万字符 与 `speech-2.6-turbo` ¥2/万字符，说明 **2.6 仍在售**，但文档站已不再提供 2.6 的 API 参考页，**路由无法确认**（PPIO 对所有未知路径统一返回 400，无法靠探测区分）。

计费字符数以响应里的 `extra_info.usage_characters` 为准。PPIO 公开商品注册表给出的结算表达式为 `(单价 × 字符数 + 999999) / 1000000`，即每次请求按实际字符费**向上取整到人民币分**；不能只做“最低 ¥0.01”而保留分以下的小数。

## 2. 声音克隆 `/v3/minimax-voice-cloning`

### `model` 字段枚举（已核实）

```
speech-2.6-hd | speech-2.6-turbo | speech-2.8-hd | speech-2.8-turbo
```

> ⚠️ **该文档页底部的 curl 示例里写的是 `"model": "speech-01-hd"`，那是 PPIO 没同步更新的过期示例，不要照抄。** 以正文参数表的枚举为准。曾有一次排查因为参照了含旧示例的过期资料，误判项目代码写错——项目当前的 4 个枚举值是正确的。

### 参数

| 字段 | 类型 | 必填 | 默认 | 约束 |
|---|---|---|---|---|
| `audio_url` | string | ✅ | — | mp3/m4a/wav；时长 10 秒 ~ 5 分钟；≤20MB |
| `clone_prompt` | object | | — | `{ prompt_audio_url 必填（示例音频 <8s）, prompt_text 必填（对应文本，句末需有标点）}`，提升音色相似度与稳定性 |
| `text` | string | | — | 复刻试听文本，≤2000 字符 |
| `model` | string | 传 `text` 时必填 | — | 上述 4 个枚举值 |
| `accuracy` | float | | `0.7` | 文本校验准确率阈值 `[0, 1]` |
| `need_noise_reduction` | boolean | | `false` | 降噪 |
| `need_volume_normalization` | boolean | | `false` | 音量归一化 |

响应：`{ demo_audio_url, voice_id }`

### 两个业务硬约束

1. ⚠️ **仅个人认证 / 企业认证用户可调用**（需实名认证）
2. ⚠️ **复刻出的是临时音色，必须在 168 小时（7 天）内在任意 T2A 合成接口中实际使用一次（试听不算），否则音色被删除**

### 计费

¥9.9 / 音色。**试听单独计费**——文档明确写「试听将根据字符数正常收取语音合成费用，定价与 T2A 各接口一致」，即传了 `text` 会额外按 HD ¥3.5/万字符或 Turbo ¥2/万字符扣费。试听字符费也按单次请求向上取整到分，再与 ¥9.9 音色费相加；例如 Turbo 60 字符原始金额 ¥0.012，实际计为 ¥0.02，总计 ¥9.92。

## 3. 语音合成（同步）

**模型版本在路由里，请求体没有 `model` 字段。**

| 字段 | 类型 | 必填 | 默认 | 约束 |
|---|---|---|---|---|
| `text` | string | ✅ | — | < 10000 字符（>3000 建议流式）；支持换行分段、`<#x#>` 停顿标记、语气词标签 |
| `stream` | boolean | | `false` | |
| `output_format` | string | | **`hex`** | `url` / `hex`；仅非流式生效，流式只能 hex；返回的 url 有效期 24 小时 |
| `voice_setting` | object | | — | 见下 |
| `audio_setting` | object | | — | 见下 |
| `voice_modify` | object | | — | `pitch` / `timbre` / `intensity` 各 `[-100, 100]`；`sound_effects` 枚举 `spacious_echo` / `auditorium_echo` / `lofi_telephone` / `robotic`（单次仅一种） |
| `timber_weights` | object[] | | — | 混合音色 `{ weight 必填 integer, voice_id 必填 string }` |
| `subtitle_enable` | boolean | | `false` | |
| `aigc_watermark` | boolean | | `false` | |
| `language_boost` | string | | `null` | 41 个枚举值（`Chinese`、`Chinese,Yue`、`English`、`Japanese`、…、`auto`） |
| `pronunciation_dict` | object | | — | `tone` string[]，如 `["燕少飞/(yan4)(shao3)(fei1)", "omg/oh my god"]` |
| `stream_options` | object | | — | `exclude_aggregated_audio` boolean 默认 false |

### `voice_setting`

| 字段 | 默认 | 约束 |
|---|---|---|
| `voice_id` | — | **必填**；系统音色 / 复刻音色 / 文生音色；用混合音色时置空并改用 `timber_weights` |
| `vol` | `1` | `(0, 10]` |
| `pitch` | `0` | `[-12, 12]` |
| `speed` | `1` | `[0.5, 2]` |
| `emotion` | — | `happy` / `sad` / `angry` / `fearful` / `disgusted` / `surprised` / `calm` / `fluent` / `whisper` |
| `latex_read` | `false` | |
| `text_normalization` | `false` | |

> ⚠️ **`emotion` 仅对 `speech-2.6-hd/turbo` 与 `speech-01-hd/turbo` 生效，2.8 系列不支持情绪控制**；其中 `fluent` / `whisper` 仅 2.6 系列生效。项目当前只接了 2.8 路由，因此**情绪参数在当前配置下是无效的**，参数面板不应展示。

### `audio_setting`

| 字段 | 默认 | 约束 |
|---|---|---|
| `format` | `mp3` | `mp3` / `pcm` / `flac` / `wav`（wav 仅非流式） |
| `bitrate` | `128000` | `32000` / `64000` / `128000` / `256000`（仅 mp3 生效） |
| `channel` | `1` | `1` / `2` |
| `sample_rate` | `32000` | `8000` / `16000` / `22050` / `24000` / `32000` / `44100` |
| `force_cbr` | `false` | 仅流式 + mp3 生效 |

### 语气词标签（仅 2.8 系列支持）

```
(laughs) (chuckle) (coughs) (clear-throat) (groans) (breath) (pant)
(inhale) (exhale) (gasps) (sniffs) (sighs) (snorts) (burps)
(lip-smacking) (humming) (hissing) (emm) (whistles) (sneezes)
(crying) (applause)
```

### 响应

```json
{
  "data": { "audio": "...", "status": 2, "subtitle_file": "..." },
  "trace_id": "...",
  "base_resp": { "status_code": 0, "status_msg": "success" },
  "extra_info": {
    "usage_characters": 100,
    "audio_length": 1000, "audio_size": 12345, "bitrate": 128000,
    "word_count": 50, "audio_format": "mp3", "audio_channel": 1,
    "audio_sample_rate": 32000, "invisible_character_ratio": 0
  }
}
```

`extra_info.usage_characters` 是**计费字符数**。

## 4. 语音合成（异步）—— 与同步有多处差异

本项目走的是异步路由，以下差异必须注意：

| 差异点 | 同步 | 异步 |
|---|---|---|
| `stream` / `output_format` / `timber_weights` / `subtitle_enable` / `stream_options` | 有 | **没有** |
| `text` 上限 | < 10000 字符 | **5 万字符** |
| `text_file_id` | 无 | **有**，与 `text` 二选一必填；txt <100000 字符 或 zip；zip 内 json 支持 `title`/`content`/`extra` 三字段，三者齐全则产出 3 组共 9 个文件 |
| `voice_setting` | 可选 | **整个 object 必填** |
| `voice_setting` 内字段 | `latex_read` / `text_normalization` | **`english_normalization`**（默认 false） |
| 采样率字段名 | `sample_rate` | **`audio_sample_rate`** |
| `format` 枚举 | mp3/pcm/flac/wav | mp3/pcm/flac/wav/**pcmu_raw**/**pcmu_wav**/**opus** |

- `pcmu_*` 为 G.711 μ-law 8kHz
- `opus` 仅支持采样率 8000/12000/16000/24000/48000，其他值会报错
- ⚠️ `audio_setting.channel` 文档正文写「可选范围 [1,2]，默认值为 1」但 default 标注为 `2`，**文档自相矛盾，建议显式传值**

响应：`{ task_id, details: { usage_characters } }`，再走 `/v3/async/task-result` 取 `audios[].audio_url`。

## 5. 适配要点

- **`emotion` 在 2.8 上不生效**，当前项目只接 2.8 路由，该参数应隐藏或在切到 2.6 时才显示。
- 同步与异步的字段名不同（`sample_rate` vs `audio_sample_rate`、`text_normalization` vs `english_normalization`），不能共用同一个 builder 分支。
- 声音克隆的 168 小时失效规则需要在产品侧提示用户，否则会出现「克隆成功但过几天音色不见了」。
- 声音克隆试听会额外产生 TTS 费用，计价展示应体现 ¥9.9 音色费 + 试听字符费两部分。
- `audio_url` 字段以 `_url` 结尾 → 走 `public-url` 模式，**声音克隆依赖 KIE API Key**。

## 6. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| 声音克隆 | https://ppio.com/docs/models/reference-minimax-voice-cloning | 否 |
| Speech 2.8 HD 同步 | https://ppio.com/docs/models/reference-minimax-speech-2.8-hd | 否 |
| Speech 2.8 HD 异步 | https://ppio.com/docs/models/reference-minimax-speech-2.8-hd-async | 否 |
| Speech 2.8 Turbo 同步 | https://ppio.com/docs/models/reference-minimax-speech-2.8-turbo | 否 |
| Speech 2.8 Turbo 异步 | https://ppio.com/docs/models/reference-minimax-speech-2.8-turbo-async | 否 |
| 定价页（音频 tab） | https://ppio.com/pricing | 否 |
| 模型注册表（含计费表达式） | https://api-server.ppio.com/v1/product/multimodal-model/list?returnSchema=true | 否 |
