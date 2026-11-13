# DeepSeek 语音合成 · DeepSeek

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-11-14 |
| 平台 | DeepSeek 官方 |
| 项目模型 ID | `deepseek-tts`（canonical `deepseek-tts`） |
| API | `POST https://api.deepseek.com/v1/tools/tts`，无 model 字段 |
| 价格 | 刊例 3 元/万计费字符（汉字算 2 个，其余字符算 1 个）；官方限时 5 折，项目按刊例估价 |
| 登录 | 文档与价格公开；调用需 API Key |

## 参数

| 项目参数 | 请求字段 | 说明 |
|---|---|---|
| 文本（通用 prompt/text） | `text` | 必填，≤10,000 计费字符；超出在发请求前拒绝 |
| `deepseekTtsVoice` | `voice_id` | `stella` 海星（女声，默认）/ `tide` 暗潮（男声） |
| — | `format` | 不显示、不发送（默认 wav） |
| — | `filter_markdown` | 不显示、不发送（默认 true，去掉 Markdown 再朗读） |

响应为 `audio/wav` 二进制，执行器转 data URI 交宿主落盘。错误、限速与未接入的 WebSocket 流式合成见 [供应商/DeepSeek.md](../供应商/DeepSeek.md)。

## 原始链接索引

- [语音合成指南](https://api-docs.deepseek.com/zh-cn/guides/tts)（音色、语种、字段表、计费字符规则、错误码）
- [语音合成 API](https://api-docs.deepseek.com/zh-cn/api/tts)（TtsRequest schema）
- [模型与价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)（刊例价与限时折扣）
