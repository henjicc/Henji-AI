const FIELDS = {
  revision: ['[data-command-bar]', 'data-document-revision'],
  renderGeneration: ['[data-preview-surface]', 'data-preview-render-generation'],
  overrideCount: ['[data-preview-surface]', 'data-preview-override-count'],
  renderPlanCompileCount: ['[data-presentation-front-surface]', 'data-render-plan-compile-count'],
  cpuTaskStartCount: ['[data-presentation-front-surface]', 'data-cpu-task-start-count'],
  uploadCount: ['[data-presentation-front-surface]', 'data-gpu-upload-count'],
  readbackCount: ['[data-presentation-front-surface]', 'data-gpu-readback-count'],
  frameCount: ['[data-presentation-front-surface]', 'data-gpu-frame-count'],
  surfaceFrameCount: ['[data-presentation-front-surface]', 'data-gpu-surface-frame-count'],
  imageBitmapFrameCount: ['[data-presentation-front-surface]', 'data-gpu-image-bitmap-frame-count'],
  directSurfaceFailureCount: ['[data-presentation-front-surface]', 'data-gpu-direct-surface-failure-count'],
  uniformUpdateCount: ['[data-presentation-front-surface]', 'data-gpu-uniform-update-count'],
  interactionSequence: ['[data-presentation-front-surface]', 'data-interaction-sequence'],
  cameraSequence: ['[data-presentation-front-surface]', 'data-camera-sequence'],
  gpuSceneGeneration: ['[data-presentation-front-surface]', 'data-render-generation'],
}

function createDragPoints(box) {
  const start = { x: Math.round(box.x + box.width * 0.35), y: Math.round(box.y + box.height * 0.35) }
  // 后半段反向移动，最后位置不是历史最大位置；旧帧或旧 transform 不得覆盖末次输入。
  const points = Array.from({ length: 100 }, (_, index) => {
    const step = index + 1
    const distance = step <= 60 ? step : 120 - step
    return { x: start.x + distance, y: start.y + Math.round(distance * 0.5) }
  })
  return { start, points }
}

async function sendNativeDrag(windowHandle, { start, points, intervalMs = 4 }) {
  // 官方 Electron sendInputEvent 要求窗口聚焦。只有固定输入节拍，不等待任何渲染 ACK。
  return windowHandle.evaluate(async (handle, payload) => {
    handle.focus()
    const zoom = handle.webContents.getZoomFactor()
    const send = (type, point, pressed) => handle.webContents.sendInputEvent({
      type, x: Math.round(point.x * zoom), y: Math.round(point.y * zoom),
      button: 'left', clickCount: 1, modifiers: pressed ? ['control', 'leftbuttondown'] : ['control'],
    })
    send('mouseMove', payload.start, false)
    send('mouseDown', payload.start, true)
    const sentAt = []
    for (const point of payload.points) {
      await new Promise((resolve) => setTimeout(resolve, payload.intervalMs))
      sentAt.push(performance.now())
      send('mouseMove', point, true)
    }
    return { offeredEvents: payload.points.length, intervalMs: payload.intervalMs,
      offeredDurationMs: sentAt.at(-1) - sentAt[0], zoom }
  }, { start, points, intervalMs })
}

async function releaseNativeDrag(windowHandle, point) {
  await windowHandle.evaluate((handle, position) => {
    const zoom = handle.webContents.getZoomFactor()
    handle.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1,
      x: Math.round(position.x * zoom), y: Math.round(position.y * zoom), modifiers: ['control'] })
  }, point)
}

