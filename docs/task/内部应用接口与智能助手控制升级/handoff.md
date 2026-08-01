# 接力记录

## 当前接力状态

- 阶段：第七阶段 · 规则收口与整体验收
- 当前任务：7.1（待开始）
- 已完成：第一至第五阶段全部任务（1.1 至 5.4）。
- 待完成：7.1、7.2；第六阶段全部完成。
- 阻塞：无。

## 第六阶段完成接力

- 22 个 Surface 的观察策略由 `surfaceCatalog.ts` 统一声明，覆盖清单全部为可用；新增 Surface 不得绕过观察字段和覆盖门禁。
- 通用截图契约位于 `src/core/assistant/surfaceObservation.ts`，主进程实现位于 `electron/main/services/media/surfaceCapture.ts`；只能捕获当前 Henji-AI `webContents` 的批准区域。
- `observe_application_surface` 是统一只读能力；画布、图片编辑和三维优先捕获标记的专用区域，生成/素材有 `mediaRef` 时直接返回原生媒体稳定引用。
- Runner 只在 primary/observer 至少支持一种媒体输入时开放观察，并对实际结果再次执行附件/provider 门禁；实际读取后才生成主模型或观察模型视觉证据。
- API Key、路径、输入控件和显式敏感 DOM 在主进程输出前被覆盖；范围校验失败绝不回退整窗或桌面。
- 下一步 7.1 清理过时路径和规则，7.2 执行全量评测并把 `manual-test.md` 精简为最终真人必测项。

## 任务 6.1 接力

- 状态：已完成；当前任务切换为 6.2。
- `useConversationAutoScroll.ts` 是跟随、用户接管、新内容提示和回底动作的唯一入口；`AssistantConversation.tsx` 仍只有一个 `overflow-y-auto` 对话视口。
- 内容与视口 `ResizeObserver` 共用一帧调度；用户离底时仅内容尺寸变化标记“有新内容”，窗口缩放不会产生假提示。
- 6.2 扩展计划/证据 UI 时不得新增嵌套滚动容器；工具卡和 Artifact 展开高度会由现有内容观察自动处理。

## 任务 6.2 接力

- 状态：已完成；当前任务切换为 6.3。
- `selectExecutionPresentation` 是 Facet、验证、Artifact、终态和下一步的唯一 UI 投影；恢复快照继续通过现有 reducer 重放同一事件得到一致结果。
- `describeStructuredError` 将稳定错误码映射为用户标题，并继续以序列化错误的 `recovery` 给出下一步；不要从日志消息补推状态。
- 6.5 接入观察事件时可沿现有 Facet evidence 与 Artifact 引用展示，无需新建观察进度面板。

## 任务 6.3 接力

- 状态：已完成；当前任务切换为 6.4。
- 三种模态能力已进入 `ModelStepCapabilities`；媒体发送前先校验模型声明，再校验 provider protocol，错误码分别为 `unsupported_input_modality` 与 `unsupported_provider_modality`。
- `AgentModelProfile.observer` 可选且兼容旧配置；运行时按“执行主模型优先、观察模型回退、否则阻断”选择消费者。
- 6.4 构造 AI SDK 内容片段时应使用 `image`/`file` 原生结构；openai-compatible 暂不支持视频文件，不得转换成提示词 URL。

## 任务 6.4 接力

- 状态：已完成；当前任务切换为 6.5。
- `AgentAttachment` 只保存 `asset:` 稳定引用与安全元数据，素材库负责生命周期；运行启动前完成源、限制、模型与协议预检。
- `prepareAgentAttachmentContext` 是主进程字节读取和 primary/observer 分流入口；原始字节不持久化、不记录日志，且只在第一轮进入目标模型。
- 6.5 应复用观察模型步骤与稳定引用，但 Surface 截图仍必须走批准区域和遮罩契约，不能把附件入口扩展成任意路径读取。

## 第六阶段开始接力

- 已完整读取 6.1 至 6.5 任务说明、阶段记录、架构/UI/媒体/模型/日志/Electron/画布/测试规则，以及 `henji-application-capability`、`henji-ui-surface`、`henji-model-adaptation` 技能。
- 从 6.1 的现有滚动 Hook 和助手面板布局开始，按任务顺序完成并独立验证；跨任务共享契约以 6.3 多模态能力和 6.4 稳定附件引用为 6.5 观察入口的前置。
- 不新增通用 UI 组件，不建立第二套附件存储、截图通道、日志查看器或模型能力配置。
- 所有鼠标、触控板、真实媒体和真实模型验证继续累计到 `manual-test.md`，最终从全局视角去重压缩。

## 任务 5.1 接力

