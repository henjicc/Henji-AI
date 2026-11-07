# Orpheus V1 English · Groq

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-11-07 |
| 模态 | 音频（语音合成） |
| 供应商 | Groq（GroqCloud） |
| 项目模型 ID | `groq-orpheus-v1-english`（通用标识 `orpheus-v1-english`） |
| 平台模型 ID | `canopylabs/orpheus-v1-english`（模型卡标注 Preview） |
| 接口形态 | 同步，返回音频二进制 |
| 文档 / 价格可见性 | 公开，无需登录；调用需 Groq API Key（与 Groq LLM、语音识别共用 `groq` 密钥） |

## 1. 接入协议

- `POST https://api.groq.com/openai/v1/audio/speech`，`Authorization: Bearer <GROQ_API_KEY>`，`Content-Type: application/json`。
- 成功：HTTP 200，响应体即 wav 音频文件（官方 curl 示例 `--output orpheus-english.wav`）。
- 失败：Groq 通用错误体 `{ "error": { "message", "type" } }`，常见 400/401/403/404/413/422/429，服务端 500/502/503（见 `供应商/Groq.md` §4）。
- 同步接口，无任务 ID、无轮询；不支持 Batch API。

## 2. 请求参数

| 字段 | 必填 | 说明 |
|---|---|---|
| `model` | 是 | `canopylabs/orpheus-v1-english` |
| `input` | 是 | 文本，**最多 200 字符**；可用方括号语气指令，如 `[cheerful]`、`[whisper]`、`[professionally]`，建议 1–2 个词，无穷举清单，模型忽略不认识的指令 |
| `voice` | 是 | `autumn`(女) `diana`(女) `hannah`(女) `austin`(男) `daniel`(男) `troy`(男) |
| `response_format` | 否 | 默认 `wav`，**唯一支持 `wav`** |

- 纯数字会读成英文数词（`203` → two hundred and three），逐位读用连字符 `2-0-3`。
- **冲突记录**：通用 API Reference 的 Create speech 写 `response_format` 默认 mp3、可选 `flac/mp3/mulaw/ogg/wav`，并有 `sample_rate`（默认 48000）与 `speed`（0.5–5）；但其示例仍是已下线的 `playai-tts`。Orpheus 专属文档只列 `model/input/voice/response_format` 且写明只支持 wav。按「模型专属页优先」只发 wav，不发 `sample_rate` / `speed`。

## 3. 价格

| 来源 | 价格 |
|---|---|
| 模型卡 | **$22.00 / 百万字符**（45,454 字符/$1） |
| Orpheus 文档 Pricing 表 | $22 / 1 million characters |

（任务说明里的 $40/百万字符是阿拉伯语版价格；groq.com/pricing 页面正文未列 Orpheus。）

## 4. 项目适配

- Groq 在生成目录新增为供应商 `groq`：SDK provider `providers/groq.ts`（与硅基流动共用 `providers/openai-speech.ts` 的 OpenAI 兼容 `/audio/speech` 执行），密钥复用已有 `groq` 凭据。
- 唯一参数：音色（6 个官方音色，不接受自定义 ID）；请求固定 `response_format: "wav"`。
- 超过 200 字符在发请求前拒绝；计价按 Unicode 字符数 × $0.022/千字符。
- 提示词语言标为英文（`meta.promptLanguage: 'en'`）。
- 未核实：Groq 部分模型首次使用需在控制台接受模型条款，官方 Orpheus 文档未提及，未做专门处理（错误会按通用 HTTP 错误返回）。

## 5. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| Text to Speech 总览 | https://console.groq.com/docs/text-to-speech | 否 |
| Orpheus 文档（参数、音色、价格、限制） | https://console.groq.com/docs/text-to-speech/orpheus | 否 |
| 模型卡（价格） | https://console.groq.com/docs/model/canopylabs/orpheus-v1-english | 否 |
| API Reference（Create speech） | https://console.groq.com/docs/api-reference#audio-speech | 否 |
| 错误码 | https://console.groq.com/docs/errors | 否 |
