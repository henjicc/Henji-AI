# Fun-ASR-Realtime-2026-02-28 · 百炼

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-28 |
| 能力 | 实时语音识别（WebSocket） |
| 平台模型 ID | `fun-asr-realtime-2026-02-28`（官方标注的最新快照版） |
| 地域 | 华北2（北京）、新加坡 |
| 文档/价格 | 公开，无需登录 |

## 1. 协议

`wss://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference`，握手头 `Authorization: Bearer <API Key>`。事件顺序：`run-task` → `task-started` → 单声道二进制音频 / `result-generated` → `finish-task` → `task-finished`。客户端生成 UUID `task_id`，每任务唯一。

`task-failed` 后连接不可复用；必须等 `task-finished` 才可开下一任务，完成后空闲 60 秒自动断开。

## 2. 音频、结果与价格

- 格式：`pcm/wav/mp3/opus/speex/aac/amr`；采样率任意；单声道；时长无限制。
- 语言：中文（多方言/口音）、英语、日语。
- 热词：支持。不支持说话人分离和情感识别。
- `result-generated.payload.output.sentence` 含中间/最终文本与时间戳；句末时 `usage.duration` 为计费时长。
- 北京原价：0.00033 元/秒，输出不计费；官方页列 36,000 秒/10 小时限时免费额度（以账号实际为准）。

## 3. 适配要点

与稳定别名 `fun-asr-realtime` 并列保留，不自动改写 ID。两者共用传输实现，但能力元数据和显示名分开注册。取消必须停止送音频、关闭当前 socket，不得把该连接放回池。

## 4. 原始链接索引

| 信息 | 链接 | 登录 |
|---|---|---|
| 模型/音频规格 | https://help.aliyun.com/zh/model-studio/asr-model/ | 否 |
| WebSocket 交互 | https://help.aliyun.com/zh/model-studio/fun-asr-realtime-websocket-api | 否 |
| 客户端/服务端事件 | https://help.aliyun.com/zh/model-studio/fun-asr-client-events ; https://help.aliyun.com/zh/model-studio/fun-asr-server-events | 否 |
| 价格 | https://help.aliyun.com/zh/model-studio/model-pricing | 否 |
| API Key | https://bailian.console.aliyun.com/?apiKey=1#/api-key | **是** |
