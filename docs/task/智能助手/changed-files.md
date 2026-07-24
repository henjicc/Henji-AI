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

## 第六阶段 · 开始

- 已确定将新增 Agent SQLite migration、持久化服务、运行历史/重试契约、评测数据集、utilityProcess 管理器及 thread/memory 管理。
- 6.3 没有真实第三方工具需求，按任务定义跳过，不新增 MCP 文件或依赖。

## 第六阶段 · 完成

### 新增

- `electron/main/services/agent-runtime/persistence/*`：版本化 migration、run/thread/event/message/checkpoint/artifact/permission audit 持久化与安全重试。
- `src/core/assistant/persistence.ts`、`src/features/assistant/history/*`：运行历史/重试契约与侧边栏入口。
- `src/core/assistant/utilityContracts.ts`、`electron/main/agent-utility.ts`、`electron/main/services/agent-runtime-manager/*`：`agent-utility/v1` 协议、独立 Runner 进程、main RPC、心跳、取消、日志与崩溃恢复。
- `src/core/assistant/memory.ts`、`electron/main/services/assistant/memory-*`、`tools/builtin/memory.ts`、`src/features/assistant/memory/*`：记忆 DTO、隐私策略、SQLite 存储、受控工具与用户管理界面。
- `electron/main/services/agent-runtime/evaluation/regression-cases.ts` 及测试：黄金、历史失败和对抗评测集。
- `scripts/test-assistant-persistence.cjs`、`scripts/run-agent-utility-smoke.cjs` 及 smoke app：Electron ABI 真库测试与 utilityProcess 握手验证。
- `docs/task/智能助手/任务/第六阶段-后续增强/评测集/说明.md`：持续回归数据入口与触发规则。

### 修改

- `electron/main/services/db.ts`、`agent-runtime/runtime.ts`、`runner/*`、`context/*`、`tools/registry.ts`：migration 启动、检查点、落库 artifact、记忆上下文、独立进程代理和可序列化初始状态。
- `electron/main/ipc/agent-runtime.ts`、`assistant.ts`、preload、PAL 与 commands：历史/重试和记忆管理接口。
- `electron/main/index.ts`、`electron.vite.config.ts`、`main-logger.ts`：utility 入口构建、退出回收和既有日志汇聚。
- `AssistantSidebar.tsx`、`useAgentRun.ts`：历史与记忆面板入口、持久化错误反馈。
- `minimal-evaluator.ts`、`package.json`：嵌套参数、安全/日志/费用指标和专用验证脚本。
- 第六阶段 6.1～6.5、总览、实施方案与五份阶段记录：同步实现结果、取消项和最终待验收边界。

## 第七阶段 · 开始

- 已读取 7.1～7.4，准备审计生成、项目/画布、工具箱、3D、分镜、图片编辑和素材领域的稳定语义入口。

## 第七阶段 · 内置能力全面接入实现收口

### 新增

- `electron/main/services/agent-runtime/tools/builtin/frontend-assets.ts`：素材查询、详情、集合、标签、选择、删除等 frontend Agent 工具。
- `electron/main/services/agent-runtime/tools/builtin/frontend-canvas-projects.ts`、`frontend-canvas-mutations.ts`、`frontend-canvas-batch.ts`：画布项目、节点/边变更和批量 plan/preview/commit/undo 工具。
- `electron/main/services/agent-runtime/tools/builtin/frontend-toolbox.ts`、测试：工具箱、3D 工程/对象/镜头、图片编辑 preview/commit、分镜查询 Agent 工具；测试覆盖注册过滤和图片编辑结构校验。
- `electron/main/services/agent-runtime/workflows/definitions.ts`、`service.ts`、`tools.ts`、测试：三个确定性跨工作区工作流及暂停/恢复/取消/补偿。
- `src/core/assistant/generationPreparation.ts` 及测试：生成前模型 schema、参数和联动校验。
- `src/core/assistant/imageEditContracts.ts`：图片编辑操作与标记结构共享契约。
- `src/features/assistant/hostActions.ts`：工具箱、3D、分镜、图片编辑和素材的 renderer 宿主语义动作与受限查询摘要。

