# Gemini 3.8 Flash-Lite TTS · KIE

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-11-07 |
| 项目模型 | `kie-gemini-3.8-flash-lite-tts`，通用标识 `gemini-3.8-flash-lite-tts` |
| model ID | `google/gemini-3-8-flash-lite-tts` |
| 文档与价格 | 公开，无需登录 |
| 定价 | 输入 $0.35、音频输出 $4.20 每百万 Token（70 / 840 积分）。**限时价**：跟随 Google 促销价，有效期至 2026-12-31，到期后需重新核价 |

## 请求契约

字段、音色表（70 个，默认 Fola）、逐句 `style` 与 [Gemini 3.8 Flash TTS](../Gemini-3.8-Flash-TTS/Gemini-3.8-Flash-TTS_KIE.md) 一致（2026-11-07 对比两份官方 schema），只有 model ID 与输出单价不同。项目两者共用 `catalog/kie/gemini38Tts.ts`。

上限估价按输入 8192、输出 16384 Token 预留，约 $0.0717，实际以 KIE 账单为准。

## 原始链接索引

均公开，无需登录：
- [Gemini 3.8 Flash Lite Text to speech](https://docs.kie.ai/market/google/gemini-3-8-flash-lite-tts.md)
- [模型页（含限时价说明）](https://kie.ai/gemini-3.8-flash-lite-tts)
- [实时价格页](https://kie.ai/pricing)（2026-11-07 核对输入/音频输出两行）
