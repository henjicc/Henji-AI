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