### 修改

- `src/core/assistant/hostContracts.ts`：扩展第七阶段项目、工具箱、图片编辑、素材和工作流相关 HostCommand/HostQuery 契约。
- `src/features/assistant/frontendTools/hostCommandRegistry.ts`、`hostQueryRegistry.ts`、`hostContext/hostContext.ts`：接入稳定宿主命令、查询、scope revision 和工作区能力发布。
- `electron/main/services/agent-runtime/tools/builtin/frontend.ts`、`registry.ts`、`context/catalog.ts`、`context/router.ts`、`backend.ts`：注册、渐进发现和权限目录收口。
- `electron/main/agent-utility.ts`：utility 侧注册 frontend proxy 与确定性工作流工具。
- `src/features/canvas/application/agentCanvasActions.ts`、`agentCanvasCatalog.ts`：画布节点目录、参数 schema、持久化与冲突保护。
- `docs/task/智能助手/00-任务总览.md`、7.1～7.4 任务文件、五份阶段记录：同步第七阶段实现、验证结果、决策、交接和手动测试清单。

### 自动生成但未纳入改动

- `resources/model-manifest.json`、`resources/progress-seeds.json`、`out/`：由构建/开发脚本生成，按仓库规则不提交。
- 本阶段只扩展宿主命令、上下文与 Agent adapter；不复制领域业务，不暴露 DOM/ReactFlow/完整 store，不新增鼠标模拟。

### 第七阶段 · 素材编辑工作流绑定修复与最终验证

#### 新增

- `electron/main/services/agent-runtime/tools/builtin/frontend-assets.ts`：新增 `add_asset_to_canvas` 宿主工具，将素材稳定 ID 绑定到画布节点。
- `electron/main/services/agent-runtime/workflows/*`：素材编辑工作流步骤改为先提交素材、再通过 `assetId` 创建真实素材引用节点。

#### 修改

- `electron/main/services/agent-runtime/workflows/definitions.ts`、`service.ts`、`tools.ts`：修正 `asset_edit_to_canvas` 的步骤引用和补偿语义，避免创建没有素材引用的空上传节点。
- `docs/task/智能助手/progress.md`、`decisions.md`、`handoff.md`、`test-report.md`、7.3/7.4 任务记录：补充绑定修复、最终验证结果和手动验收边界。

#### 最终验证

- `npm test -- --run`：80 个测试文件、363 个用例通过；2 个文件、6 个用例按环境跳过。
- `npm run test:assistant-eval`：9 个文件、33 个用例通过。
- `npm run electron:build`、`npm run electron:assistant-utility-smoke`、`git diff --check`：全部通过。

#### 自动生成但未纳入改动

- `resources/model-manifest.json`、`resources/progress-seeds.json`、`out/`：由验证命令生成，按仓库规则保持 Git 忽略。

## 第五阶段 · 手动反馈与架构纠偏

### 新增

- `electron/main/services/ai-runtime/providers/provider-fetch.ts` 及测试：保留安全网络错误码，只重试确定的连接前失败。
- `src/features/assistant/conversation/AssistantMarkdown.tsx`：统一 GFM Markdown 展示与对话排版。

### 修改

- `electron/main/services/agent-runtime/context/router.ts`、`runner/model-execution.ts` 及测试：自然语言意图交由模型理解，本地只映射工具域和安全边界。
- `electron/main/services/agent-runtime/tools/gateway.ts`、`types.ts`、`define-tool.ts` 及测试：新增三种批准方式和每 run 工具调用上限。
- `electron/main/services/agent-runtime/context/builder.ts`、`diagnostics/query-diagnostic-events.ts` 及测试：紧凑诊断证据、限制单次查询，并约束最终诊断表达。
- `electron/main/services/llm/sdk/model-step.ts`、`src/core/llm/modelStep.ts` 及测试：system 提示改用 AI SDK `system` 选项。
- `electron/main/services/ai-runtime/providers/kie.ts`、`runtime.ts`：接入安全网络恢复并保留脱敏后的底层错误码。
- `src/core/assistant/runtimeContracts.ts`、`assistantUiStore.ts`、`useAgentRun.ts`、`AssistantComposer.tsx`：接入批准方式契约、持久化与输入区选择。
- `AssistantConversation.tsx`、`ToolActivityCard.tsx`、`AssistantSidebar.tsx`：紧凑执行轨迹、折叠执行思路、GFM、即时滚动和布局/绘制隔离。
- `hostCommandRegistry.ts`、`tools/builtin/frontend.ts`：创建生成任务只返回 `submitted`，避免把提交误报为生成成功。
- `src/models/kie/seedance-2.0*.model.ts` 及测试：音频默认关闭，只有用户明确开启时才发送 `generate_audio: true`。

