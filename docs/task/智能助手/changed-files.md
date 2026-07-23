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

## 第二阶段 · 真实模型验收修复

### 新增

- `src/core/llm/capabilitySmokeCapabilities.ts`、`capabilitySmoke.test.ts`：把真实 smoke 通过项提升为模型静态能力，并覆盖失败项不降级。

### 修改

- `src/core/llm/modelStep.ts`、`capabilitySmoke.ts`：单步能力改用 `none/json/schema`，验证请求显式携带结构化输出模式。
- `electron/main/services/llm/sdk/provider.ts`、`model-step.ts`、`capability-smoke.ts`：按模式映射 `json_object/json_schema`，并使用明确 JSON 提示执行结构化 smoke。
- `electron/main/services/llm/sdk/model-step.test.ts`、`capability-smoke.test.ts`：覆盖 Provider 原生 schema 开关与 smoke 模式透传。
- `src/components/Settings/sections/AgentModelProfilesSection.tsx`：验证成功后同时保存动态结果与实际通过的静态能力。
- `docs/task/智能助手/progress.md`、`decisions.md`、`handoff.md`、`changed-files.md`、`test-report.md`、2.4 任务文件和 `重要记录.md`：同步真实验收问题、修复决策、验证和复验步骤。

## 第三阶段 · 运行时内核已完成

### 新增

- `src/core/assistant/events.ts`、`runtimeContracts.ts`、`toolContracts.ts` 及契约测试：版本化 Agent 事件、运行控制、预算、审批、工具风险/数据分类与网关 DTO。
- `electron/main/services/agent-runtime/runtime.ts`、`electron/main/ipc/agent-runtime.ts`：run 注册表、同 thread 单 active run、renderer 所有权、事件推送和最小控制 IPC。
- `electron/main/services/agent-runtime/runner/*`：唯一 Runner、显式状态机、预算/停止条件、严格事件序号、模型选择、暂停/恢复/审批/取消及单测。
- `electron/main/services/agent-runtime/tools/*`：工具定义、权威注册表、固定网关管线、审批凭证、幂等账本、输入输出限额/脱敏及单测。
- `electron/main/services/agent-runtime/tools/builtin/*`：首批 8 个 MVP frontend/backend 工具，包括能力搜索、导航、模型、可见生成任务和诊断日志。
- `electron/main/services/agent-runtime/context/*`：revision 上下文构建、确定性/模型路由、渐进工具目录、滑窗压缩、脱敏与内存 Artifact offload 及单测。

### 修改

- `electron/main/index.ts`、`electron/main/window.ts`、`electron/main/ipc/assistant.ts`、`registry.ts`：注册 Agent Runtime，收紧主窗口/top frame/origin sender 校验并支持校验前置。
- `electron/preload/index.ts`、`api.d.ts`、`src/commands/assistant.ts`、assistant PAL contract/adapter：暴露 start/cancel/pause/resume/approval/state/event 精确 API。
- `src/core/assistant/hostContracts.ts` 及测试：扩展 query、取消命令、稳定 `NOT_FOUND` 错误与 frontend operation 契约。
- `electron/main/services/assistant/frontend-tool-bridge.ts`、`src/features/assistant/frontendTools/*`：命令/查询统一往返，查询失败稳定回传，补充模型目录/schema 与任务查询。
- `src/workspaces/GenerationWorkspace.tsx`、`visibleGenerationTaskCommand.ts`、`useTaskGeneration.ts`：向 Agent 复用可见生成任务创建/读取/取消，不复制生成业务编排。
- `src/features/assistant/hostContext/hostContext.ts`：发布可用命令与查询目录。
- `src/core/llm/agentProfiles.ts`：抽取可被 Electron 主进程复用的结构化模型选择接口，保持 renderer 类型兼容。
- `docs/task/智能助手/00-任务总览.md`、`重要记录.md`、3.1～3.3 任务文件及五份阶段记录：同步第三阶段实现、验证、决策与交接。

### 自动生成但未纳入改动

- `resources/model-manifest.json`、`resources/progress-seeds.json` 由 `electron:build` 刷新，按仓库规则保持 Git 忽略。
