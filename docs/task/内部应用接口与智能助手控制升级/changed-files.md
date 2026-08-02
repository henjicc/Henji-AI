# 变更文件记录

## 验收后收口（观察一致性、隐私遮罩、自我验证）

- `src/core/assistant/applicationSurfaces.ts`：新增 `resolveSurfaceObservationProfile` 作为观察提供者/数据等级/遮罩/模态的唯一来源。
- `src/features/navigation/application/surfaceCatalog.ts` 及测试：观察画像改为派生；新增 `resolveSettingsSurfaceId`。
- `src/core/assistant/applicationControlCoverage.ts`：覆盖清单同源派生，修正素材 Surface 模态漂移。
- `src/components/Settings/index.tsx`、`src/core/types/settingsNavigation.ts`：删除组件内分区映射表，分区清单改为运行时 `SETTINGS_SECTION_IDS`。
- `src/features/assistant/applicationCapabilities/surfaceObservation.ts` 及测试：`contenteditable` 纳入遮罩；遮罩与捕获区域求真实交集。
- `src/components/Settings/sections/AgentUserInstructionsSection.tsx`：路径状态行标记 `data-observation-sensitive`。
- `scripts/check-assistant-capabilities.cjs`：双端技能同步门禁扩展到全部共享 skill。
- `src/core/assistant/capabilities/cameraStageMotionApplicationCapabilities.ts`：删除 `observe_camera_stage_viewport`，`verify_camera_stage_scene` 升为 v2 并移除 `requireVisualPreview`。
- 删除 `src/features/cameraStage/application/viewportObservation.ts` 及其测试；`StageCaptureBridge.tsx` 只保留导出用途。
- `src/core/assistant/surfaceObservation.ts`、`electron/main/services/agent-runtime/runner/runner.ts`：视觉附件按观察契约识别，不再绑定工具名。
- `electron/main/services/agent-runtime/context/prompt-layers.ts`：新增空间写入自我验证与视觉证据分级规则。
- `electron/main/services/agent-runtime/context/task-facets.ts` 及 `context.test.ts`：三维任务图新增 `camera_verify` Facet。
- `docs/rules/assistant-capability.md`、两端 `henji-application-capability` skill、`henji-ui-surface` 性能规则同步。
- `docs/task/内部应用接口与智能助手控制升级/manual-test.md`：压缩为 3 个串联手测场景。

## 第七阶段 7.2 与最终收尾

- `electron/main/services/agent-runtime/evaluation/minimal-evaluator.ts` 及测试：增加模型轮次、工具调用、累计输入 Token 和相同工具指纹阈值。
- `electron/main/services/agent-runtime/evaluation/regression-cases.ts` 及测试：增加使用真实注册工具的最终三维组合验收用例。
- `electron/main/services/agent-runtime/context/compaction.ts` 及测试：二次裁剪保留已有会话语义摘要。
- `electron/main/services/agent-runtime/runner/runner.ts`、`turn-context-coordinator.ts`、`runner-compaction.test.ts`：压缩后从实时会话重建上下文并改善失败诊断。
- `docs/task/内部应用接口与智能助手控制升级/manual-test.md`：从逐阶段清单精简为最终必要实机项目。
- 本计划六份记录、7.2 任务文件，以及“智能助手智能化升级”“智能助手持续会话与运行时演进”的交叉验收记录。

## 任务 7.2 开始

- 当前仅更新 7.2 与五类必需记录；评测、兼容断言和最终人工清单文件待实现后追加。

## 任务 7.1 完成

- 门禁/CI：`scripts/check-assistant-capabilities.cjs`、`.github/workflows/build.yml`。
- 核心契约/覆盖：`applicationCapabilities.ts` 及测试、`applicationControlCoverage.ts` 及测试、前端能力错误命名。
- 规则/技能：`docs/rules/architecture.md`、`assistant-capability.md`，Codex/Claude 应用能力技能及 `capability-patterns.md`。
- 7.1、总览、重要记录及五类阶段记录。

## 任务 7.1 开始

- 当前仅更新第七阶段、7.1 与五类必需记录；代码和删除清单待迁移矩阵/消费者审计后追加。

## 任务 6.5

