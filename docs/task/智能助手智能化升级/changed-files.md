# 变更文件记录

## 2026-07-24 · 第一阶段开始

- `docs/task/智能助手智能化升级/progress.md`：新增阶段进度入口。
- `docs/task/智能助手智能化升级/decisions.md`：新增阶段决策入口。
- `docs/task/智能助手智能化升级/handoff.md`：新增无历史对话交接入口。
- `docs/task/智能助手智能化升级/changed-files.md`：新增变更索引。
- `docs/task/智能助手智能化升级/test-report.md`：新增统一测试记录。
- `docs/task/智能助手智能化升级/任务/第一阶段-基线与准备/1.1-继承第七阶段手动测试基线.md`：完成原清单存在性与继承完整性核对。
- `docs/task/智能助手智能化升级/任务/第一阶段-基线与准备/1.2-建立智能性基线评测.md`：进入评测基线建设。

## 2026-07-24 · 第一阶段完成

- `electron/main/services/agent-runtime/evaluation/minimal-evaluator.ts`：扩展基线场景、工具序列、成功证据和禁止行为元数据。
- `electron/main/services/agent-runtime/evaluation/regression-cases.ts`：新增七类智能性基线用例。
- `electron/main/services/agent-runtime/evaluation/regression-cases.test.ts`：验证七类基线覆盖和验收元数据完整性。
- `docs/task/智能助手智能化升级/任务/第二阶段-决策与工具执行/*.md`：回填路由、工具、验证和恢复缺陷。
- `docs/task/智能助手智能化升级/任务/第三阶段-上下文与记忆/3.1-分层提示词与上下文运行时.md`：回填长会话目标保持基线。

## 2026-07-24 · 第二阶段开始

- `docs/task/智能助手智能化升级/00-任务总览.md`：切换到第二阶段 2.1。
- `docs/task/智能助手智能化升级/progress.md`：记录第二阶段入口和提交权限限制。
- `docs/task/智能助手智能化升级/decisions.md`：确认新增协议保持向后兼容。
- `docs/task/智能助手智能化升级/handoff.md`：更新交接入口。
- `docs/task/智能助手智能化升级/test-report.md`：记录第二阶段开始前基线。

## 2026-07-24 · 2.1 完成

- `electron/main/services/agent-runtime/context/types.ts`：统一意图和工具域类型，增加候选意图。
- `electron/main/services/agent-runtime/context/router.ts`：合并本地路由策略与合法候选域。
- `electron/main/services/agent-runtime/runner/model-execution.ts`：完整路由 schema 和精简宿主快照输入。
- `electron/main/services/agent-runtime/runner/runner.ts`：向路由模型传递当前宿主快照。
- `electron/main/services/agent-runtime/context/builder.ts`：向主模型披露主意图、候选意图和候选工具域。
- `src/core/assistant/generationPreparation.ts`：模型候选和最终准备结果增加选择证据。
- `src/features/assistant/frontendTools/hostQueryRegistry.ts`：模型搜索结果增加筛选与排除规则上下文。
- `src/core/assistant/events.ts`：放宽跨域计划和活动工具事件上限。
- 对应上下文与生成准备测试同步更新。

## 2026-07-24 · 2.2 完成

- `src/core/assistant/toolContracts.ts`：扩展工具目录语义契约。
- `electron/main/services/agent-runtime/tools/types.ts`：增加可覆盖的工具语义定义。
- `electron/main/services/agent-runtime/tools/registry.ts`：派生语义描述、搜索文本和并行执行元数据。
- `electron/main/services/agent-runtime/context/catalog.ts`：所有路由保留能力发现入口，发现工具优先进入下一轮，并补齐画布节点读取工具。
- `electron/main/services/agent-runtime/runner/tool-call-scheduler.ts`：新增安全批次调度、审批执行、revision 合并和超限失败观察。
- `electron/main/services/agent-runtime/runner/runner.ts`：接入独立调度器并缩减主循环体积。
- `electron/main/services/agent-runtime/runner/tool-call-scheduler.test.ts`：覆盖只读并行与超限调用观察。
- `package.json`：将调度器测试纳入助手评测命令。

## 2026-07-24 · 2.3 与第二阶段完成

- `electron/main/services/agent-runtime/runner/result-verifier.ts`：新增成功证据、生成状态、失败说明和澄清判定。
- `electron/main/services/agent-runtime/runner/result-verifier.test.ts`：覆盖提交态、写入证据、未知副作用与澄清。
- `electron/main/services/agent-runtime/runner/runner.ts`：接入恢复要求、最终验证、验证日志和澄清事件。
- `electron/main/services/agent-runtime/tools/gateway.ts`：统一领域 NOT_FOUND 和权限错误映射。
- `electron/main/services/agent-runtime/tools/gateway.test.ts`：增加错误映射回归。
- `src/core/assistant/events.ts`：增加 VerificationCompleted 与 ClarificationRequired 事件。
- `electron/main/services/agent-runtime/runner/runner.test.ts`：验证完成前产生通过的验证事件。
- `package.json`：将结果验证测试纳入助手评测命令。

