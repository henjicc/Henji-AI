# Qwen3-ASR-Flash-Realtime · 百炼

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-09-24 |
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

## 4. 服务端事件矩阵（稳定别名与 2026-02-10 快照共用）

2026-09-24 核对官方服务端事件页，字段表构造样本见 `tests/fixtures/bailian/asr-realtime-qwen.json`。ID 和文本均为固定占位；删字段、改类型为测试中的 synthetic-negative，不代表真实供应商响应。

| 事件 | 前置阶段与字段语义 | 迁移 / 输出 | 结束与资源 |
|---|---|---|---|
| `session.created` | opening；服务端默认 session，可含 null 配置 | 发送 update，等待 ready；不输出文字 | 继续 |
| `session.updated` | opening；update 成功确认 | active，通知 started | 继续 |
| `input_audio_buffer.speech_started` | VAD 检测语音；item_id 字符串、audio_start_ms 非负整数 | 已知状态通知，无文本 | 继续 |
| `input_audio_buffer.speech_stopped` | VAD 停止语音；item_id 字符串、audio_end_ms 非负整数 | 已知状态通知，不当作 final | 继续 |
| `input_audio_buffer.committed` | 音频提交确认；item_id 字符串 | 已知通知，不代替识别结果 | 继续 |
| `conversation.item.created` | item 含 input_audio，transcript 固定为 null | 已知通知；item.status=completed 不等于识别完成 | 继续 |
| `conversation.item.input_audio_transcription.text` | active/finishing；text/stash 均为字符串，任一可为空 | 原样 text + stash 作为 partial，不能分别 trim 破坏单词边界 | 继续 |
| `conversation.item.input_audio_transcription.completed` | active/finishing；transcript 字符串 | final；不以未定义的 text 字段替代缺失 transcript | 句终态，仍等待会话结束 |
| `conversation.item.input_audio_transcription.failed` | 某 item 识别失败；error.code/message | provider_task_failed，保留 code，不默认暴露完整 message | 失败并释放 |
| `error` | 任一阶段；服务端或输入错误 | 同上，不能作为空事件忽略 | 失败并释放 |
| `session.finished` | 仅客户端 finish 后；本事件无需 transcript | finishing → finished；使用累计 final，无有效 final 则 invalid_response | 主动断开，不复用 |
| 有名未知事件 | 官方未定义扩展语义 | unknown 警告，不生成完成或文本 | 等待已有协议终态 |
| 缺失 type / 错类型 / 无效必要结果字段 | 不能判定合法事件 | invalid_response，包含实际 model/protocol/阶段 | 失败并释放 |
| 提前断开 / 取消 | 任一未完成阶段；无协议恢复事件 | 断连错误或取消，不当正常完成 | 关闭连接 |

官方展示了 text 空而 stash 非空、以及相反的中间状态，未提供两者同时为空的有效结果示例；本次不据推测放宽该边界。现有 SDK 对有效 final 的要求仍是非空 transcript。状态通知不能掩盖缺失必要状态字段；不把所有未知扩展视为错误。错误诊断仅包含模型、协议、阶段、事件类型与供应商代码，不包含密钥、音频和完整识别/错误正文。

## 5. 原始链接索引

| 信息 | 链接 | 登录 |
|---|---|---|
| 模型/音频规格 | https://help.aliyun.com/zh/model-studio/asr-model/ | 否 |
| WebSocket 交互 | https://help.aliyun.com/zh/model-studio/qwen-asr-realtime-interaction-process | 否 |
| 事件 | https://help.aliyun.com/zh/model-studio/qwen-asr-realtime-client-events ; https://help.aliyun.com/zh/model-studio/qwen-asr-realtime-server-events | 否 |
| 价格 | https://help.aliyun.com/zh/model-studio/model-pricing | 否 |
| API Key | https://bailian.console.aliyun.com/?apiKey=1#/api-key | **是** |
