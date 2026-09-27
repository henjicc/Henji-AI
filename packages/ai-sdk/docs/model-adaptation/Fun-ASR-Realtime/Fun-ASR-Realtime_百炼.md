# Fun-ASR-Realtime · 百炼

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-09-24 |
| 能力 | 实时语音识别（WebSocket） |
| 平台模型 ID | `fun-asr-realtime`（稳定别名，官方当前等同 `fun-asr-realtime-2025-11-07`） |
| 地域 | 华北2（北京）、新加坡 |
| 文档/价格 | 公开，无需登录 |

## 1. 协议与结果

`wss://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference`，握手 `Authorization: Bearer <API Key>`。流程为 `run-task/task-started` → 发二进制音频并接收 `result-generated` → `finish-task/task-finished`。`task_id` 由客户端产生 UUID。

`task-failed` 后 socket 废弃；等 `task-finished` 后可用不同 `task_id` 复用连接，空闲 60 秒自动断开。`result-generated.payload.output.sentence` 提供文本、句末标志和时间戳，句末 `usage.duration` 为计费时长。

官方服务端事件示例明确包含一种合法的空文本中间事件：新句开始时会返回 `sentence_begin=true`、`sentence_end=false`、`text=""`、`words=[]`。客户端应把它当作句子生命周期通知并继续等待，不能报响应无效。相反，`sentence_end=true` 的最终结果仍必须有有效文本；`task-finished` 自身的 `payload` 通常为空，只负责结束任务，也不能覆盖已经累计的最终文本。如果整个任务直到 `task-finished` 都没有任何有效最终文本，SDK 应报 `invalid_response`。

## 2. 能力、限制与价格

- 格式 `pcm/wav/mp3/opus/speex/aac/amr`，采样率任意，单声道，时长无限制。
- 支持多语种及中文方言/口音、热词；不支持说话人分离和情感识别。
- 北京原价 0.00033 元/秒；官方列 36,000 秒/10 小时限时免费额度。

## 3. 适配要点

Say-It 保留该稳定别名与 2026-02-28 快照供用户选择；SDK 不应自行把稳定别名锁定为某快照。空 `sentence_begin` 事件只推进状态，不产生 partial/final；重复 final 只累计一次。取消时主动关闭 socket，密钥和原始音频不记日志。

## 4. 服务端事件矩阵（fun-duplex 家族）

2026-09-24 核对官方服务端事件页。此协议也服务于 `qwen-audio-3.1-asr-flash-streaming`，错误诊断必须标实际模型，不能统一叫 Fun-ASR。样本见 `tests/fixtures/bailian/asr-realtime-fun.json`，0.6.1 真实验证的空中间帧保持原语义。

共享百炼实时驱动在握手发送失败时也返回已归一化的模型/协议/阶段；关闭连接若再次失败，以 `cleanupFailed=true` 补充首个故障，不覆盖原因为原始宿主异常。该边界由 `bailian-realtime-asr.test.ts` 的双故障 Mock 回归保护，同时用于 `fun-duplex` 与 `qwen-realtime`。

| 事件 | 前置阶段与字段语义 | 迁移 / 输出 | 结束与资源 |
|---|---|---|---|
| `task-started` | opening，run-task 已发 | active / started | 继续 |
| `result-generated` 心跳 | sentence.heartbeat=true，官方明确可跳过 | 无文本、无完成迁移 | 继续 |
| `result-generated` 中间帧 | active/finishing；text 字符串、sentence_end=false；仅首帧可有 sentence_begin | 空 text 等待，有文字 partial | 继续 |
| `result-generated` 句终帧 | active/finishing；text 字符串、sentence_end=true | 非空 final，保存时间戳与用量；重复相同 final 不重复累计 | 继续等待任务结束 |
| `task-finished` | finishing；payload 通常空，无须含 text | 使用累计 final；未收到有效 final 则 invalid_response | SDK 关闭；官方允许以新 task_id 复用 |
| `task-failed` | 任一未终止阶段；header.error_code/error_message | provider_task_failed，保留 code，不默认记录完整 message | 关闭，不复用 |
| 缺失事件名、text 或布尔 sentence_end | 不用非空文字掩盖缺失状态；心跳除外 | invalid_response | 失败并释放 |
| 有名未知扩展 | 官方未定义行为 | 脱敏警告，无文本/完成输出 | 等待已知终态 |
| 提前断开 / 取消 | 无最终完成证据 | 断连错误或取消 | 释放连接，不重放计费请求 |

校验不要求中间帧带 sentence_begin，也不要求心跳带文本。合法空中间帧不会被当失败；空 final 和只有 partial 的任务仍不能成功。

## 5. 原始链接索引

| 信息 | 链接 | 登录 |
|---|---|---|
| 模型/音频规格 | https://help.aliyun.com/zh/model-studio/asr-model/ | 否 |
| WebSocket 交互 | https://help.aliyun.com/zh/model-studio/fun-asr-realtime-websocket-api | 否 |
| 事件 | https://help.aliyun.com/zh/model-studio/fun-asr-client-events ; https://help.aliyun.com/zh/model-studio/fun-asr-server-events | 否 |
| 价格 | https://help.aliyun.com/zh/model-studio/model-pricing | 否 |
| API Key | https://bailian.console.aliyun.com/?apiKey=1#/api-key | **是** |
