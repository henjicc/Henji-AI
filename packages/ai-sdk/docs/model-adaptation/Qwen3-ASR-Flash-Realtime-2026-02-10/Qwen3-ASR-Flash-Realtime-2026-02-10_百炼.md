# Qwen3-ASR-Flash-Realtime-2026-02-10 · 百炼

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-28 |
| 能力 | 实时语音识别（WebSocket，VAD/Manual） |
| 平台模型 ID | `qwen3-asr-flash-realtime-2026-02-10`（最新快照） |
| 地域 | 华北2（北京）、新加坡 |
| 文档/价格 | 公开，无需登录 |

## 1. 协议

`wss://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime?model=qwen3-asr-flash-realtime-2026-02-10`，握手头 `Authorization: Bearer <API Key>`。

连接后接收 `session.created`，首先发 `session.update`；用 `input_audio_buffer.append` 分块追加 Base64 音频。VAD 模式等服务端自动断句；Manual 模式发 `input_audio_buffer.commit`。结束必须发 `session.finish`，等 `session.finished` 后主动断开。

中间文本：`conversation.item.input_audio_transcription.text`；最终文本：`.completed`；失败：`.failed` 或 `error`。该协议不支持会话后复用连接。

## 2. 限制与价格

- `pcm/opus`，8kHz/16kHz，单声道，时长无限制；单个 `append.audio` 最大 15 MiB，实时场景使用小块。
- 多语种及中文方言；支持情感识别，不支持热词和说话人分离。
- 北京原价 0.00033 元/秒；官方列 36,000 秒/10 小时限时免费额度。

## 3. 适配要点

与 Fun-ASR-Realtime 的 `run-task` 协议完全不同，不得仅换 `model` 复用消息序列。用户取消也需关闭本会话 socket，不得等待无限期的最终事件。

## 4. 原始链接索引

| 信息 | 链接 | 登录 |
|---|---|---|
| 模型/音频规格 | https://help.aliyun.com/zh/model-studio/asr-model/ | 否 |
| WebSocket 交互 | https://help.aliyun.com/zh/model-studio/qwen-asr-realtime-interaction-process | 否 |
| 客户端/服务端事件 | https://help.aliyun.com/zh/model-studio/qwen-asr-realtime-client-events ; https://help.aliyun.com/zh/model-studio/qwen-asr-realtime-server-events | 否 |
| 价格 | https://help.aliyun.com/zh/model-studio/model-pricing | 否 |
| API Key | https://bailian.console.aliyun.com/?apiKey=1#/api-key | **是** |