## 第五阶段 · 图片生成误路由与能力发现修复

### 新增

- `electron/main/services/agent-runtime/context/catalog.test.ts`：覆盖明确生成工具集合、“KIE 图片生成”多词检索和目录发现后下一轮渐进披露。
- `electron/main/services/agent-runtime/runner/model-execution.ts`：拆出 router/primary 模型请求构建，router 结构只保留分类字段。
- `electron/main/services/agent-runtime/runner/runner-results.ts`：拆出错误序列化、工具消息、结果引用和 scope revision 解析，避免继续膨胀 Runner。

### 修改

- `context/router.ts`、`context/context.test.ts`：扩展照片/插画/视频/音频自然表达，生成路由加入 navigation，router 工具域改由本地策略决定并记录安全失败码。
- `context/catalog.ts`、`tools/registry.ts`：支持相关性检索、权威发现结果记忆和下一轮 active tools 激活。
- `tools/builtin/backend.ts`、`frontend.ts`、`context/builder.ts`：限制真实目录 category，区分模型 query 与内容 prompt，并指示生成工作区未就绪时先切换。
- `runner/runner.ts`：接入目录发现状态和结构化发现日志，同时通过辅助模块降低存量文件体积。
- `package.json`：将能力目录回归纳入 `test:assistant-eval`。

## 第五阶段 · 模型选择描述与偏好补充优化

### 新增

- `src/core/modelCatalog/generationModelDescriptions.ts` 及测试：43 个图片/视频/音频通用模型标识的单点描述目录，并校验 65 个供应商模型引用完整。
- `src/core/assistant/modelPreferences.ts` 及测试：结构化偏好 schema、默认值、增量更新、归一化与提示词载荷。
- `electron/main/services/assistant/model-preferences.ts`：主进程偏好文件读取、写入、重置、打开和结构化日志。
- `electron/main/services/agent-runtime/tools/builtin/model-preferences.ts`：R0 读取与 R2/C1 更新偏好工具。
- `src/components/Settings/sections/AgentModelPreferencesSection.tsx`：策略、供应商、图片/视频/音频模型与说明的设置界面。

### 修改

- `src/models/{fal,kie,modelscope,ppio}/*.model.ts`：65 个供应商模型移除 `meta.description`，新增跨供应商 `canonicalModelId`；其他模型配置不变。
- `src/core/types/ModelDefinition.ts`、`defineModel.ts`、`validators/modelValidator.ts`、`ModelRegistry.ts`：声明、解析并强制校验中央通用模型标识和描述。
- `src/i18n/locales/{zh-CN,en-US}/models-{kie,modelscope,ppio}.json`：删除重复供应商模型描述，保留名称、参数和价格等文案。
- `src/features/assistant/frontendTools/hostQueryRegistry.ts`、Agent 前端工具与上下文：模型搜索/schema 返回通用标识和描述，固定选型优先级及能力硬约束。
- `electron/main/ipc/assistant.ts`、preload、assistant PAL/command、`useAgentRun.ts`：暴露主进程偏好能力并在每次新 run 注入最新偏好。
- `electron/main/services/agent-runtime/context/*`、`runner.ts`、backend 工具注册：新增模型偏好意图、工具域和路由。
- `src/components/Settings/index.tsx`、`tabs/ApiKeysTab.tsx`：新增“智能助手偏好”设置分节。
- `.codex/skills/henji-model-adaptation/**`、`.codex/skills/henji-ai-adaptation-assistant/references/model/**`、`AGENTS.md`、`CLAUDE.md`：同步新模型中央描述检查与引用规则。