- 状态：已完成；当前任务切换为 5.2。
- 正式设置入口为 `src/features/settings/application-control/`，保留全部 43 项既有 ID、默认值、敏感过滤、revision、原子提交和撤销语义。
- 正式 Surface 目录与导航入口为 `src/features/navigation/application/`；助手目录下的 `settingsRegistry.ts`、`settingsReflection.ts`、`settingsMutationExecutor.ts` 和 `surfaceRegistry.ts` 只保留薄适配。
- Surface 的 `openPolicy` 是提前展示、先解析稳定目标、无需切换和用户接管判断的唯一策略源；其他 Surface 的真实截图观察仍留在 6.5。
- 5.2 应将当前 `agentCanvas*` 业务实现改为正式画布服务，再让导航定位与助手处理器引用新入口。

## 任务 5.2 接力

- 状态：已完成；当前任务切换为 5.3。
- 正式画布入口位于 `src/features/canvas/application/` 的 `canvasApplicationService`、`canvasMutationService`、`canvasBatchService`、`canvasProjectService`、`canvasQueryService` 与 `canvasDownloadService`。
- 项目、节点和边反射位于 `canvasReflection.ts`；节点标题与位置的原子写入、冲突和撤销由 `CanvasNodeMutationExecutor` 负责。
- 节点控制 schema 唯一入口为 `src/features/canvas/domain/nodeControlRegistry.ts`，继续复用 `nodeRegistry` 的默认数据、端口和连接规则。
- 所有 `agentCanvas*` 业务文件已移除；5.3 的素材入画布应直接调用 `addCanvasNode`。

## 任务 5.3 接力

- 状态：已完成；当前任务切换为 5.4。
- 素材入口位于 `src/features/assets/application/`，公开响应移除本地路径；素材入画布在单独的领域组合服务中复用正式画布入口。
- 图片编辑控制 schema、文档构建、预览会话、提交和反射位于 `src/features/imageEdit/application/`；提交失败保留预览，成功才删除。
- 工具控制目录位于 `src/features/imageEdit/tools/controlCatalog.ts`，UI 工具注册表和控制面共同引用；工具箱正式服务/反射位于 `src/features/toolbox/application/`。
- 分镜项目与卡片通过 `storyboardProjectService.ts` 和 `storyboardReflection.ts` 暴露；写入继续走画布分镜节点事务。
- 助手 `hostActions.ts`、`imageEditAdapter.ts` 和核心助手 `imageEditContracts.ts` 已删除。

## 任务 5.4 与第五阶段完成接力

- 状态：5.4 与第五阶段已完成；当前任务切换为 6.1。
- 生成正式入口位于 `src/features/generation/application/`；模型 schema 直接从模型定义生成稳定 `schemaRef`，可见任务继续复用 `GenerationService` 固定链路。
- `generation.model`、`generation.task`、`generation.result` 已注册反射；任务状态来自生成工作区轻量镜像，不新增队列或轮询器。
- 工作流正式入口位于 `electron/main/services/application-control/workflows/`；`agent-runtime/workflows/tools.ts` 只保留工具协议适配。
- 助手运行时正式入口和 `assistant.run`、`assistant.artifact` 反射位于 `src/features/assistant/application/`；Artifact 内容分页、运行持久恢复和诊断均继续使用既有唯一实现。
- 生产评测脚本已从删除的 `agentCanvasActions.test.ts` 切换到 `canvasApplicationService.test.ts`。
- 第五阶段真实鼠标交互和真实 API 生成验收已集中到 `manual-test.md`；6.3 至 6.5 可直接使用稳定结果/产物引用。

## 第四阶段开始状态

- 已完整读取 4.1 至 4.4 任务说明、重要记录、架构/助手能力/测试规则与 `henji-application-capability` skill。
- 先盘点三维 Store、UI、旧能力和宿主动作中的持久写入，再建立正式应用服务；所有人工验收继续只累计到 `manual-test.md`。
- 本阶段涉及共享契约、持久状态、能力执行、运行时导航与验证，按 L3 跨目录/跨层重构验证；先运行精确测试，阶段收尾再执行必要的全量检查。

## 第四阶段完成接力

