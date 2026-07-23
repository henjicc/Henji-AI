# 智能助手任务交接

## 当前工作

- 当前阶段：第三阶段 · 运行时内核
- 状态：3.1～3.3 已完成并通过自动化验收
- 下一任务：4.1 侧边栏容器与停靠悬浮拖拽
- 阻塞问题：无代码阻塞

## 下一步

1. 4.1 只负责全局侧边栏容器、停靠/悬浮/拖拽与状态接入，复用第三阶段的 Agent Runtime PAL，不在 UI 重建循环或工具执行逻辑。
2. 4.2 消费 `AgentEvent` 展示对话、模型步骤、工具、审批和终态，并通过 `respondApproval`、pause/resume/cancel 控制现有 Runner。
3. 4.3 复用 `query_diagnostic_events` 和现有日志窗口，不建立新的诊断日志通道。
4. 第二阶段真实 Electron 导航、素材库和模型 capability smoke 仍由用户按既有步骤验收。

## 阻塞与风险

- 未使用真实 API Key 自动发起 capability smoke，避免未经用户确认的外部请求与费用；真实模型能力仍需用户显式验证。
- 2026-07-23 首次 DeepSeek 实测确认 `json_schema` 返回 “This response_format type is unavailable now”；已改为按 `json/schema` 模式映射，修复后真实结果待用户复验。
- `npm run electron:smoke` 捕获用户历史外部媒体 `E:\图片\…\VID_20260630_204459.mp4` 的 `henji-media://` 403；初始加载诊断确认来源，与第二阶段代码无关。
- 2.2 的 UI 动作涉及鼠标和真实长任务，按项目约定只提供步骤，不由自动化代替用户验证。
- 第三阶段尚无用户可直接发起 Agent run 的 UI；真实模型的完整 Runner → 工具 → observation 闭环需在 4.2 接入后由 5.1 验收。
- `ArtifactRef` 当前只在 main 内存中保存，大结果跨重启恢复属于 6.1，不应在第四阶段假设已持久化。
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
