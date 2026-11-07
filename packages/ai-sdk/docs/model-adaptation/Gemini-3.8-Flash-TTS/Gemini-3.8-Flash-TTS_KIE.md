# Gemini 3.8 Flash TTS · KIE

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-11-07 |
| 项目模型 | `kie-gemini-3.8-flash-tts`，通用标识 `gemini-3.8-flash-tts`；Lite 见 [Gemini-3.8-Flash-Lite-TTS_KIE.md](../Gemini-3.8-Flash-Lite-TTS/Gemini-3.8-Flash-Lite-TTS_KIE.md) |
| model ID | `google/gemini-3-8-flash-tts` |
| 输出 | WAV（16-bit PCM，24 kHz，单声道） |
| 文档与价格 | 公开，无需登录 |
| 定价 | 输入 $0.35、音频输出 $6.30 每百万 Token（70 / 1260 积分）。**限时价**：模型页注明跟随 Google 促销价，有效期至 2026-12-31，到期后需重新核价 |

## 请求契约

`POST https://api.kie.ai/api/v1/jobs/createTask`，`{model,input}`。与 3.1 的差异：没有 `scene`/`sample_context`；音色表换成 70 个；台词可带逐句 `style`。

| input 字段 | 值与约束 | 项目处理 |
|---|---|---|
| speakers | 必填，`{speaker_id:"Speaker N", voice_name}`；`voice_name` 与 `replica`（声音克隆）互斥，都不传默认 Fola | 单说话人，音色选择器（70 个预设，默认 Fola）；`replica` 不开放 |
| dialogue_turns | 必填，`{speaker_id,text,style?}`；text ≤10000，可含 `<laugh>` 等语气标签；`style` 为 3.8 专属逐句风格描述 | 单句台词；“说话风格”填入 `style` |
| temperature | 0–2，默认 1 | “表现变化” |
| filler_words | 仅两人对话时生效，默认关 | 单说话人，不显示、不请求 |

助手可经隐藏参数 `kieGeminiTtsSpeakers` / `kieGeminiTtsDialogueTurns` 直接传多说话人结构，与 3.1 相同。

## 计价说明

官方按 Token 计费，没有每次价格。项目沿用 3.1 的上限估价方式：按输入 8192、输出 16384 Token 预留，约 $0.1061，标为估算，实际以 KIE 账单为准。

## 事件与失败契约

沿用 [KIE 供应商文档](../供应商/KIE.md) 第 2 节 Market 统一任务契约。官方请求 schema 见 `tests/fixtures/model-requests-2026-11/kie-gemini-3.8-flash-tts.json`；未做付费真网验收。

## 原始链接索引

均公开，无需登录：
- [Gemini 3.8 Flash Text to speech](https://docs.kie.ai/market/google/gemini-3-8-flash-tts.md)
- [模型页（含限时价说明）](https://kie.ai/gemini-3.8-flash-tts)
- [实时价格页](https://kie.ai/pricing)（2026-11-07 核对输入/音频输出两行）