## 2026-07-24 · 第一、二阶段最终审计

- `electron/main/services/agent-runtime/runner/approval-waiter.ts`：从 Runner 抽离审批等待、计时和收敛生命周期。
- `electron/main/services/agent-runtime/runner/approval-waiter.test.ts`：覆盖主动处理审批和自动过期两条路径。
- `electron/main/services/agent-runtime/runner/runner.ts`：接入审批等待器并将文件控制到 495 行。
- `package.json`：将审批等待器测试纳入助手专项回归。
- `docs/task/智能助手智能化升级/00-任务总览.md`：清理已经过期的待执行状态。
- `docs/task/智能助手智能化升级/progress.md`、`handoff.md`、`test-report.md`：同步最终测试结果与提交权限限制。

## 2026-07-24 · 第三阶段开始

- `docs/task/智能助手智能化升级/00-任务总览.md`：切换到第三阶段 3.1。
- `docs/task/智能助手智能化升级/progress.md`：记录第三阶段执行顺序与统一手动测试约束。
- `docs/task/智能助手智能化升级/decisions.md`：记录系统消息、摘要存储和记忆召回边界。
- `docs/task/智能助手智能化升级/handoff.md`：更新第三阶段入口。
- `docs/task/智能助手智能化升级/test-report.md`：记录第三阶段开始前自动化基线。

## 2026-07-24 · 3.1 完成

- `src/core/assistant/workingContext.ts`、`events.ts`：新增向后兼容的结构化工作摘要与压缩事件元数据。
- `electron/main/services/agent-runtime/context/`：拆分静态 system、动态来源层、预算选择和结构化压缩入口。
- `electron/main/services/agent-runtime/runner/model-execution.ts`：拒绝普通 messages 中的 system 消息。
- `electron/main/services/agent-runtime/context/*.test.ts`：覆盖分层、注入边界、预算裁剪和工具消息配对。

## 2026-07-24 · 3.2 完成

- `src/core/assistant/workingContext.ts`、`events.ts`：定义工作摘要、步骤、证据、审批、恢复状态和事件元数据。
- `electron/main/services/agent-runtime/runner/working-summary.ts`：由现有事件归约摘要，并在中断、重试、revision 变化和产物失效时重建恢复要求。
- `electron/main/services/agent-runtime/context/compaction.ts`：用结构化摘要替代旧消息摘录，并保留工具调用与结果配对。
- `electron/main/services/agent-runtime/persistence/store.ts`、`runtime.ts`：沿用现有检查点保存摘要，恢复时校验 revision、审批和产物引用。
- `electron/main/services/agent-runtime/runner/recovery-guard.ts`、`tool-call-scheduler.ts`：未知写入副作用确认前禁止继续写入，同领域只读成功观察可解除保护。
- 对应摘要、压缩、恢复保护、持久化和调度测试同步补充。

## 2026-07-24 · 3.3 与第三阶段完成

- `src/core/assistant/memory.ts`、`utilityContracts.ts`：增加分层召回查询、结果解释和 utility RPC 契约。
- `electron/main/services/assistant/memory-relevance.ts`、`memory-store.ts`：按作用域、实体、意图、时效和用户纠正评分，输出命中、排除及截断信息。
- `electron/main/services/agent-runtime/runner/memory-context.ts`：按目标、路由和步骤变化刷新记忆，失败时继续使用上次安全结果。
- `electron/main/agent-utility.ts`、`agent-runtime-manager/manager.ts`：将记忆读取代理回主进程，不让 utility process 直接访问 SQLite。
- `electron/main/services/agent-runtime/context/prompt-layers.ts`、`layer-budget.ts`、`builder.ts`：将相关记忆作为独立不可信层按预算注入。
- `package.json`：将第三阶段新增测试纳入 `test:assistant-eval`。

## 2026-07-24 · 第四阶段开始

- `docs/task/智能助手智能化升级/00-任务总览.md`：切换到第四阶段 4.1。
- `docs/task/智能助手智能化升级/任务/第四阶段-可解释性与持续验收/4.1-执行计划证据与界面可解释性.md`：将任务状态改为进行中。
- `docs/task/智能助手智能化升级/progress.md`、`decisions.md`、`handoff.md`：记录第四阶段入口、界面事实来源和执行顺序。
- `docs/task/智能助手智能化升级/test-report.md`：记录第四阶段开始前自动化基线与统一手动测试约束。

## 2026-07-24 · 4.1 完成与 4.2 开始