### 自动生成但未纳入改动

- `resources/model-manifest.json`、`resources/progress-seeds.json` 由 `electron:build` 刷新，按仓库规则保持 Git 忽略。

## 第五阶段 · 自然语言用户指令与记忆边界调整

### 新增

- `src/core/assistant/userInstructions.ts` 及测试：自然语言用户指令契约、4000 字上限、换行归一化和敏感/规则冲突提示。
- `electron/main/services/assistant/user-instructions.ts`：主进程 Markdown 文件读取、写入、清空、打开和结构化日志；旧结构化偏好不再读取或迁移。
- `electron/main/services/agent-runtime/tools/builtin/user-instructions.ts`：R0 读取与 R2/C1 完整内容更新工具。
- `src/components/Settings/sections/AgentUserInstructionsSection.tsx`：基于统一 PromptEditor 的自然语言设置入口。

### 修改

- `src/commands/assistant.ts`、`src/platform/contracts/assistant.ts`、Electron adapter、preload 与 assistant IPC：将模型偏好 API 替换为用户指令 API。
- `electron/main/ipc/agent-runtime.ts`：每次启动 run 时从主进程权威文件读取最新用户指令，renderer 不再负责注入偏好。
- `electron/main/services/agent-runtime/context/*`、`runner.ts`、backend 工具注册与测试：新增用户指令意图/工具域；P3 在安全与真实能力硬约束下保持高优先级，只自动脱敏秘密信息，目录、工具裁剪、压缩与 offload 渐进上下文策略保持不变。
- `electron/main/services/agent-runtime/tools/security.ts`：补齐 Cookie、客户端密钥、私钥和带空格引号密码等秘密形态脱敏，普通内容不经过摘要式清洗。
- `src/components/Settings/index.tsx`、`tabs/ApiKeysTab.tsx`：设置导航改为“助手用户指令”。
- 提示词与上下文方案、6.5 任务说明和五份阶段记录：明确用户主动指令与助手自动记忆的职责边界。

### 删除/替换

- `src/core/assistant/modelPreferences.ts` 及测试、`electron/main/services/assistant/model-preferences.ts`、`electron/main/services/agent-runtime/tools/builtin/model-preferences.ts`、`AgentModelPreferencesSection.tsx`：由自然语言用户指令链路替代。
- 旧 `model-preferences.json` 的兼容读取和一次性迁移逻辑：开发期彻底抛弃，磁盘遗留文件不参与运行。

## 第四阶段 · 智能助手侧边栏实现完成，待用户手动验收

### 新增

- `src/features/assistant/AssistantSidebar.tsx`、`store/assistantUiStore.ts`：全局单点容器、三种摆放形态、布局偏好与运行引用状态。
- `src/features/assistant/hooks/useAssistantFloatingDrag.ts` 及测试：悬浮拖动、尺寸调整和可视区边界约束。
- `src/features/assistant/hooks/useAgentRun.ts`：run 启动/控制、事件订阅、快照恢复和日志接入。
- `src/features/assistant/conversation/*`：结构化输入、对话、计划、工具、审批、结果、错误和预算状态组件及 reducer 测试。
- `src/features/assistant/results/openAssistantResult.ts`：基于稳定 taskId 的生成结果定位。
- `src/features/assistant/diagnostics/openAssistantDiagnosis.ts` 及测试：错误上下文清洗、诊断目标构造和助手唤起。
- `electron/main/services/agent-runtime/diagnostics/query-diagnostic-events.ts` 及测试：受限日志查询、关联、脱敏、证据编号和递归排除。

### 修改

