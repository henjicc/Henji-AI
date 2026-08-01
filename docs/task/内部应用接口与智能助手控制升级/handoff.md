# 接力记录

## 当前接力状态

- 阶段：第四阶段 · 三维运镜端到端样板
- 当前任务：4.1（待开始）
- 已完成：第一阶段 1.1、1.2；第二阶段 2.1、2.2、2.3；第三阶段 3.1、3.2、3.3。
- 待完成：从 4.1 开始提取三维正式应用服务与完整控制描述。
- 阻塞：无。

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
