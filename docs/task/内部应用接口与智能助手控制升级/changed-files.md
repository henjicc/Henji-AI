# 变更文件记录

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

- `src/features/cameraStage/application/viewportObservation.ts`
- `src/features/cameraStage/application/viewportObservation.test.ts`
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