function verifyDragTrace(trace) {
  const { before, after, frames, inputs, finalPoint } = trace
  if (before.overrideCount !== 0 || before.readbackCount !== 0 || before.imageBitmapFrameCount !== 0
    || before.directSurfaceFailureCount !== 0) throw new Error('拖动基线并非无回读直接GPU路径')
  for (const evidence of [before, ...frames, after]) {
    for (const key of Object.keys(FIELDS)) {
      if (!Number.isFinite(evidence[key]) || evidence[key] < 0) throw new Error(`缺少真实拖动计数：${key}`)
    }
    for (const key of ['revision', 'renderGeneration', 'overrideCount', 'renderPlanCompileCount',
      'cpuTaskStartCount', 'uploadCount', 'readbackCount', 'imageBitmapFrameCount',
      'directSurfaceFailureCount', 'cameraSequence', 'gpuSceneGeneration']) {
      if (evidence[key] !== before[key]) throw new Error(`拖动出现权威/CPU/上传/回读副作用：${key}`)
    }
  }
  if (!inputs.length || inputs.some((input) => !input.trusted)
    || Math.abs(inputs.at(-1).x - finalPoint.x) > 1 || Math.abs(inputs.at(-1).y - finalPoint.y) > 1) {
    throw new Error('连续原生输入未送达最终位置')
  }
  let previous = before
  for (const frame of [...frames, after]) {
    if (frame.interactionSequence < previous.interactionSequence || frame.frameCount < previous.frameCount) {
      throw new Error('旧帧覆盖新手势')
    }
    previous = frame
  }
  const frameDelta = after.frameCount - before.frameCount
  const uniformDelta = after.uniformUpdateCount - before.uniformUpdateCount
  if (frameDelta < 1 || uniformDelta < 1 || uniformDelta > frameDelta
    || after.surfaceFrameCount <= before.surfaceFrameCount
    || after.interactionSequence - before.interactionSequence < inputs.length) {
    throw new Error('末次手势没有完成直接 Surface 提交确认')
  }
  const samples = frames.filter((frame) => frame.interactionSequence > before.interactionSequence
    && Number.isFinite(frame.eventToSubmissionAckMs)).map((frame) => frame.eventToSubmissionAckMs)
  if (!samples.length) throw new Error('没有有效的提交确认耗时样本')
  const percentile = (q) => [...samples].sort((a, b) => a - b)[Math.min(samples.length - 1, Math.floor(samples.length * q))]
  return { offeredEventCount: 100, receivedPointerMoves: inputs.length, acknowledgedFrameCount: frameDelta,
    uniformUpdateDelta: uniformDelta, submissionAckSamples: samples.length,
    eventToSubmissionAckP95Ms: percentile(0.95), eventToSubmissionAckP99Ms: percentile(0.99),
    latencyMeaning: 'event-to-worker-submission-ack; not GPU completion or physical screen presentation',
    comparison: 'no-comparable-CPU-baseline',
    hotPath: { revisionDelta: after.revision - before.revision,
      previewOverrideDelta: after.overrideCount - before.overrideCount,
      renderPlanDelta: after.renderPlanCompileCount - before.renderPlanCompileCount,
      cpuTaskDelta: after.cpuTaskStartCount - before.cpuTaskStartCount,
      uploadDelta: after.uploadCount - before.uploadCount, readbackDelta: after.readbackCount - before.readbackCount } }
}

function assertGpuFrameOrder(frames) {
  for (let index = 1; index < frames.length; index += 1) {
    const previous = frames[index - 1]; const next = frames[index]
    if (next.gpuSceneGeneration < previous.gpuSceneGeneration
      || (next.gpuSceneGeneration === previous.gpuSceneGeneration
        && (next.cameraSequence < previous.cameraSequence || next.interactionSequence < previous.interactionSequence))) {
      throw new Error('松手/新场景后旧GPU帧覆盖最新状态')
    }
  }
}

async function assertVisibleFixtureColors(bytes, expectedColors) {
  const { data, info } = await require('sharp')(bytes).resize({ width: 480 }).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  for (const color of expectedColors) {
    let matches = 0
    for (let index = 0; index < data.length; index += info.channels) {
      if (color.every((channel, offset) => Math.abs(data[index + offset] - channel) <= 8)) matches += 1
    }
    if (matches < 4) throw new Error(`合成五层有不可见元素，缺少颜色：${color.join(',')}`)
  }
}

function isGpuSurfaceReady(state) {
  // GPU 接管后可卸载 CPU/DOM 代理栈；代理栈既不是 GPU 就绪条件，也不能代替 GPU 呈现。
  return state.composition === 'gpu' && state.presentation === 'webgpu-surface'
    && state.visible === true && Number.isFinite(state.coverage) && state.coverage > 0
    && state.frameCount > 0 && state.surfaceFrameCount > 0 && state.imageBitmapFrameCount === 0
}