- Surface 契约与覆盖：`src/core/assistant/surfaceObservation.ts`、`applicationControlCoverage.ts` 及测试、`src/features/navigation/application/surfaceCatalog.ts` 及测试。
- 能力与运行时：内建能力注册、渲染能力 `surfaceObservation.ts` 及测试、Runner `models.ts`/`runner.ts` 及测试。
- Electron/PAL：媒体 IPC、`electron/main/services/media/surfaceCapture.ts` 及测试、preload API、媒体平台契约与 Electron 适配器。
- Surface 边界：工作区、设置、工具箱、素材浮层和画布/图片编辑/三维专用视口根节点。
- 规则：`.codex`/`.claude` 的 `henji-application-capability` 技能、`docs/rules/assistant-capability.md`。
- 第六阶段任务记录、总览、重要记录与人工测试暂存清单。

## 任务 6.5 开始

- 已更新任务状态与阶段记录；代码文件将在实现完成后按真实范围补充。

## 任务 6.4

- `src/core/assistant/attachments.ts` 及运行、事件、会话、投影、工作摘要契约：稳定附件引用和恢复。
- `src/features/assistant/conversation/`：附件草稿 reducer、导入服务、Composer 交互、消息恢复预览与测试。
- `src/utils/save/uploads.ts`：移除上传日志中的裸路径。
- `electron/main/services/agent-runtime/runner/attachment-context.ts`、模型协调与 runner：预检、字节解析、主/观察模型路由与测试。
- Agent persistence/session store 与相关回归测试。
- 第六阶段任务记录。

## 任务 6.3

- `src/core/llm/`、`src/core/assistant/`：多模态模型步骤、观察模型、冒烟、追踪与快照契约。
- `src/services/llm/LlmConfigService.ts`、设置模型档案界面及测试：旧配置归一化、观察模型选择和声明/验证说明。
- `electron/main/services/agent-runtime/runner/`：各角色独立运行时能力与观察模型选择。
- `electron/main/services/llm/sdk/`：模型能力门禁、协议支持矩阵、冒烟与覆盖测试。
- 第六阶段任务记录。

## 第六阶段开始

- 任务记录：`00-任务总览.md`、`progress.md`、`decisions.md`、`handoff.md`、`changed-files.md`、`test-report.md`
- 代码改动尚未开始；后续按 6.1 至 6.5 分任务追加真实文件范围。

## 任务 6.1

- `src/features/assistant/conversation/useConversationAutoScroll.ts`
- `src/features/assistant/conversation/useConversationAutoScroll.test.tsx`
- `src/features/assistant/conversation/AssistantConversation.tsx`
- 第六阶段任务记录与统一手动测试清单

## 任务 6.2

- `src/features/assistant/conversation/agentRunReducer.ts` 与测试
- `src/features/assistant/conversation/ExecutionPlanCard.tsx` 与新增组件行为测试
- `src/features/assistant/conversation/ToolActivityCard.tsx`
- `src/features/assistant/conversation/errorPresentation.ts`
- `src/features/assistant/conversation/AssistantConversation.tsx`
- 第六阶段任务记录与统一手动测试清单

## 任务 5.4 与第五阶段完成

- `src/features/generation/application/`：生成准备、模型 schemaRef、任务服务/状态镜像、恢复、反射与测试
- `src/features/assistant/application/`：助手 run/Artifact 正式服务、反射与状态映射测试
- `electron/main/services/application-control/workflows/`：确定性工作流定义、正式服务与测试
- `electron/main/services/agent-runtime/workflows/tools.ts`：仅保留运行时薄适配
- `electron/main/agent-utility.ts`
- `src/workspaces/GenerationWorkspace/application/visibleGenerationTaskCommand.ts`
- `src/workspaces/GenerationWorkspace/hooks/useTaskGeneration.ts`
- `src/features/assistant/applicationCapabilities/applicationControlRegistry.ts`
- `src/features/assistant/applicationCapabilities/registerGenerationCapabilityHandlers.ts`
- `src/features/assistant/applicationCapabilities/registry.ts`
- `src/core/assistant/applicationControlCoverage.ts`
- `src/core/assistant/builtinApplicationCapabilities.ts`
- `src/core/assistant/capabilities/generationApplicationCapabilities.ts`
- `src/core/assistant/capabilities/toolboxApplicationCapabilities.ts`
- `src/core/assistant/capabilities/workflowApplicationCapabilities.ts`
- `package.json`：助手生产评测引用正式画布测试
- 删除 `src/core/assistant/generationPreparation*` 与 `generationTaskRecovery*` 助手专用业务文件
- 删除 `electron/main/services/agent-runtime/workflows/definitions.ts`、`service.ts` 与旧位置测试
- 第五阶段任务记录文件