- 三维正式应用服务入口位于 `src/features/cameraStage/application/cameraStageApplicationService.ts`；助手适配器只负责能力输入输出，界面工程操作也已委托该服务。
- 七类反射实体和领域提供者位于 `cameraStageReflection.ts`；属性 ID 由领域可动画属性生成，不要另建三维字段清单。
- 场景规划与通用布局位于 `sceneAnalysis.ts`，摆放事务位于 `cameraStagePlacementExecutor.ts`；显式坐标优先，自动布局负责避免无意重叠。
- 运镜入口位于 `cameraMotionService.ts`，沿用现有空间路径算法；简单模式物化镜头路径，专业模式物化关键帧。
- `camera_stage` 已成为首个可观察 Surface，提供者由 `StageCaptureBridge.tsx` 注册；其他 Surface 仍按 6.5 推广，不得因三维样板而标记为已实现。
- 控制注册表通过运行时依赖注入取得当前 revision，避免核心注册时静态导入宿主上下文和浏览器存储。
- 第四阶段真实鼠标与三维效果验收已集中到 `manual-test.md`，当前未要求用户执行。
- 下一步 5.1 可复用早期导航、反射/事务适配和受限观察模式，但设置领域自身仍按原任务边界迁移。

## 第二阶段开始状态

- 已读取第二阶段 2.1、2.2、2.3 的任务文件与相关项目规则。
- 当前从 2.1 开始实现；2.2、2.3 在注册表稳定后继续。
- 手动验证仍统一累计到 `manual-test.md`，阶段内不要求用户逐项操作。

## 任务 2.1 接力

- 反射注册表位于 `src/core/application-control/registry/`，只持有描述、索引和提供者引用。
- 现有设置通过 `settingsReflection.ts` 非破坏性接入；原设置能力行为未改变。
- 2.2 可直接复用注册表的批量描述、实体列表、实体读取与 schemaRef 解析入口。

## 任务 2.2 接力

- 统一结构化观察位于 `src/core/application-control/query/`，输入和输出保持调用方中立。
- Artifact 通过 `ApplicationObservationArtifactSink` 注入，不新增存储或 IPC；助手适配器继续复用既有 `read_agent_artifact`。
- 截断、分页、权限过滤和 revision 冲突均有显式结果或稳定错误，不静默省略。

## 第二阶段完成接力

- 反射唯一入口：`src/core/application-control/registry/`。
- 批量观察唯一入口：`src/core/application-control/query/`。
- 计划、提交、撤销和验证唯一入口：`src/core/application-control/execution/`。
- `applicationControlRegistry.ts` 已组合设置反射与事务 executor；第三阶段可在助手适配层包装这些入口，不要让核心层反向依赖 Agent Runtime。
- 多步骤事务必须保留 `atomic`、`compensatable`、`non_reversible` 的真实语义；不要为简化工具输出而合并。
- 现有 Artifact Store 无需扩展；3.2 只需提供 `ApplicationObservationArtifactSink` 的正式适配。
- 第二阶段提交：`47a07dd`、`77e9040`、`46ba838`。

## 任务 3.1 接力

- 多 Facet 共享契约位于 `src/core/assistant/taskGraph.ts`，路由构建位于 `context/task-facets.ts`。
- `AgentRouteDecision.taskGraph` 是正式任务图；旧 route 字段继续用于兼容现有调用方。
- `PlanUpdated.taskGraph` 已进入工作摘要和保存点，3.2、3.3 不需另建持久化通道。

## 任务 3.2 接力

- 批量发现契约位于 `src/core/assistant/capabilityDiscovery.ts`，主进程目录索引位于 `context/capability-discovery.ts`。
- 默认激活 `discover_application_capabilities`；发现后下一轮增量激活操作工具与 `read_application_schemas`。
- `fingerprint`、`reused` 和 `missing` 是 3.3 进展判定的权威输入，不再从自然语言摘要猜测。

## 第三阶段完成接力

- Facet 进展契约位于 `src/core/assistant/progress.ts`，运行时唯一跟踪入口位于 `runner/facet-progress.ts`。
- `FacetProgressed` 已进入现有事件流和工作摘要；后续界面可直接消费，不要另建进度存储或 IPC。
- 相同参数与 base revision 的重复写入、缓存发现、冲突重试、连续失败、权限不足和能力缺失均由执行前/结果后结构化守卫收敛。
- 外部长任务继续使用现有 `waiting_external`；缺少用户输入继续使用现有 `waiting_user`，不得新增暂停状态。
- 第三阶段提交：`3d80475`、`9ce1900`、`7c8df84`。

## 第一阶段接力要点

- 以 `src/core/application-control/` 为后续核心类型唯一入口。
- 以 `createApplicationControlCoverageManifest` 的领域计划和迁移矩阵为实现基线。
- Surface 观察状态目前均为 `planned`，不得在 6.5 前当成已实现能力。
- 第一阶段记录的两个 Agent Runtime 旧夹具失配已在 3.3 收尾时对齐当前激活快照；全量测试现已无失败。
- 第一阶段提交：`9545a6f`、`218a0d6`。
