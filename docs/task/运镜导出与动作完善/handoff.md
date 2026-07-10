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