- `src/App.tsx`、`WindowControls.tsx`、`TabContainer.tsx`、`AssetLibraryFloatingPanel.tsx`：根层挂载、全局入口、停靠避让和叠层规则。
- `src/components/ui/GlobalAlertDialog.tsx`、`src/stores/alertDialogStore.ts`、`TaskCard.tsx`：全局错误/生成失败“问助手”和稳定任务定位标记。
- `src/core/assistant/events.ts`、`runtimeContracts.ts`：计划事件、工具结果引用和 run snapshot 契约。
- `electron/main/services/agent-runtime/runner/*`、`runtime.ts`、`tools/approval.ts`：计划事件、历史重放、renderer 重绑定、审批过期与结果引用。
- `electron/main/services/agent-runtime/context/builder.ts`、`tools/builtin/backend.ts`：诊断输出规则与受限诊断工具工厂接线。
- `electron/main/ipc/agent-runtime.ts`、preload、assistant PAL/command：暴露经 schema 校验的 `getRunSnapshot`。
- `src/index.css`、`tailwind.config.js`：补充 success/warning/danger 语义状态色映射。
- `docs/task/智能助手/00-任务总览.md`、`重要记录.md`、4.1～4.3 任务文件及五份阶段记录：同步第四阶段结果、验证、决策和交接。

### 自动生成但未纳入改动

- `resources/model-manifest.json`、`resources/progress-seeds.json` 由 `electron:build` 刷新，按仓库规则保持 Git 忽略。

## 第四阶段 · 手动验收交互修复

### 新增

- `src/features/assistant/hooks/useAssistantPanelInteraction.ts` 及测试：统一悬浮拖动、三种形态尺寸调整、逐帧视觉更新、可视区约束和键盘操作。

### 修改

- `src/features/assistant/AssistantSidebar.tsx`：拆分定位外壳与开合动画内层；增加左右停靠内侧宽度手柄，以及悬浮右边、下边和右下角缩放手柄。
- `src/App.tsx`、`src/components/TabContainer.tsx`：工作区避让改为消费根级助手宽度变量，缩放期间即时跟随且不触发 App 对话树重渲染。
- `docs/task/智能助手/00-任务总览.md`、`重要记录.md`、4.1 任务文件及五份阶段记录：同步根因、实现、验证结果和手动复验步骤。

### 删除/替换

- `src/features/assistant/hooks/useAssistantFloatingDrag.ts` 及测试：由覆盖拖动与缩放的 `useAssistantPanelInteraction` 替代，消除每次指针移动写 React 状态的旧路径。

### 自动生成但未纳入改动

- `resources/model-manifest.json`、`resources/progress-seeds.json` 由 `electron:build` 刷新，按仓库规则保持 Git 忽略。

## 第四阶段 · 尺寸性能二次修复

### 修改

- `src/features/assistant/hooks/useAssistantPanelInteraction.ts` 及测试：尺寸拖动改为 `scale3d` 合成层预览，增加左右锚点与悬浮双轴变换；松手时一次性应用并提交真实尺寸。
- `src/features/assistant/AssistantSidebar.tsx`：移除根级宽高变量消费，使用已提交数值尺寸、固定变换原点、常驻合成层提示和布局/样式 containment。
- `src/App.tsx`、`src/components/TabContainer.tsx`：工作区避让恢复消费已提交的数值宽度，不再跟随尺寸 `pointermove` 连续布局。
- `docs/task/智能助手/00-任务总览.md`、`重要记录.md`、4.1 任务文件及五份阶段记录：同步第二轮性能根因、修复边界、验证结果和手动复验步骤。

### 自动生成但未纳入改动

- `resources/model-manifest.json`、`resources/progress-seeds.json` 由 `electron:build` 刷新，按仓库规则保持 Git 忽略。

## 第四阶段 · 实时排版性能修复

### 修改

- `src/features/assistant/hooks/useAssistantPanelInteraction.ts` 及测试：移除 `scale3d` 尺寸预览；在动画帧内批量写入助手真实宽高与停靠工作区局部避让，交互结束时才提交 Zustand。
- `src/App.tsx`、`src/components/TabContainer.tsx`、`src/features/assistant/AssistantSidebar.tsx`：把当前工作区 DOM ref 传给交互层，保留已提交尺寸初值与局部 containment，并取消停靠态无效的合成层提示。
- `src/features/assistant/conversation/AssistantConversation.tsx`、`ToolActivityCard.tsx`、`ApprovalCard.tsx`：对长会话中的计划、工具、审批、Artifact、Markdown 和错误块增加离屏内容可见性与固有尺寸占位，缩小时跳过不可见内容的布局和绘制。
- `docs/task/智能助手/00-任务总览.md`、`重要记录.md`、4.1 任务文件及五份阶段记录：同步第三轮反馈、最终技术决定、验证结果和真实鼠标复验步骤。

