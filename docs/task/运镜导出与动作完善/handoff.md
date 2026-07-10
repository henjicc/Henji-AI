# 阶段交接

## 1.1 动作片段确定性驱动（已完成）

- `CharacterModel.tsx` 已移除 `mixer.update(delta)` 和 `action.timeScale` effect。
- 动作 action 仍只在片段切换时重建；速度变化不会重建 action。
- `useFrame` 从 `useCameraStageStore.getState().playback.currentTime` 读取播放头，并用
  `mixer.setTime(currentTime * motion.speed)` 定位。
- 1.2 要处理 clip 动作与关节关键帧的互斥，注意保留本任务的时间轴驱动，不要恢复墙钟 `delta` 推进。
- 仅渲染层改动，Electron 开发模式应热更新；无需重启 `npm run electron:dev`。
