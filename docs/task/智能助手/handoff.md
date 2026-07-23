# 智能助手任务交接

## 当前工作

- 已完成阶段：第二阶段 · 宿主可操控化改造（代码与自动化验证）
- 状态：结构化输出兼容修复完成，待用户重新执行真实模型验证
- 下一任务：用户验收通过后进入 3.1 Runner 与事件流骨架
- 阻塞问题：无代码阻塞

## 下一步

1. 用户在真实 Electron 窗口复核四个工作区、素材库工作区/悬浮/Esc/返回来源和工具箱子工具保持状态。
2. 重启 `npm run electron:dev` 后，在设置页重新点击 DeepSeek 的“验证此模型”；确认六项全部通过，且静态摘要自动变为“工具 是 · 结构化 json”。
3. 继续依次验证 primary/router/summarizer/fallback，并确认 smoke 状态、usage、延迟和费用未知展示。
4. 验收通过后，3.1 直接复用 `ModelStepInput/Result`、`selectAgentExecutionModel()`、HostContext 和 frontend bridge，Runner 持有唯一循环。
5. 3.1 必须把 tool calls 返回给网关处理，不给 AI SDK tools 增加 `execute`，也不设置多步 `stopWhen`。

## 阻塞与风险

- 未使用真实 API Key 自动发起 capability smoke，避免未经用户确认的外部请求与费用；真实模型能力仍需用户显式验证。
- 2026-07-23 首次 DeepSeek 实测确认 `json_schema` 返回 “This response_format type is unavailable now”；已改为按 `json/schema` 模式映射，修复后真实结果待用户复验。
- `npm run electron:smoke` 捕获用户历史外部媒体 `E:\图片\…\VID_20260630_204459.mp4` 的 `henji-media://` 403；初始加载诊断确认来源，与第二阶段代码无关。
- 2.2 的 UI 动作涉及鼠标和真实长任务，按项目约定只提供步骤，不由自动化代替用户验证。
- token/压缩阈值是初始值，后续必须由 5.4/6.2 真实评测校准。

## 必读交付物

- `src/core/assistant/hostContracts.ts`
- `src/features/assistant/frontendTools/hostCommandRegistry.ts`
- `electron/main/services/assistant/frontend-tool-bridge.ts`
- `src/core/llm/modelStep.ts`
- `electron/main/services/llm/sdk/model-step.ts`
- `src/core/llm/agentProfiles.ts`
