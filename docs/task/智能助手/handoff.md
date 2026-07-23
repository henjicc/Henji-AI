# 智能助手任务交接

## 当前工作

- 当前阶段：第四阶段 · 智能助手侧边栏
- 状态：4.1～4.3 实现与自动化验证完成，待真实 Electron 手动验收
- 下一任务：用户验收第四阶段；通过后进入 5.1 首用例端到端联调
- 阻塞问题：无代码阻塞

## 下一步

1. 重启 `npm run electron:dev`，手动验证标题栏助手入口、左右停靠、悬浮拖动、边界约束、收起重开、工作区避让和重启恢复。
2. 使用已通过 capability smoke 的真实模型发起助手对话，核对计划、流式文本、工具/审批卡、usage、暂停/恢复/取消和 taskId 结果跳转。
3. 在运行中刷新 renderer，确认 snapshot 重放不会重复工具且 pending 审批仍可继续；应用级重启恢复不属于本阶段。
4. 从全局错误框和生成失败卡点击“问助手”，分别验证有/无 requestId 的证据引用与置信度表达。
5. 上述通过后进入 5.1，跑通真实“创建可见生成任务 + 读取日志诊断”首用例闭环。

## 阻塞与风险

- 未使用真实 API Key 自动发起 capability smoke，避免未经用户确认的外部请求与费用；真实模型能力仍需用户显式验证。
- 2026-07-23 首次 DeepSeek 实测确认 `json_schema` 返回 “This response_format type is unavailable now”；已改为按 `json/schema` 模式映射，修复后真实结果待用户复验。
- `npm run electron:smoke` 捕获用户历史外部媒体 `E:\图片\…\VID_20260630_204459.mp4` 的 `henji-media://` 403；初始加载诊断确认来源，与第二阶段代码无关。
- 2.2 的 UI 动作涉及鼠标和真实长任务，按项目约定只提供步骤，不由自动化代替用户验证。
- 助手 UI 已可发起真实 run，但没有使用真实 API Key 自动请求 Provider，避免未经用户确认的费用；完整 Runner → 工具 → observation 闭环仍由 5.1 验收。
- 事件历史最多 2000 条、`ArtifactRef` 和活动 run 都只在 main 内存中；renderer 重载可恢复，应用重启/崩溃恢复属于 6.1。
- 诊断入口只保证受限证据读取与表达约束；真实日志质量、Provider 错误覆盖率和诊断效果需在 5.4/6.2 评测校准。
- token/压缩阈值是初始值，后续必须由 5.4/6.2 真实评测校准。

## 必读交付物

- `src/core/assistant/hostContracts.ts`
- `src/features/assistant/frontendTools/hostCommandRegistry.ts`
- `electron/main/services/assistant/frontend-tool-bridge.ts`
- `src/core/llm/modelStep.ts`
- `electron/main/services/llm/sdk/model-step.ts`
- `src/core/llm/agentProfiles.ts`
- `src/core/assistant/events.ts`
- `src/core/assistant/runtimeContracts.ts`
- `src/core/assistant/toolContracts.ts`
- `electron/main/services/agent-runtime/runtime.ts`
- `electron/main/services/agent-runtime/runner/runner.ts`
- `electron/main/services/agent-runtime/tools/gateway.ts`
- `electron/main/services/agent-runtime/context/builder.ts`
- `src/features/assistant/AssistantSidebar.tsx`
- `src/features/assistant/hooks/useAgentRun.ts`
- `src/features/assistant/conversation/agentRunReducer.ts`
- `src/features/assistant/diagnostics/openAssistantDiagnosis.ts`
- `electron/main/services/agent-runtime/diagnostics/query-diagnostic-events.ts`