## 任务 5.3

- `src/features/assets/application/` 正式素材服务、素材入画布组合服务、反射与测试
- `src/features/imageEdit/application/` 控制 schema、文档构建、预览会话、提交、反射与测试
- `src/features/imageEdit/tools/controlCatalog.ts`
- `src/features/imageEdit/tools/registry.ts`、`types.ts`
- `src/features/toolbox/application/` 正式工具箱服务与反射
- `src/features/canvas/application/storyboardProjectService.ts`
- `src/features/canvas/application/storyboardReflection.ts` 与测试
- `src/features/assistant/applicationCapabilities/` 中素材、画布、工具箱、生成、Surface 适配与注册表
- `src/core/assistant/applicationControlCoverage.ts`
- `src/core/assistant/builtinApplicationCapabilities.ts`
- `src/core/assistant/capabilities/toolboxApplicationCapabilities.ts`
- 删除 `src/features/assistant/hostActions.ts`
- 删除 `src/features/assistant/imageEditAdapter.ts` 与旧测试
- 删除 `src/core/assistant/imageEditContracts.ts`
- 第五阶段任务记录文件

## 任务 5.2

- `src/features/canvas/application/canvasApplicationService.ts` 与测试
- `src/features/canvas/application/canvasMutationService.ts`
- `src/features/canvas/application/canvasBatchService.ts` 与测试
- `src/features/canvas/application/canvasProjectService.ts`
- `src/features/canvas/application/canvasQueryService.ts`
- `src/features/canvas/application/canvasDownloadService.ts`
- `src/features/canvas/application/canvasReflection.ts` 与测试
- `src/features/canvas/application/canvasMutationExecutor.ts`
- `src/features/canvas/domain/nodeControlRegistry.ts`
- `src/features/canvas/Canvas.tsx`
- `src/features/assistant/applicationCapabilities/applicationControlRegistry.ts`
- `src/features/assistant/applicationCapabilities/registerCanvasCapabilityHandlers.ts` 与测试
- `src/features/assistant/applicationCapabilities/registry.ts`
- `src/features/assistant/applicationCapabilities/surfaceRegistry.ts` 与测试
- `src/features/assistant/hostActions.ts`
- `src/features/assistant/results/openAssistantResult.ts`
- 删除 `src/features/canvas/application/agentCanvas*.ts` 与旧测试
- 删除 `src/features/canvas/domain/agentCanvasCatalog.ts`
- 第五阶段任务记录文件

## 第五阶段（已完成）

### 任务 5.1

- `src/features/settings/application-control/`
- `src/features/navigation/application/`
- `src/features/assistant/applicationCapabilities/settingsRegistry.ts`
- `src/features/assistant/applicationCapabilities/settingsReflection.ts`
- `src/features/assistant/applicationCapabilities/settingsMutationExecutor.ts`
- `src/features/assistant/applicationCapabilities/surfaceRegistry.ts`
- `src/features/assistant/applicationCapabilities/applicationControlRegistry.ts`
- `src/core/assistant/applicationControlCoverage.ts`
- `scripts/check-assistant-capabilities.cjs`
- `docs/task/内部应用接口与智能助手控制升级/` 任务记录

## 第四阶段（已完成）

### 任务 4.1

- `src/features/cameraStage/application/cameraStageApplicationService.ts`
- `src/features/cameraStage/application/cameraStageUndo.ts`
- `src/features/cameraStage/application/cameraStageReflection.ts`
- `src/features/cameraStage/application/cameraStageReflection.test.ts`
- `src/features/assistant/applicationCapabilities/cameraStageCapabilityAdapter.ts`
- `src/features/assistant/applicationCapabilities/applicationControlRegistry.ts`
- `src/features/assistant/hostActions.ts`
- `src/features/assistant/hostContext/hostContext.ts`
- `src/features/cameraStage/CameraStageApp.tsx`
- `src/features/cameraStage/projects/CameraStageProjectList.tsx`
- `src/features/cameraStage/projects/cameraStageProjectService.ts`

