# ElevenLabs Eleven v4（含 v4 Turbo）· Fal

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-11-07 |
| 模态 | 音频（语音合成） |
| 供应商 | fal.ai（聚合平台） |
| 平台模型 ID | `elevenlabs/tts/eleven-v4`、`elevenlabs/tts/eleven-v4-turbo` |
| 痕迹AI 模型 ID | `fal-eleven-v4-tts`（canonical `eleven-v4-tts`），v4 / v4 Turbo 用「版本」切换 |
| 接口形态 | Fal 队列异步 |
| 文档可见性 | 公开，无需登录 |
| 价格可见性 | 公开，无需登录 |

## 1. 请求参数（OpenAPI，2026-11-07 读取；两个端点字段相同）

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `text` | string | 是 | — | ≤5000 字符；支持 `[whispering]` 等音频标签与 `/…/` 包裹的 IPA 读音 |
| `voice` | string | 否 | `Rachel` | 音色名或音色 ID |
| `stability` | number | 否 | `0.5` | 0–1，越低越有表现力 |
| `similarity_boost` | number | 否 | `0.75` | 0–1；未接入 |
| `language_code` | string | 否 | — | ISO 639-1 |
| `apply_text_normalization` | string | 否 | `auto` | `auto`/`on`/`off`；未接入 |
| `timestamps` | boolean | 否 | `false` | 返回逐字时间；未接入 |
| `output_format` | string | 否 | `mp3_44100_128` | 按产品约定不展示、不下发 |

响应：`{ "audio": { "url", ... }, "timestamps": null }`。

## 2. 价格（模型页 publicEndpointBilling，2026-11-07 读取）

| 版本 | 单价 |
|---|---|
| v4 | $0.08 / 千字符 |
| v4 Turbo | $0.04 / 千字符 |

## 3. 适配要点

- 结构照搬 [Eleven v3 · Fal](../TTS-多供应商-2026-09.md) 的参数（音色、稳定度、语言代码），新增「版本」切端点。
- 音色选择器复用 Eleven v3 的预置音色清单，并允许填自定义音色 ID。
- 文本超过 5000 字符在发请求前拒绝。

## 4. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| v4 schema | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=elevenlabs/tts/eleven-v4 | 否 |
| v4 Turbo schema | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=elevenlabs/tts/eleven-v4-turbo | 否 |
| v4 价格 | https://fal.ai/models/elevenlabs/tts/eleven-v4 | 否 |
| v4 Turbo 价格 | https://fal.ai/models/elevenlabs/tts/eleven-v4-turbo | 否 |
