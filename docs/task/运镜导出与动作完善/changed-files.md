# 修改文件

## 1.1 动作片段确定性驱动

- `src/features/cameraStage/scene/CharacterModel.tsx`
  - 使用 CameraStage store 的时间轴播放头驱动 mixer。
  - 速度换算集中在 `setTime()` 参数，移除 action 的 `timeScale` 同步与无用 ref。
- `docs/task/运镜导出与动作完善/重要记录.md`
  - 记录 001 更新为用户确认的方案 A。
- `docs/task/运镜导出与动作完善/00-任务总览.md`
  - 同步 1.1 完成、第一阶段进行中。
- `docs/task/运镜导出与动作完善/任务/第一阶段-导出正确性/1.1-动作片段确定性驱动.md`
  - 更新状态与执行记录。
- `docs/task/运镜导出与动作完善/{progress,decisions,handoff,changed-files,test-report}.md`
  - 建立本任务统一记录。

## 1.2 动作片段与关节采样互斥

- `src/features/cameraStage/scene/CharacterModel.tsx`
  - 将关节与颜色播放期 applier 拆分注册。
  - clip 实际生效时不注册关节 applier，消除其与 mixer 的骨骼双写；颜色 applier 保持注册。
- `docs/task/运镜导出与动作完善/任务/第一阶段-导出正确性/1.2-动作片段与关节采样互斥.md`
  - 同步任务状态、执行记录与手测项。
- `docs/task/运镜导出与动作完善/{progress,decisions,handoff,changed-files,test-report}.md`
  - 更新 1.2 的进度、决策、交接与验证记录。
- `docs/task/运镜导出与动作完善/00-任务总览.md`
  - 同步 1.2 完成、第一阶段完成状态。
