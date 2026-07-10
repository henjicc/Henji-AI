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

## 2.1 帧数据二进制传输

- `src/features/cameraStage/export/cameraStageAspectCrop.ts`
  - 抽出共享裁剪画布逻辑，保留 dataURL 出口并新增 PNG `Uint8Array` 出口。
- `src/features/cameraStage/export/cameraStageVideo.ts`
  - 视频逐帧导出改传裁剪后的 PNG 字节。
- `src/platform/contracts/video.ts`、`electron/preload/api.d.ts`
  - 逐帧导出载荷从 `dataUrl` 改为 `bytes: Uint8Array`。
- `electron/main/ipc/video.ts`、`electron/main/services/video/types.ts`、`electron/main/services/video/frame-export.ts`
  - 校验非空二进制帧、DTO 同步并直接写入 PNG 文件；删除 dataURL 解码。
- `docs/task/运镜导出与动作完善/{progress,decisions,handoff,changed-files,test-report}.md`
  - 记录 2.1 实施、验证和交接信息。
- `docs/task/运镜导出与动作完善/00-任务总览.md`、`任务/第二阶段-健壮性与性能/2.1-帧数据二进制传输.md`
  - 同步 2.1 进入待验证状态和实际执行记录。
