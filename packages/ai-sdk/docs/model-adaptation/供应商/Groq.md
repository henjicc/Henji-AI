# Groq · 供应商基础文档

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-31 |
| 供应商 | GroqCloud（与 xAI Grok 无关） |
| 建议 `providerId` | `groq` |
| Base URL | `https://api.groq.com/openai/v1` |
| 鉴权 | `Authorization: Bearer <GROQ_API_KEY>` |
| 公开能力 | OpenAI 兼容 LLM；同步文件语音转写/英文翻译 |
| 当前 Say-It 默认模型 | `openai/gpt-oss-20b` |
| 文档/价格可见性 | 公开，无需登录；API Key、用量和账单需登录 |

## 1. ASR 协议

Groq Speech-to-Text 使用 OpenAI 形状的同步 HTTP 接口：

```text
POST https://api.groq.com/openai/v1/audio/transcriptions
POST https://api.groq.com/openai/v1/audio/translations
Authorization: Bearer <GROQ_API_KEY>
Content-Type: multipart/form-data
```

`/audio/transcriptions` 输出原语言转写；`/audio/translations` 将音频翻译为英文，仅
`whisper-large-v3` 支持，`whisper-large-v3-turbo` 不支持翻译端点。公开 ASR 文档未提供
WebSocket、SSE 或边传边识别协议；SDK 应按一次请求、一次响应建模。

| 字段 | 要求与官方限制 |
|---|---|
| `file` | 与 `url` 二选一；音频文件 |
| `url` | 与 `file` 二选一；支持普通 URL 和 Base64URL |
| `model` | 必填；当前两个生产模型见下表 |
| `language` | 可选 ISO-639-1 语言码；翻译端点目标语言为英文 |
| `prompt` | 可选，最多 224 tokens |
| `response_format` | `json` / `verbose_json` / `text`，默认 `json` |
| `temperature` | `0..1`，默认且官方建议 `0` |
| `timestamp_granularities[]` | `segment` / `word` / 两者；参数表要求 `verbose_json` |

官方 Speech-to-Text 页存在一处内部冲突：字段表明确说时间戳需
`response_format=verbose_json`，Python 示例注释却写成需 `json`。适配应以字段表和实际
API 验证为准，不把该示例注释当成稳定契约。

## 2. ASR 模型、价格与公开限流

| 模型 ID | 转写 | 英文翻译 | 公开价格 | 官方参考速度 | 官方参考 WER | Free Plan | Developer Plan |
|---|---:|---:|---:|---:|---:|---|---|
| `whisper-large-v3-turbo` | 是 | 否 | `$0.04 / hour` | 216x real-time | 12% | 20 RPM / 2K RPD / 7.2K ASH / 28.8K ASD | 400K ASH / 400 RPM |
| `whisper-large-v3` | 是 | 是 | `$0.111 / hour` | 189x real-time | 10.3% | 20 RPM / 2K RPD / 7.2K ASH / 28.8K ASD | 200K ASH / 300 RPM |

ASH/ASD 分别是每小时/每日可处理的音频秒数。上表 Free Plan 是当前公开的持续性
免费计划基线，不是一次性试用金；实际组织额度可不同，官方要求以登录后 Limits 页为准。
速度和 WER 是官方的模型比较指标，不是对任意网络、语言或音频的延迟/准确率承诺。

## 3. ASR 文件、响应与限制

- 当前公开限制为 Free Tier 最大 25 MB、Developer Tier 最大 100 MB；附件上传最大
  25 MB，更大输入可走 `url`。Groq Models 表对 `whisper-large-v3` 另列 100 MB，但对
  Turbo 的单模型文件大小单元格为 `-`；不应把 100 MB 硬编码为 Turbo 的永久模型属性。
- 支持 `flac/mp3/mp4/mpeg/mpga/m4a/ogg/wav/webm`；多音轨文件只识别第一条音轨。
- 音频最短 0.01 秒，但每次最少按 10 秒计费。服务端会下采样为 16 kHz 单声道。
- 长音频官方建议分块；分块边界、上下文提示和结果拼接需由客户端负责。
- `json` 最小响应包含 `text`；`verbose_json` 可包含 segment/word 时间戳与段级统计。

## 4. ASR 错误与接入复杂度

Groq 通用错误体为 `{ error: { message, type } }`。常见状态包括 400/401/403/404/413/422/429，
Flex 容量不足为 498，调用方取消为 499，服务端错误为 500/502/503；官方明确服务端
错误不计费。429 可读 `retry-after`，所有响应带 rate-limit 响应头。

Say-It/SDK 接入属于低复杂度：标准 Bearer Key + `multipart/form-data` JSON/text 响应，无 HMAC、
无二进制私有帧。客户端仍需负责文件大小校验、长音频分块、`AbortSignal` 下沉和 429/5xx
的受控重试。中国大陆网络可达性、支付方式和 SLA 未在官方文档承诺，本轮也未发起真实请求。

## 5. OpenAI 兼容 LLM 协议

Groq 支持 OpenAI 兼容 Chat Completions：

```text
POST https://api.groq.com/openai/v1/chat/completions
GET  https://api.groq.com/openai/v1/models
GET  https://api.groq.com/openai/v1/models/{model}
```

Chat 请求必填 `model` / `messages`，支持 SSE `stream`、tools、`response_format`、
`max_completion_tokens`、`temperature`、`top_p`、`stop`、`seed`。`n` 只能为 1。
`logprobs/logit_bias/top_logprobs/messages[].name` 不支持，传入会返回 400。

`GET /models` 需 Bearer Key，返回 `object=list` 与 `data[]`；单项包含
`id/object/created/owned_by/active/context_window/public_apps`，单模型查询还可返回
`max_completion_tokens`。动态发现应过滤 `active !== false`，同时保留手动模型 ID 路径。

## 6. GPT-OSS 推理参数与价格

`openai/gpt-oss-20b` 支持 `reasoning_effort=low|medium|high`，默认 `medium`。官方明确
GPT-OSS 20B/120B **不支持 `reasoning_format`**；默认在 assistant message 的 `reasoning`
字段返回推理，可传 `include_reasoning=false` 仅返回答案。`include_reasoning` 与
`reasoning_format` 互斥。

| 项目 | 值 |
|---|---|
| 类型 | Production model |
| 速度 | 约 1000 tokens/s |
| 上下文 | 131,072 tokens |
| 最大输出 | 65,536 tokens |
| Developer Plan 限流 | 250K TPM / 1K RPM |
| 输入价格 | $0.075 / 1M tokens |
| 输出价格 | $0.30 / 1M tokens |

## 7. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| ASR 端点、参数、文件限制、模型比较 | https://console.groq.com/docs/speech-to-text | 否 |
| 可用模型、价格、Developer Plan 限流 | https://console.groq.com/docs/models | 否 |
| Free Plan 限流 | https://console.groq.com/docs/rate-limits | 否 |
| OpenAI 兼容性 | https://console.groq.com/docs/openai | 否 |
| Chat/Models API 参考 | https://console.groq.com/docs/api-reference | 否 |
| Reasoning 参数 | https://console.groq.com/docs/reasoning | 否 |
| 错误码与错误体 | https://console.groq.com/docs/errors | 否 |
| API Key | https://console.groq.com/keys | **是** |
