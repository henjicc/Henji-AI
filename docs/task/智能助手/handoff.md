# 智能助手任务交接

## 当前工作

- 当前阶段：第四阶段 · 智能助手侧边栏
- 状态：4.1 三轮交互反馈修复与 4.1～4.3 自动化验证完成，待真实 Electron 手动复验
- 下一任务：用户验收第四阶段；通过后进入 5.1 首用例端到端联调
- 阻塞问题：无代码阻塞

## 下一步

1. 在当前 `npm run electron:dev` 窗口中手动复验悬浮标题栏快速/慢速拖动，确认面板贴合指针且没有原先的弹性滞后。
2. 左停靠拖右边缘、右停靠拖左边缘，确认面板文字/卡片和工作区在拖动期间按真实宽度连续重排，没有拉伸变形或整窗卡顿。
3. 悬浮态分别拖右边缘、下边缘和右下角，确认宽、高、双向调整均实时重排；重点观察 Markdown、工具卡和审批卡在拖动中保持清晰，松手前后不跳变。
4. 收起重开、切换三种形态并重启应用，确认最终尺寸和悬浮位置持久化；可选用方向键及 `Shift+方向键` 验证可访问调整。
5. 使用已通过 capability smoke 的真实模型发起助手对话，核对计划、流式文本、工具/审批卡、usage、暂停/恢复/取消和 taskId 结果跳转。
6. 在运行中刷新 renderer，确认 snapshot 重放不会重复工具且 pending 审批仍可继续；应用级重启恢复不属于本阶段。
7. 从全局错误框和生成失败卡点击“问助手”，分别验证有/无 requestId 的证据引用与置信度表达。
8. 上述通过后进入 5.1，跑通真实“创建可见生成任务 + 读取日志诊断”首用例闭环。

## 阻塞与风险

- 未使用真实 API Key 自动发起 capability smoke，避免未经用户确认的外部请求与费用；真实模型能力仍需用户显式验证。
- 2026-07-23 首次 DeepSeek 实测确认 `json_schema` 返回 “This response_format type is unavailable now”；已改为按 `json/schema` 模式映射，修复后真实结果待用户复验。
- `npm run electron:smoke` 捕获用户历史外部媒体 `E:\图片\…\VID_20260630_204459.mp4` 的 `henji-media://` 403；初始加载诊断确认来源，与第二阶段代码无关。
- 2.2 的 UI 动作涉及鼠标和真实长任务，按项目约定只提供步骤，不由自动化代替用户验证。
- 4.1 几何与局部工作区避让已由单测覆盖；尺寸帧只写助手与工作区两个必要 DOM，长对话离屏块跳过布局/绘制，代码路径已消除逐帧根级样式失效和 React/Zustand 重渲染。真实鼠标跟手性、复杂工作区重排和不同 DPI 下的实际感受仍需用户确认。
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
- `src/features/assistant/hooks/useAssistantPanelInteraction.ts`
- `src/features/assistant/hooks/useAgentRun.ts`
- `src/features/assistant/conversation/agentRunReducer.ts`
- `src/features/assistant/diagnostics/openAssistantDiagnosis.ts`
- `electron/main/services/agent-runtime/diagnostics/query-diagnostic-events.ts`