### 任务 4.2

- `src/features/cameraStage/application/sceneAnalysis.ts`
- `src/features/cameraStage/application/sceneAnalysis.test.ts`
- `src/features/cameraStage/application/cameraStagePlacementExecutor.ts`
- `src/core/assistant/capabilities/cameraStageCapabilitySchemas.ts`
- `src/core/assistant/capabilities/cameraStageProjectApplicationCapabilities.ts`
- `src/core/assistant/capabilities/cameraStageSceneApplicationCapabilities.ts`
- `src/core/assistant/capabilities/cameraStageApplicationCapabilities.ts`

### 任务 4.3

- `src/features/cameraStage/application/cameraMotionService.ts`
- `src/features/cameraStage/application/cameraMotionService.test.ts`
- `src/features/cameraStage/application/cameraStageControlExecutors.ts`
- `src/core/assistant/capabilities/cameraStageMotionApplicationCapabilities.ts`
- `src/features/assistant/applicationCapabilities/registerToolboxCapabilityHandlers.ts`
- `src/features/assistant/applicationCapabilities/registerToolboxCapabilityHandlers.test.ts`
- `src/core/assistant/applicationControlCoverage.ts`
- `src/core/assistant/applicationControlCoverage.test.ts`
- `src/features/assistant/applicationCapabilities/registry.test.ts`

### 任务 4.4

- ~~`src/features/cameraStage/application/viewportObservation.ts`~~（已于验收后删除，见下方"验收后收口"）
- ~~`src/features/cameraStage/application/viewportObservation.test.ts`~~（同上）
- `src/features/cameraStage/application/cameraStageVerification.ts`
- `src/features/cameraStage/scene/StageCaptureBridge.tsx`
- `src/features/assistant/applicationCapabilities/surfaceRegistry.ts`
- `src/features/assistant/applicationCapabilities/surfaceRegistry.test.ts`
- `electron/main/services/agent-runtime/context/task-facets.ts`
- `electron/main/services/agent-runtime/context/prompt-layers.ts`
- `electron/main/services/agent-runtime/context/context.test.ts`
- `electron/main/services/agent-runtime/evaluation/regression-cases.ts`
- 第四阶段任务记录文件

## 第三阶段（已完成）

### 任务 3.1

- `src/core/assistant/taskGraph.ts`
- `src/core/assistant/taskGraph.test.ts`
- `src/core/assistant/events.ts`
- `src/core/assistant/workingContext.ts`
- `src/core/assistant/workingSummaryReducer.ts`
- `electron/main/services/agent-runtime/context/types.ts`
- `electron/main/services/agent-runtime/context/task-facets.ts`
- `electron/main/services/agent-runtime/context/router.ts`
- `electron/main/services/agent-runtime/context/context.test.ts`
- `electron/main/services/agent-runtime/runner/model-execution.ts`
- `electron/main/services/agent-runtime/runner/runner.ts`
- `electron/main/services/agent-runtime/runner/final-response.ts`
- `electron/main/services/agent-runtime/runner/model-response-journal.ts`
- `electron/main/services/agent-runtime/runner/model-step-recovery.ts`
- `electron/main/services/agent-runtime/runner/route-goal.ts`
- `electron/main/services/agent-runtime/runner/runner-cancellation.ts`
- `electron/main/services/agent-runtime/runner/runner-components.ts`
- `electron/main/services/agent-runtime/runner/runner-conversation.ts`
- `electron/main/services/agent-runtime/runner/runner-failure.ts`
- `electron/main/services/agent-runtime/runner/tool-turn.ts`
- 第三阶段任务记录文件

### 任务 3.2