async function waitForVisibleFixtureColors(page, capture, expectedColors) {
  const deadline = Date.now() + 30000
  let failure
  while (Date.now() < deadline) {
    const bytes = await capture()
    try { await assertVisibleFixtureColors(bytes, expectedColors); return }
    catch (error) {
      if (!(error instanceof Error) || !error.message.startsWith('合成五层有不可见元素')) throw error
      failure = error
    }
    await page.waitForTimeout(80)
  }
  throw new Error(`GPU提交确认后五层实际像素仍未就绪：${failure?.message}`)
}

async function runContinuousGpuDrag({ page, app, editor, box }) {
  if (!app) throw new Error('真实连续拖动需要正式 runner 的 Electron 实例')
  const gesture = createDragPoints(box)
  const finalPoint = gesture.points.at(-1)
  const windowHandle = await app.browserWindow(page)
  const token = `__realityDrag${Date.now()}`
  await editor.evaluate((root, { fields, key }) => {
    const read = () => {
      const values = Object.fromEntries(Object.entries(fields).map(([name, [selector, attribute]]) => {
        const raw = root.querySelector(selector)?.getAttribute(attribute)
        return [name, raw === null || raw === undefined || raw === '' ? null : Number(raw)]
      }))
      const latency = root.querySelector('[data-presentation-front-surface]')?.getAttribute('data-event-to-present-ms')
      return { ...values, eventToSubmissionAckMs: latency ? Number(latency) : null }
    }
    const state = { before: read(), frames: [], inputs: [], read }
    const observer = new MutationObserver(() => {
      const next = read()
      if (state.frames.at(-1)?.frameCount !== next.frameCount
        || state.frames.at(-1)?.gpuSceneGeneration !== next.gpuSceneGeneration) state.frames.push(next)
    })
    observer.observe(root, { subtree: true, attributes: true, attributeFilter: [...new Set(Object.values(fields).map(([, field]) => field))] })
    const onMove = (event) => {
      if (event.buttons & 1) state.inputs.push({ x: event.clientX, y: event.clientY, trusted: event.isTrusted })
    }
    document.addEventListener('pointermove', onMove, true)
    state.dispose = () => { observer.disconnect(); document.removeEventListener('pointermove', onMove, true) }
    window[key] = state
  }, { fields: FIELDS, key: token })
  let released = false
  try {
    const driver = await sendNativeDrag(windowHandle, gesture)
    await page.waitForFunction(({ key, point }) => {
      const state = window[key]
      const last = state?.inputs.at(-1)
      const current = state?.read()
      return last && Math.abs(last.x - point.x) <= 1 && Math.abs(last.y - point.y) <= 1
        && current.interactionSequence >= state.before.interactionSequence + state.inputs.length
    }, { key: token, point: finalPoint }, { timeout: 10000 })
    const trace = await page.evaluate((key) => {
      const state = window[key]
      return { before: state.before, after: state.read(), frames: state.frames, inputs: state.inputs }
    }, token)
    const metrics = verifyDragTrace({ ...trace, finalPoint })
    await releaseNativeDrag(windowHandle, finalPoint)
    released = true
    await page.waitForFunction((key) => {
      const state = window[key]; const next = state.read()
      return next.revision === state.before.revision + 1 && next.gpuSceneGeneration > state.before.gpuSceneGeneration
    }, token, { timeout: 15000 })
    await page.waitForTimeout(150)
    const releasedFrames = await page.evaluate((key) => [...window[key].frames, window[key].read()], token)
    assertGpuFrameOrder([trace.before, ...releasedFrames])
    return { ...metrics, driver, start: gesture.start, finalPoint, before: trace.before, after: trace.after }
  } finally {
    if (!released) await releaseNativeDrag(windowHandle, finalPoint)
    await page.evaluate((key) => { window[key]?.dispose(); delete window[key] }, token)
  }
}

module.exports = { createDragPoints, sendNativeDrag, releaseNativeDrag, verifyDragTrace,
  runContinuousGpuDrag, assertVisibleFixtureColors, assertGpuFrameOrder, isGpuSurfaceReady, waitForVisibleFixtureColors }