### 自动生成但未纳入改动

- `resources/model-manifest.json`、`resources/progress-seeds.json` 由 `electron:build` 刷新，按仓库规则保持 Git 忽略。

## 第五阶段 · 闭环验证实现完成，待用户手动验收

### 新增

- `src/features/canvas/domain/agentCanvasCatalog.ts`：上传/图片节点受限目录、节点数据 schema 与 ModelRegistry 参数校验。
- `src/features/canvas/application/agentCanvasActions.ts` 及测试：确定性布局、添加、连接、定位、项目持久化、scope revision 与严格后进先出撤销。
- `electron/main/services/agent-runtime/tools/builtin/frontend-canvas.ts` 及测试：画布目录、schema、添加、连接、定位和撤销 8 个受控 frontend 工具。
- `electron/main/services/agent-runtime/tools/builtin/frontend-utils.ts`：frontend 工具公共目标与输出辅助函数。
- `electron/main/services/agent-runtime/runner/runner-canvas.test.ts`：同一模型批次连续画布写操作使用最新 revision 的回归覆盖。
- `electron/main/services/agent-runtime/evaluation/minimal-cases.ts`、`minimal-evaluator.ts` 及测试：生成/诊断/画布最小用例、捕获校验、指标汇总与失败明细。
- `docs/task/智能助手/任务/第五阶段-闭环验证/首用例操作脚本.md`、`护栏验收清单.md`、`画布闭环操作脚本.md`、`最小评测结果.md`：真机操作、期望结果与真实基线填写入口。

### 修改

- `src/core/assistant/hostContracts.ts` 及测试：扩展画布目录/Schema、添加、连接、定位、撤销契约和稳定冲突错误码。
- `src/features/assistant/frontendTools/hostCommandRegistry.ts`、`hostQueryRegistry.ts` 及测试：接入画布应用动作与目录查询。
- `src/features/assistant/hostContext/hostContext.ts`：仅在当前项目可用时发布画布写命令，持续发布只读目录查询。
- `src/features/canvas/Canvas.tsx`：注册基于 ReactFlow `fitView` 的窄节点定位 handler。
- `electron/main/services/agent-runtime/tools/builtin/frontend.ts`、`registry.ts`、`context/catalog.ts`、`router.ts`、`builder.ts`、`types.ts` 及测试：注册画布工具，按宿主能力精确暴露，增加确定性画布路由和上下文约束。
- `electron/main/services/agent-runtime/runner/runner.ts`：多工具批次传递最新 resulting revision，并补充 nodeId/edgeId/undoRef 结果引用与审批生命周期日志。
- `electron/main/services/agent-runtime/diagnostics/query-diagnostic-events.ts` 及测试：诊断日志按 C2/open-world/R2 生成字段、目标和用途 preview。
- `electron/main/services/agent-runtime/tools/security.ts`、`gateway.ts` 及测试、`context/sanitize.ts`：扩展密钥/Bearer 脱敏、C3/R4/审批回归和宿主错误码映射。
- `src/features/assistant/conversation/AssistantConversation.tsx`、`ToolActivityCard.tsx`、`results/openAssistantResult.ts`：显示画布工具并支持稳定 nodeId 定位跳转。
- `package.json`：新增 `test:assistant-eval` 最小评测脚本。
- `docs/task/智能助手/00-任务总览.md`、`重要记录.md`、5.1～5.4 任务文件及五份阶段记录：同步第五阶段实现、自动验证、决策、遗留手动验收与交接。

### 自动生成但未纳入改动

- `resources/model-manifest.json`、`resources/progress-seeds.json` 由 `electron:build` 刷新，按仓库规则保持 Git 忽略。
