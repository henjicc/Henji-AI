# 接力记录

## 当前接力状态

- 阶段：第二阶段 · 内部应用接口内核
- 当前任务：2.1（待开始）
- 已完成：第一阶段任务 1.1、1.2；契约、覆盖矩阵和门禁均已落地。
- 待完成：实体/属性注册表、统一观察查询、事务执行内核。
- 阻塞：无。

## 第一阶段接力要点

- 以 `src/core/application-control/` 为后续核心类型唯一入口。
- 以 `createApplicationControlCoverageManifest` 的领域计划和迁移矩阵为实现基线。
- Surface 观察状态目前均为 `planned`，不得在 6.5 前当成已实现能力。
- 全量测试的两个 Agent Runtime 基线失败见 `test-report.md`。