- `src/core/assistant/events.ts`、`toolContracts.ts`：增加工具用户可读名称与观察/提交/执行完成语义。
- `src/core/assistant/workingSummaryReducer.ts`、`electron/main/services/agent-runtime/runner/working-summary.ts`：将工作摘要事件归约提取为前后端共享核心。
- `electron/main/services/agent-runtime/tools/registry.ts`、`types.ts`、`builtin/frontend.ts`、`runner/tool-call-scheduler.ts`：从工具定义派生完成语义并写入事件，生成任务明确标记为已提交。
- `src/features/assistant/conversation/`：新增紧凑执行计划和错误呈现，优化工具状态、Markdown 表格、验证证据与恢复下一步。
- `src/features/assistant/hooks/useAgentRun.ts`：按动画帧批量归约实时事件，减少流式输出期间的界面更新次数。
- `src/features/assistant/conversation/*.test.ts*`、对应 Runner/目录测试：覆盖事件回放、提交语义、可读名称、验证和 Markdown 结构。
- `package.json`：将界面回放和 Markdown 测试纳入助手专项回归。

## 2026-07-24 · 4.2 代码完成与待验证

- `electron/main/services/agent-runtime/evaluation/minimal-evaluator.ts`、`minimal-evaluator.test.ts`：增加工具序列/领域、完成语义、证据、澄清、压缩、验证、未知写入重放和可选性能指标判定。
- `electron/main/services/agent-runtime/evaluation/regression-cases.ts`、`regression-coverage-cases.ts`、`regression-cases.test.ts`：补齐智能性基线、领域覆盖和安全门槛，并拆分超长数据文件。
- `electron/main/services/agent-runtime/runner/result-verifier.ts`、`runner-results.ts` 及测试：扩展澄清、结果引用和最终验证证据。
- `electron/main/services/agent-runtime/context/catalog.test.ts`、`runner/tool-call-scheduler.test.ts`、`runner/working-summary.test.ts`：补充计划域、完成语义和共享摘要回归。
- `src/features/assistant/conversation/agentRunReducer.ts`：修正恢复状态为空时的下一步选择，并通过完整前端类型检查。
- `src/core/modelCatalog/generationModelDescriptions.test.ts`：补齐国际化联合类型的测试收窄。
- `src/workspaces/GenerationWorkspace/hooks/useTaskHistory.ts`：历史媒体显示前检查文件并恢复有效授权，失效引用跳过预览并记录告警。
- `scripts/electron-phase4-smoke.cjs`：冒烟错误保留资源来源 URL，提升失败诊断能力。
- `package.json`：扩展助手专项评测入口。
- `docs/task/智能助手智能化升级/`：同步 4.2 待验证状态、最终自动化结果、交接信息和统一手动测试清单。

## 2026-07-25 · 助手请求追踪与日志可视化增强

- `src/core/assistant/trace.ts`、`traceSanitize.ts`：新增追踪契约、双层脱敏、内联凭据清洗、媒体摘要和详情体积控制。
- `src/core/llm/modelStep.ts`、`electron/main/services/agent-runtime/runner/model-execution.ts`、`runner.ts`：为路由和主模型步骤附加轮次、上下文预算、压缩与上下文层报告。
- `electron/main/services/llm/sdk/provider.ts`、`model-step.ts`、`trace.ts`：通过 AI SDK Provider 自定义 fetch 捕获供应商最终请求，汇总最终响应、reasoning、工具调用、Token 和流式过程。
- `electron/main/agent-utility.ts`、`src/core/assistant/utilityContracts.ts`、`electron/main/services/agent-runtime-manager/manager.ts`、`runtime.ts`：新增捕获配置、开始、完成、失败 RPC，并在 utility 异常时标记追踪中断。
- `electron/main/services/agent-runtime/persistence/migrations.ts`、`electron/main/services/logging/agent-trace-store.ts`、`agent-trace-config.ts`、`index.ts`：新增 `agent_model_traces` 表、内存开关、摘要/详情查询、清理、保留和中断恢复。
- `electron/main/ipc/logging.ts`、`electron/preload/index.ts`、`api.d.ts`、`src/platform/contracts/logging.ts`、`src/platform/adapters/electron/logging.ts`、`src/commands/logging.ts`：扩展既有 logging 平台接口。
- `src/features/logs/LogsPanel.tsx`、`eventDisplay.ts`、`assistantTraceUtils.ts`、`components/AssistantTrace*.tsx`：新增事件日志/助手追踪切换、运行与轮次虚拟列表、统计、过滤分页、延迟详情、复制、原始 JSON 和相邻轮次对比。
- `src/core/assistant/traceSanitize.test.ts`、`electron/main/services/llm/sdk/trace.test.ts`、`agent-runtime/runner/model-execution.test.ts`、`logging/agent-trace-store.test.ts`、`src/features/logs/assistantTraceUtils.test.ts`：覆盖请求脱敏、8 MiB 上限、上下文元数据、SQLite 持久化、中断和线性轮次差异。
- `scripts/test-assistant-persistence.cjs`、`electron/main/services/assistant/memory-store.test.ts`：把追踪存储加入 Electron SQLite 专项，并修正记忆检索测试按正式契约传入意图。
- `docs/task/智能助手智能化升级/`：同步本轮决策、进度、交接、变更、验证结果和新增手动测试项。
