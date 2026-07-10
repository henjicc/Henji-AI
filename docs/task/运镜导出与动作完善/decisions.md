# 决策记录

## 2026-07-10：动作片段驱动选择方案 A

- 决策：角色动作完全跟随时间轴；暂停时定格。
- 落地：每帧以 `playback.currentTime * motion.speed` 调用 `AnimationMixer.setTime()`。
- 原因：同一时间点的姿态在预览和导出中一致，避免墙钟帧耗时造成导出不确定。