- `src/core/assistant/capabilityDiscovery.ts`
- `src/core/assistant/capabilities/capabilityDiscoveryApplicationCapabilities.ts`
- `src/core/assistant/capabilities/assistantRuntimeApplicationCapabilities.ts`
- `src/core/assistant/applicationControlCoverage.ts`
- `src/core/assistant/taskGraph.test.ts`
- `electron/main/services/agent-runtime/context/capability-discovery.ts`
- `electron/main/services/agent-runtime/context/capability-discovery.test.ts`
- `electron/main/services/agent-runtime/context/catalog.ts`
- `electron/main/services/agent-runtime/context/catalog.test.ts`
- `electron/main/services/agent-runtime/context/tool-activation.ts`
- `electron/main/services/agent-runtime/context/prompt-layers.ts`
- `electron/main/services/agent-runtime/tools/builtin/backend.ts`
- 第三阶段任务记录文件

### 任务 3.3

- `src/core/assistant/progress.ts`
- `src/core/assistant/events.ts`
- `src/core/assistant/workingSummaryReducer.ts`
- `electron/main/services/agent-runtime/runner/facet-progress.ts`
- `electron/main/services/agent-runtime/runner/facet-progress.test.ts`
- `electron/main/services/agent-runtime/runner/tool-call-scheduler.ts`
- `electron/main/services/agent-runtime/runner/tool-call-scheduler.test.ts`
- `electron/main/services/agent-runtime/runner/tool-execution-coordinator.ts`
- `electron/main/services/agent-runtime/runner/tool-turn.ts`
- `electron/main/services/agent-runtime/runner/runner.ts`
- `electron/main/services/agent-runtime/runner/runner.test.ts`
- `electron/main/services/agent-runtime/runner/completion-coordinator.ts`
- `electron/main/services/agent-runtime/runner/result-verifier.ts`
- `electron/main/services/agent-runtime/runner/result-verifier.test.ts`
- `electron/main/services/agent-runtime/runner/working-summary.test.ts`
- `electron/main/services/agent-runtime/runner/external-continuation-coordinator.test.ts`
- `electron/main/services/agent-runtime/evaluation/regression-cases.ts`
- `electron/main/services/agent-runtime/evaluation/regression-cases.test.ts`
- 第三阶段任务记录文件

## 第二阶段（已完成）

### 任务 2.1

- `src/core/application-control/reflection.ts`
- `src/core/application-control/identifiers.ts`
- `src/core/application-control/index.ts`
- `src/core/application-control/contracts.test.ts`
- `src/core/application-control/registry/`
- `src/features/assistant/applicationCapabilities/settingsRegistry.ts`
- `src/features/assistant/applicationCapabilities/settingsReflection.ts`
- `src/features/assistant/applicationCapabilities/applicationControlRegistry.ts`
- 第二阶段任务记录文件

### 任务 2.2

- `src/core/application-control/query/`
- `src/core/application-control/index.ts`
- 第二阶段任务记录文件

### 任务 2.3

- `src/core/application-control/transactions.ts`
- `src/core/application-control/execution/`
- `src/core/application-control/index.ts`
- `src/core/application-control/contracts.test.ts`
- `src/core/application-control/registry/registry.ts`
- `src/features/assistant/applicationCapabilities/applicationControlRegistry.ts`
- `src/features/assistant/applicationCapabilities/settingsReflection.ts`
- `src/features/assistant/applicationCapabilities/settingsMutationExecutor.ts`
- `src/features/assistant/applicationCapabilities/settingsApplicationControl.test.ts`
- `src/features/assistant/applicationCapabilities/settingsProtectedDefinitions.ts`
- `src/features/assistant/applicationCapabilities/settingsRegistry.ts`
- 第二阶段任务记录文件

## 第一阶段

### 任务 1.1

- `src/core/application-control/identifiers.ts`
- `src/core/application-control/reflection.ts`
- `src/core/application-control/observation.ts`
- `src/core/application-control/transactions.ts`
- `src/core/application-control/versioning.ts`
- `src/core/application-control/index.ts`
- `src/core/application-control/contracts.test.ts`
- `src/core/assistant/applicationCapabilities.ts`
- `src/core/assistant/applicationControlMapping.ts`
- `src/core/assistant/applicationControlMapping.test.ts`
- 第一阶段任务记录文件

### 任务 1.2

- `src/core/application-control/coverage.ts`
- `src/core/application-control/index.ts`
- `src/core/assistant/applicationControlCoverage.ts`
- `src/core/assistant/applicationControlCoverage.test.ts`
- `src/features/cameraStage/domain/animatableProps.ts`
- `package.json`
- 第一阶段任务记录文件
