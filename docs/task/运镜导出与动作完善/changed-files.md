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

## 2.2 导出会话与产物清理

- `electron/main/services/video/frame-export.ts`
  - ffmpeg 改在会话临时目录编码，成功后才发布到 Uploads；跨卷复制使用隐藏 `.part` 暂存并在成功后改名。
  - 增加 `lastActivity`、30 分钟空闲回收、Uploads 暂存残留回收、批量会话清理与结构化日志。
- `electron/main/window.ts`
  - 在渲染重载、渲染进程退出、webContents 销毁和窗口关闭时清理所有导出会话。
- `src/features/cameraStage/export/cameraStageVideo.ts`
  - 导出文件名时间戳改为本地 `YYYY-MM-DD-HH-mm-ss`。
- `docs/task/运镜导出与动作完善/{00-任务总览,progress,decisions,handoff,changed-files,test-report}.md`
  - 同步 2.2 的实施、决策、交接、验证与状态。
- `docs/task/运镜导出与动作完善/任务/第二阶段-健壮性与性能/2.2-导出会话与产物清理.md`
  - 更新为待验证并记录实际实现。
