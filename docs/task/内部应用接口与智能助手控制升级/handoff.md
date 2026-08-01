# 接力记录

## 当前接力状态

- 阶段：第五阶段 · 全领域能力迁移
- 当前任务：5.3（待开始）
- 已完成：第一阶段 1.1、1.2；第二阶段 2.1、2.2、2.3；第三阶段 3.1、3.2、3.3；第四阶段 4.1、4.2、4.3、4.4。
- 待完成：依次完成 5.3、5.4 的全领域迁移。
- 阻塞：无。

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
