# Fun-ASR-Realtime · 百炼

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-28 |
| 能力 | 实时语音识别（WebSocket） |
| 平台模型 ID | `fun-asr-realtime`（稳定别名，官方当前等同 `fun-asr-realtime-2025-11-07`） |
| 地域 | 华北2（北京）、新加坡 |
| 文档/价格 | 公开，无需登录 |

## 1. 协议与结果

`wss://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference`，握手 `Authorization: Bearer <API Key>`。流程为 `run-task/task-started` → 发二进制音频并接收 `result-generated` → `finish-task/task-finished`。`task_id` 由客户端产生 UUID。

`task-failed` 后 socket 废弃；等 `task-finished` 后可用不同 `task_id` 复用连接，空闲 60 秒自动断开。`result-generated.payload.output.sentence` 提供文本、句末标志和时间戳，句末 `usage.duration` 为计费时长。

## 2. 能力、限制与价格

- 格式 `pcm/wav/mp3/opus/speex/aac/amr`，采样率任意，单声道，时长无限制。
- 支持多语种及中文方言/口音、热词；不支持说话人分离和情感识别。
- 北京原价 0.00033 元/秒；官方列 36,000 秒/10 小时限时免费额度。

## 3. 适配要点

Say-It 保留该稳定别名与 2026-02-28 快照供用户选择；SDK 不应自行把稳定别名锁定为某快照。取消时主动关闭 socket，密钥和原始音频不记日志。

## 4. 原始链接索引

| 信息 | 链接 | 登录 |
|---|---|---|
| 模型/音频规格 | https://help.aliyun.com/zh/model-studio/asr-model/ | 否 |
| WebSocket 交互 | https://help.aliyun.com/zh/model-studio/fun-asr-realtime-websocket-api | 否 |
| 事件 | https://help.aliyun.com/zh/model-studio/fun-asr-client-events ; https://help.aliyun.com/zh/model-studio/fun-asr-server-events | 否 |
| 价格 | https://help.aliyun.com/zh/model-studio/model-pricing | 否 |
| API Key | https://bailian.console.aliyun.com/?apiKey=1#/api-key | **是** |
