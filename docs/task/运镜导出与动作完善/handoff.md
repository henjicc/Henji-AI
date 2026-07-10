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
