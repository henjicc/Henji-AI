# 智能助手改动文件记录

## 第一阶段 · 已完成

### 新增

- `docs/task/智能助手/progress.md`：阶段进度记录。
- `docs/task/智能助手/decisions.md`：阶段决策记录。
- `docs/task/智能助手/handoff.md`：阶段交接记录。
- `docs/task/智能助手/changed-files.md`：改动文件记录。
- `docs/task/智能助手/test-report.md`：验证记录。
- `docs/task/智能助手/任务/第一阶段-架构与方案定稿/架构说明.md`：Harness、宿主契约、AgentEvent、网关、状态机与进程边界。
- `docs/task/智能助手/任务/第一阶段-架构与方案定稿/工具清单.md`：MVP、画布与全能力工具目录及权限分级。
- `docs/task/智能助手/任务/第一阶段-架构与方案定稿/提示词与上下文方案.md`：系统提示、路由、上下文、预算、压缩与 offload。
- `docs/task/智能助手/任务/第一阶段-架构与方案定稿/安全边界与威胁模型.md`：信任边界、威胁、控制和测试映射。

### 修改

- `docs/task/智能助手/00-任务总览.md`：第一阶段与 1.1～1.4 标记已完成，完成数量更新为 4。
- `docs/task/智能助手/重要记录.md`：新增记录 009～010。
- `docs/task/智能助手/任务/第一阶段-架构与方案定稿/1.1-整体架构与执行框架定稿.md`：验收项与执行记录。
- `docs/task/智能助手/任务/第一阶段-架构与方案定稿/1.2-工具能力清单与权限分级.md`：验收项与执行记录。
- `docs/task/智能助手/任务/第一阶段-架构与方案定稿/1.3-提示词与上下文工程方案.md`：验收项与执行记录。
- `docs/task/智能助手/任务/第一阶段-架构与方案定稿/1.4-安全边界与威胁模型.md`：验收项与执行记录。
- `docs/task/智能助手/progress.md`、`decisions.md`、`handoff.md`、`changed-files.md`、`test-report.md`：阶段结束状态。

### 未修改

- 无业务代码、依赖、生成资源或构建配置改动。

## 第二阶段 · 实现完成，待用户手动验收

### 新增

- `src/stores/navigationStore.ts`、`navigationStore.test.ts`：全局导航/工具箱状态、素材库联动与非 React 命令。
- `src/core/assistant/hostContracts.ts`、`hostContracts.test.ts`：HostContext、HostCommand/Query 与 frontend 往返 Zod 契约。
- `src/features/assistant/hostContext/hostContext.ts`：renderer session、全局与 scope revision 快照。
- `src/features/assistant/frontendTools/hostCommandRegistry.ts`、`hostQueryRegistry.ts`、`useAssistantHostBridge.ts` 及测试：声明式宿主命令/查询和 renderer 执行桥。
- `src/commands/assistant.ts`、`src/platform/contracts/assistant.ts`、`src/platform/adapters/electron/assistant.ts`：助手 PAL/命令入口。
- `electron/main/ipc/assistant.ts`、`electron/main/services/assistant/frontend-tool-bridge.ts`：main 侧 ack/result/cancel、超时、幂等、重载和 context 缓存。
- `src/workspaces/GenerationWorkspace/application/generationTaskUtils.ts`、`visibleGenerationTaskCommand.ts`：UI 与 Agent 共用的可见生成任务完整编排。
- `src/core/llm/modelStep.ts`：自有单步模型 DTO 与事件/结果 schema。
- `electron/main/services/llm/sdk/provider.ts`、`model-step.ts`、`runtime.ts` 及测试：AI SDK Provider、单步流、usage、取消、错误和日志。
- `src/core/llm/capabilitySmoke.ts`、`electron/main/services/llm/sdk/capability-smoke.ts` 及测试：真实模型能力验证契约与执行器。
- `src/core/llm/agentProfiles.ts`、`agentProfiles.test.ts`：模型角色继承、静态/动态能力判断和 fallback。
- `src/components/Settings/sections/AgentModelProfilesSection.tsx`：智能助手模型角色、策略与验证状态 UI。
- `src/components/Settings/sections/LlmModelDialog.tsx`：拆出的模型能力编辑对话框。
- `src/services/llm/LlmConfigService.test.ts`：旧配置迁移与默认档案测试。

### 修改

- `package.json`、`package-lock.json`：锁定 `ai@6.0.234`、`@ai-sdk/openai-compatible@2.0.62`、`zod@4.4.3`。
- `src/App.tsx`、`AssetLibraryWorkspace.tsx`、`ToolboxWorkspace.tsx`、`src/core/types/workspace.ts`：接入导航单一状态源与宿主桥。
- `useTaskGeneration.ts`：复用可见生成应用命令，移除重复业务编排。
- `electron/main/index.ts`、`electron/preload/index.ts`、`electron/preload/api.d.ts`：注册助手/LLM IPC 与窄 preload 白名单。
- `electron/main/ipc/llm-runtime.ts`、`src/commands/llmRuntime.ts`、LLM PAL contract/adapter：暴露单步调用与能力验证。
- `src/core/llm/types.ts`、`defaults.ts`：扩展能力表、Agent Profile 与默认配置。
- `src/services/llm/LlmConfigService.ts`、`llmDiscoveryService.ts`：兼容迁移、能力归一化与默认模型能力。
- `src/components/Settings/sections/LlmSettingsSection.tsx`：挂载智能助手档案并拆分模型对话框。
- `src/platform/contracts/index.ts`、`src/platform/adapters/electron/index.ts`：注册 assistant PAL。
- `docs/task/智能助手/00-任务总览.md`、`重要记录.md`、2.1～2.4 任务文件及五份阶段记录：同步第二阶段结果、验证与交接。

### 自动生成但未纳入改动

- `resources/model-manifest.json`、`resources/progress-seeds.json` 由构建刷新，按仓库规则保持 Git 忽略。
