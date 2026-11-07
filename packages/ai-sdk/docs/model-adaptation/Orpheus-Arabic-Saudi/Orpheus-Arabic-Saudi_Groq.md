# Orpheus Arabic Saudi · Groq

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-11-07 |
| 模态 | 音频（语音合成） |
| 供应商 | Groq（GroqCloud） |
| 项目模型 ID | `groq-orpheus-arabic-saudi`（通用标识 `orpheus-arabic-saudi`） |
| 平台模型 ID | `canopylabs/orpheus-arabic-saudi`（模型卡标注 Preview） |
| 接口形态 | 同步，返回音频二进制 |
| 文档 / 价格可见性 | 公开，无需登录；调用需 Groq API Key（共用 `groq` 密钥） |

## 1. 接入协议

与 [Orpheus V1 English](../Orpheus-V1-English/Orpheus-V1-English_Groq.md) 相同：`POST https://api.groq.com/openai/v1/audio/speech`，Bearer 鉴权，成功返回 wav 二进制，失败返回 `{error:{message,type}}`，无轮询，不支持 Batch。

## 2. 请求参数

| 字段 | 必填 | 说明 |
|---|---|---|
| `model` | 是 | `canopylabs/orpheus-arabic-saudi` |
| `input` | 是 | 沙特方言阿拉伯语文本，**最多 200 字符**；建议使用带变音符号的阿拉伯文；**不支持**方括号语气指令 |
| `voice` | 是 | `abdullah`(男) `fahad`(男) `sultan`(男) `lulwa`(女) `noura`(女) `aisha`(女) |
| `response_format` | 否 | 默认 `wav`，唯一支持 `wav` |

- **冲突记录**：模型卡正文写“four distinct Saudi dialect voices”，但同页最佳实践与 Orpheus 文档音色表都列了 6 个音色；按音色表接 6 个。
- 通用 API Reference 的 `sample_rate` / `speed` / 多格式与专属文档冲突，同英文版处理：不发送。

## 3. 价格

| 来源 | 价格 |
|---|---|
| 模型卡 | **$40.00 / 百万字符**（24,999 字符/$1） |
| Orpheus 文档 Pricing 表 | $40 / 1 million characters |

## 4. 项目适配

- 与英文版分成两个模型：语言、音色清单、价格和语气指令支持都不同，且音色选择器按模型配置音色，不能按版本切换清单。
- 唯一参数：音色（6 个官方音色）；固定 `response_format: "wav"`；超过 200 字符在发请求前拒绝；计价 $0.04/千字符。

## 5. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| Orpheus 文档（参数、音色、价格、限制） | https://console.groq.com/docs/text-to-speech/orpheus | 否 |
| 模型卡（价格） | https://console.groq.com/docs/model/canopylabs/orpheus-arabic-saudi | 否 |
| Text to Speech 总览 | https://console.groq.com/docs/text-to-speech | 否 |
| API Reference（Create speech） | https://console.groq.com/docs/api-reference#audio-speech | 否 |
| 错误码 | https://console.groq.com/docs/errors | 否 |
