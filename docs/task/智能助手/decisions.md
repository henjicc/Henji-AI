# 智能助手决策记录

## 已确认决策

### D-001 唯一循环与 AI SDK 边界

- `agent-contract/v1` 由自研 Runner 持有唯一循环、预算、审批、取消、检查点和状态机。
- AI SDK 6 仅负责单步 `streamText/generateText`、原生 tool-call、`Output.object()` 和 actual usage。
- Agent 工具不给 SDK `execute`，不启用多步 `stopWhen`，不使用 `ToolLoopAgent` 自动循环。

### D-002 宿主上下文并发控制

- snapshot 同时使用 `rendererSessionId`、全局 revision 和 navigation/generation/canvas/toolbox/assets scope revision。
- 写工具必须携带明确目标 ID，只比较所声明的 scope；session 或相关 scope 变化返回 `STALE_CONTEXT`。

### D-003 frontend 工具协议

- 固定 request → acknowledged → completed/failed。
- ack 只表示认领；callId、idempotencyKey、deadline 和 resulting revision 共同处理超时、重载与去重。
- ack 后状态未知的写操作不得自动重放。

### D-004 工具权限与审批

- 风险使用 R0～R4：自动、run 内具体 scope、逐次 preview、高风险逐次确认、禁止。
- approval 绑定 run/tool/version/参数摘要/目标/revision/preview/scope/有效期并单次消费。
- 通用 Shell、任意文件、任意网络、通用 IPC、读取凭据和鼠标模拟均为 R4。

### D-005 提示词与上下文

- 系统上下文按 P0～P8 分层；用户附加提示只能表达偏好，不能覆盖产品规则。
- 确定性路由优先，router 只在模糊或跨域输入时调用；activeTools 默认不超过 8 个。
- 单次 primary 输入目标 20k tokens；工具结果超过 8 KiB/100 条/可靠估计 2k tokens 时 offload。
- token/成本权威数据来自 AI SDK usage；价格未知时不显示伪精度。

### D-006 数据分类与跨工具流动

- 数据分为 C0 公开、C1 项目、C2 敏感、C3 秘密。
- 所有外部 observation 均标为 `untrusted_observation`；摘要继承最高数据分类。
- C2 外发必须展示具体字段、目标和用途并逐次确认；C3 永不进入模型、日志或 renderer。

### D-007 MVP 工具边界

- 首批为 8 个工具：能力搜索、工作区切换、模型搜索、模型 schema、创建可见生成任务、读取生成任务、取消生成任务、诊断日志。
- `create_visible_generation_task` 必须抽取 `useTaskGeneration.handleGenerate()` 的完整业务编排，不能直接调用 `GenerationService.generate()`。

### D-008 导航与宿主命令单一入口

- `navigationStore` 是工作区与工具箱子工具的唯一状态源；素材库开合通过稳定命令协调，不在 Agent 中复制 UI 状态。
- renderer 只注册声明式 HostCommand/HostQuery handler；main 通过窄 IPC 发送 request/ack/result/cancel，不导入 renderer store、组件或 Hook。
- 可见生成任务的完整编排抽到应用命令，UI 与未来 Agent 共用同一路径。

### D-009 模型单步与能力验证

- 锁定 `ai@6.0.234`、`@ai-sdk/openai-compatible@2.0.62`、`zod@4.4.3`；SDK adapter 每次只执行一个 `streamText`。
- 静态能力表与动态 capability smoke 同时参与 Agent 模型可用性判断；主模型不合格时仅允许切换到已验证 fallback，否则返回明确设置入口。
- capability smoke 由用户显式触发真实最小请求；记录 token 与延迟，缺少可靠价格时费用固定为 `unknown`。

### D-010 结构化输出模式与能力同步

- `ModelStepCapabilities` 使用 `none/json/schema` 区分不可用、JSON 对象和原生 JSON Schema，不再用单一布尔值混淆两类 Provider 能力。
- AI SDK OpenAI-compatible Provider 仅在 `schema` 模式启用 `supportsStructuredOutputs`；`json` 模式发送 `json_object`，仍由 `Output.object()` 在本地按 schema 解析和校验。
- capability smoke 对未声明/schema 以外的模型先验证 `json` 基线；验证成功的文本、流式、工具、结构化输出和 usage 会提升静态能力，失败项不自动降低用户已有声明。

## 可调参数

- turns、token、offload 和 router 置信阈值是 v1 初值，允许 5.4/6.2 基于评测调优，但不得绕过安全硬限制。
- 并行只读工具在 3.2 完成串行基线和并发测试后才可开放。
