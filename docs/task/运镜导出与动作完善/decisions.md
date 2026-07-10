# 决策记录

## 2026-07-10：动作片段驱动选择方案 A

- 决策：角色动作完全跟随时间轴；暂停时定格。
- 落地：每帧以 `playback.currentTime * motion.speed` 调用 `AnimationMixer.setTime()`。
- 原因：同一时间点的姿态在预览和导出中一致，避免墙钟帧耗时造成导出不确定。

## 2026-07-10：动作片段与关节采样注册期互斥

- 决策：仅当动作模式为 clip 且 GLB 中实际存在对应片段（`activeClip` 非空）时，注销并不注册关节播放期 applier。
- 原因：避免热路径逐帧判断，并确保骨骼只由 mixer 写入；颜色 applier 独立注册，持续支持颜色关键帧。

## 2026-07-10：导出帧以 Uint8Array 跨 IPC 传输

- 决策：视频帧裁剪后通过 `canvas.toBlob('image/png')` 转为 `Uint8Array`，六层 IPC 契约统一使用 `bytes` 字段。
- 原因：避免渲染层 PNG base64 编码和主进程正则/base64 解码的额外内存、CPU 开销；Electron IPC 可结构化克隆 typed array。
- 兼容：截图仍使用 `cropDataUrlToAspectRatio()` 的 dataURL 出口，调用方与对外行为保持不变。
