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

## 2026-07-10：导出产物采用会话目录编码后发布

- 决策：ffmpeg 仅输出到会话临时目录；编码完成后再发布到 Uploads。跨卷移动以 Uploads 内隐藏 `.part` 暂存文件承接复制，成功后原子改名。
- 原因：取消或编码失败时，半成品随会话目录删除；跨卷复制期间不暴露 `.mp4` 半成品。下次首次导出会回收上次异常遗留的隐藏暂存文件。

## 2026-07-10：导出会话采用双层孤儿回收

- 决策：主窗口重载、渲染进程退出、webContents 销毁和窗口关闭时批量清理；同时以 5 分钟扫描器回收 30 分钟无活动会话，扫描计时器 `unref()`。
- 原因：生命周期钩子处理刷新/崩溃主路径，超时回收兜住未触发生命周期通知的内存会话与临时帧目录。

## 2026-07-10：编码进度按导出会话定向推送

- 决策：ffmpeg stderr 增量解析出的编码帧数由发起 `startFrameExport` 的 IPC sender 定向推送，payload 带 `sessionId`；渲染层只消费当前会话事件并在导出 `finally` 注销订阅。
- 原因：避免多窗口或连续导出串扰，且避免 preload 事件监听在取消、失败、完成后残留。

## 2026-07-10：离屏渲染选型建议待用户确认

- 建议：选择方案 B 的单 renderer + `WebGLRenderTarget` 变体；不创建第二个 WebGL renderer。
- 依据：当前 `StageCaptureBridge` 位于 R3F Canvas 内部，可取得 `gl`、`scene` 和默认的 `StageViewportCamera`；逐帧 seek 后该相机已具备正确姿态。RenderTarget 能以目标尺寸直接渲染，且不会改动可见 canvas、R3F `size` 状态或视口相机。
- 取舍：须实现像素读回、Y 翻转、颜色空间对齐、缓冲复用与 target dispose；换取导出期间无闪变、无视口分辨率依赖。方案 A 虽改动较少，但共享 renderer 尺寸与自动渲染的恢复风险不可接受为默认方案。
- 状态：未定案，等待用户在方案 B 与方案 A 间确认后才实施。

## 2026-07-10：离屏渲染采用方案 B

- 决策：用户确认单 renderer + `WebGLRenderTarget` 变体；不创建第二个 WebGL renderer。
- 落地：目标尺寸视频帧以克隆后的默认透视相机渲染到 target，读回 RGBA 后 Y 翻转并编码为 PNG bytes。视频路径不再执行 dataURL 居中裁剪/上采样；截图保持原链路。
- 资源：每帧 finally 恢复 renderer target、viewport、scissor、scissor test 与 autoClear；视频导出 finally 和组件卸载均 dispose target。
- 状态：已完成。
