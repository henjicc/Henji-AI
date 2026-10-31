// 在已加载本分支源码的 Electron 开发版渲染进程控制台粘贴本文件。
// 调用：await compareExportFrame('准确的剪辑文档ID', Math.round(17.5 * 60))。
// 读取当前序列并生成内存 PNG；不创建导出任务、不编码视频、不保存项目或交付文件；分析缓存按正式流程补齐。
globalThis.compareExportFrame = async function compareExportFrame(projectId, frame, width = 1920, height = 1080) {
  const [service, presets, sessionModule, frameModule, regions, tracking] = await Promise.all([
    import('/src/features/videoEdit/application/videoEditService.ts'),
    import('/src/core/videoEdit/exportPresets.ts'),
    import('/src/features/videoEdit/engine/videoEditRenderSession.ts'),
    import('/src/features/videoEdit/application/videoEditExportFrame.ts'),
    import('/src/features/videoEdit/application/videoEditSmartRegions.ts'),
    import('/src/features/videoEdit/application/videoEditTracking.ts'),
  ])
  const instance = service.requireVideoEditInstance(projectId)
  const snapshot = structuredClone(service.getActiveVideoEditSequence(instance))
  if (!Number.isInteger(frame) || frame < 0) throw new Error('frame 需要非负整数序列帧。')
  const settings = presets.resolveVideoEditExportSettings({ ...presets.videoEditSequenceExportSettings(snapshot), width, height,
    followSequence: { resolution: false, fps: true, sampleRate: true, channels: true }, usePreviews: false, captionMode: 'burn' }, snapshot)
  const signal = new AbortController().signal
  const smartRegions = await regions.waitVideoEditSmartRegions(snapshot, snapshot, signal)
  await tracking.waitVideoEditTracking(snapshot, snapshot, signal)
  const results = []
  for (const renderAtOutputResolution of [true, false]) {
    const started = performance.now()
    const renderer = new sessionModule.VideoEditRenderSession(snapshot)
    try {
      const output = await frameModule.prepareVideoEditExportFrame(renderer, snapshot, { ...settings, renderAtOutputResolution })
      renderer.setSmartRegions(smartRegions)
      renderer.setTracks(tracking.videoEditTrackResults(snapshot))
      const initializedAt = performance.now()
      // 前一帧只作预热，使两条路径都经历相同的编译、解码和网页跳转。
      if (frame > 0) await renderer.render(frame - 1, true)
      const warmedAt = performance.now()
      await renderer.render(frame, true)
      const renderedAt = performance.now()
      output.copy()
      const copiedAt = performance.now()
      const png = await output.canvas.convertToBlob({ type: 'image/png' })
      results.push({ mode: renderAtOutputResolution ? '按输出' : '完整合成', frame, seconds: frame / snapshot.fps,
        renderWidth: renderer.canvas.width, renderHeight: renderer.canvas.height, width, height,
        initializeMs: initializedAt - started, warmupMs: warmedAt - initializedAt,
        renderMs: renderedAt - warmedAt, copyMs: copiedAt - renderedAt,
        totalFrameMs: copiedAt - warmedAt, png, url: URL.createObjectURL(png) })
    } finally { await renderer.dispose() }
  }
  console.table(results.map(({ png, url, ...row }) => row))
  return { snapshot: { id: snapshot.id, revision: snapshot.revision, fps: snapshot.fps }, results,
    release: () => results.forEach(result => URL.revokeObjectURL(result.url)) }
}
