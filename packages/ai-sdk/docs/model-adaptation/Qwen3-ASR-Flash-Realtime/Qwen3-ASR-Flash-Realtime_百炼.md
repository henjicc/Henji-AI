# Qwen3-ASR-Flash-Realtime · 百炼

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-28 |
| 能力 | 实时语音识别（WebSocket，VAD/Manual） |
| 平台模型 ID | `qwen3-asr-flash-realtime`（稳定别名，官方当前等同 `qwen3-asr-flash-realtime-2025-10-27`） |
| 地域 | 华北2（北京）、新加坡 |
| 文档/价格 | 公开，无需登录 |

## 1. 协议与结果

`wss://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime?model=qwen3-asr-flash-realtime`，Bearer 鉴权。顺序：`session.created` → `session.update` → `input_audio_buffer.append` →（Manual 发 `commit`）→ `session.finish` → `session.finished` 后断开。

中间文本是 `conversation.item.input_audio_transcription.text`，最终文本是 `.completed`，失败是 `.failed/error`。不发 `session.finish` 就直接断开会丢弃未完成 item；会话后不支持复用连接。

## 2. 限制与价格

- `pcm/opus`，8kHz/16kHz，单声道；时长无限制；单个 Base64 `audio` 最大 15 MiB。
- 多语种及中文方言；支持情感识别，不支持热词和说话人分离。
- 北京原价 0.00033 元/秒；官方列 36,000 秒/10 小时限时免费额度。

## 3. 适配要点

稳定别名与 2026-02-10 快照并列注册；不把官方当前指向的 2025-10-27 快照写死到请求构建器。该序列与 Fun-ASR 事件序列分开实现。

## 4. 原始链接索引

| 信息 | 链接 | 登录 |
|---|---|---|
| 模型/音频规格 | https://help.aliyun.com/zh/model-studio/asr-model/ | 否 |
| WebSocket 交互 | https://help.aliyun.com/zh/model-studio/qwen-asr-realtime-interaction-process | 否 |
| 事件 | https://help.aliyun.com/zh/model-studio/qwen-asr-realtime-client-events ; https://help.aliyun.com/zh/model-studio/qwen-asr-realtime-server-events | 否 |
| 价格 | https://help.aliyun.com/zh/model-studio/model-pricing | 否 |
| API Key | https://bailian.console.aliyun.com/?apiKey=1#/api-key | **是** |
