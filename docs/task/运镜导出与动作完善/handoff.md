# 阶段交接

## 1.1 动作片段确定性驱动（已完成）

- `CharacterModel.tsx` 已移除 `mixer.update(delta)` 和 `action.timeScale` effect。
- 动作 action 仍只在片段切换时重建；速度变化不会重建 action。
- `useFrame` 从 `useCameraStageStore.getState().playback.currentTime` 读取播放头，并用
  `mixer.setTime(currentTime * motion.speed)` 定位。
- 1.2 要处理 clip 动作与关节关键帧的互斥，注意保留本任务的时间轴驱动，不要恢复墙钟 `delta` 推进。
- 仅渲染层改动，Electron 开发模式应热更新；无需重启 `npm run electron:dev`。

## 2.1 帧数据二进制传输（待主控审查）

- `cropDataUrlToAspectRatioBytes()` 与既有 dataURL 裁剪共用画布裁剪逻辑，视频导出改向其请求 PNG 字节。
- `AppendVideoFrameExportPayload`、preload、主进程 DTO 与 IPC 解析已统一为非空 `Uint8Array` 的 `bytes` 字段；commands/adapters/preload 透传层由该契约类型约束。
- 主进程直接 `writeFile(framePath, payload.bytes)`，`decodePngDataUrl` 已删除。
- 四项静态检查均通过。涉及 preload/主进程，用户验收前须重启 `npm run electron:dev`。
- 下一任务 2.2 需基于当前 `frame-export.ts` 的会话清理逻辑继续加固，不应恢复 dataURL/base64 帧传输。

## 1.2 动作片段与关节采样互斥（已完成）

- `CharacterModel.tsx` 已把播放期 applier 拆为关节与颜色两个 effect。
- `activeClip` 非空时，关节 applier effect 不注册；`activeClip` 变化时 React 会执行既有清理，切回静态姿势后自动恢复注册。
- 颜色 applier 不依赖 motion，始终存在，clip 模式也能采样颜色关键帧。
- 1.1 的 `mixer.setTime(currentTime * motion.speed)` 保持未变，未恢复基于 delta 的更新。
- 仅渲染层改动，Electron 开发模式应热更新；无需重启 `npm run electron:dev`。

## 2.2 导出会话与产物清理（已完成）

- `frame-export.ts` 保持 2.1 的 `bytes: Uint8Array` 帧写入契约，未恢复 dataURL/base64。
- ffmpeg 输出固定为会话目录的 `output.mp4`，成功后才发布 Uploads；跨卷时通过 Uploads 中隐藏 `.henji-camera-stage-export-*.part` 文件暂存，再改名为最终 MP4。
- 模块级会话增加 `lastActivity`，追加帧与开始编码会刷新；5 分钟扫描器清理 30 分钟空闲会话，且不阻止应用退出。
- `window.ts` 已在 reload、render-process-gone、webContents destroyed、window closed 清理所有会话；用户需在真实 Electron 窗口验证取消/刷新路径。
- 导出文件名现在使用本地时间。涉及 Electron 主进程，下一次验收前必须重启 `npm run electron:dev`。

## 3.1 编码真实进度推送（待主控审查）

- `frame-export.ts` 在 ffmpeg stderr 增量中解析 `frame=\s*(\d+)`；每个递增帧数均经会话回调推送，成功关闭时补发总帧数。
- `video:startFrameExport` 捕获调用方 `event.sender`，仅向该未销毁的 webContents 发送 `video:frameExportProgress`，payload 为 `{ sessionId, encodedFrames }`。
- preload、PAL、`src/commands/video.ts` 新增 `onFrameExportProgress` / `onVideoFrameExportProgress` 订阅并返回注销函数。
- `cameraStageVideo.ts` 对当前 sessionId 过滤进度，并在 `finally` 注销；编码开始显示 `0/total`，`CameraStageEditor` 显示“编码 x/y”。
- 四项静态检查通过。需要真实 Electron 窗口验证进度增长及编码阶段取消；涉及主进程/preload，需重启 `npm run electron:dev`。

## 3.2 离屏渲染目标分辨率导出（已阻塞，待用户确认）

- 技术定位已完成，未改产品代码：`StageCaptureBridge` 目前仅从 `gl.domElement` 读取视口 PNG；`exportCameraStageVideo` 再裁剪、缩放。
- 推荐用户确认方案 B：扩展捕获桥以提供目标尺寸 PNG bytes，复用现有 renderer，使用 `WebGLRenderTarget` 对当前 scene 和克隆后的默认相机进行离屏渲染。不要新建第二 renderer。
- 方案 B 实施时需：每次 seek/渲染完成后克隆默认相机并按输出宽高更新 aspect；复用 RenderTarget/RGBA 缓冲/2D 编码画布；`finally` 恢复 renderer target/clear 状态并 dispose；读回像素 Y 翻转，设置 target texture color space 与 renderer 输出一致。
- 视频导出应改直接消费离屏 PNG bytes，去除视频路径中的 `cropDataUrlToAspectRatioBytes()`；截图继续走现有 `StageCaptureFn` dataURL + 裁剪，避免功能回归。
- 用户确认前，不得实施步骤 2 或提交产品代码。仅渲染层预计可热更新；实际实现完成后再给出正式重启结论。

## 3.2 离屏渲染目标分辨率导出（已完成）

- 用户确认方案 B 后，`StageCaptureFn` 已支持带目标尺寸的异步离屏 PNG bytes 捕获，并为视频导出提供 `disposeOffscreen()`。
- 每帧克隆默认透视相机、更新目标 aspect，复用 RenderTarget/RGBA 缓冲/翻转缓冲/2D 编码画布；target texture colorSpace 对齐 renderer 输出，Y 翻转后生成 PNG bytes。
- 每帧 finally 恢复 renderer target、viewport、scissor、scissor test 与 autoClear；视频导出 finally 主动释放 target，组件卸载亦兜底释放。
- `cameraStageVideo.ts` 已直接消费离屏 PNG bytes，视频路径不再调用 `cropDataUrlToAspectRatioBytes()`；截图无参捕获与 dataURL 裁剪保持不变。
- 仅渲染层改动，Electron 开发模式会热更新；无需重启 `npm run electron:dev`。真实 Electron 验收仍待用户执行。

## 最终任务状态

- 六项计划任务均已实现、审查并提交；未遗留待实现代码。
- 真实 Electron 手测尚未由用户执行，步骤集中在 `test-report.md`；涉及主进程/preload 的 2.1、2.2、3.1 验收前须重启开发进程。
