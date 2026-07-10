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
