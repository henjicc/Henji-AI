const fsp = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')

const CAMERA_NODE_ID = '__ui_camera_stage_assistant_capability'
const REQUIRED_CAPABILITY_IDS = [
  'create_camera_stage_project',
  'render_camera_stage_output',
  'get_camera_stage_render_task',
  'cancel_camera_stage_render_task',
  'apply_camera_stage_camera_move',
]

function hasFormalCapabilityRegistryExports(source) {
  const exportBlocks = source.matchAll(/export\s*\{([\s\S]*?)\}\s*;?/g)
  for (const match of exportBlocks) {
    const exported = match[1]
    if (/\bexecuteApplicationCapabilityResult\b/.test(exported)
      && /\blistRendererApplicationCapabilityIds\b/.test(exported)) return true
  }
  return false
}

async function findRendererCapabilityRegistryAsset(
  assetsDir = path.join(process.cwd(), 'out', 'renderer', 'assets')
) {
  const names = (await fsp.readdir(assetsDir))
    .filter((name) => /^registry-[a-zA-Z0-9_-]+\.js$/.test(name))
  const matches = []
  for (const name of names) {
    const source = await fsp.readFile(path.join(assetsDir, name), 'utf8')
    if (hasFormalCapabilityRegistryExports(source)) matches.push(name)
  }
  if (matches.length !== 1) {
    throw new Error(`正式能力注册构建模块必须唯一，实际 ${matches.length} 个`)
  }
  return matches[0]
}

function requirePersistedCreatedProject(created, record) {
  if (!record || record.id !== created.projectId || record.name !== created.name) {
    throw new Error(`后台创建的 3D 工程没有按返回引用落盘：${JSON.stringify(record)}`)
  }
  let scene
  try {
    scene = JSON.parse(record.sceneJson)
  } catch {
    throw new Error('后台创建的 3D 工程场景不是有效 JSON')
  }
  const cameraRef = created.resultRefs?.[1]
  const stateKeyframeRef = created.resultRefs?.[2]
  const camera = scene.objects?.find((object) => object.id === created.defaultCameraId)
  const stateKeyframe = scene.stateKeyframes?.find(
    (candidate) => candidate.id === created.defaultStateKeyframeId
  )
  const valid = record.objectCount === 1
    && scene.objects?.length === 1
    && camera?.type === 'camera'
    && scene.activeCameraId === created.defaultCameraId
    && scene.stateKeyframes?.length === 1
    && stateKeyframe?.time === 0
    && stateKeyframe?.cameraId === created.defaultCameraId
    && created.resultRefs?.[0]?.kind === 'camera_stage.project'
    && created.resultRefs[0].id === created.projectId
    && cameraRef?.kind === 'camera_stage.camera'
    && cameraRef.id === `${created.projectId}:${created.defaultCameraId}`
    && stateKeyframeRef?.kind === 'camera_stage.state_keyframe'
    && stateKeyframeRef.id === `${created.projectId}:${created.defaultStateKeyframeId}`
  if (!valid) {
    throw new Error(`后台创建的默认相机、关键帧或稳定引用不一致：${JSON.stringify({
      objectCount: record.objectCount,
      activeCameraId: scene.activeCameraId,
      cameraId: camera?.id ?? null,
      cameraType: camera?.type ?? null,
      stateKeyframeId: stateKeyframe?.id ?? null,
      stateKeyframeTime: stateKeyframe?.time ?? null,
      stateKeyframeCameraId: stateKeyframe?.cameraId ?? null,
      resultRefs: created.resultRefs ?? null,
    })}`)
  }
  return { cameraId: camera.id, stateKeyframeId: stateKeyframe.id }
}

function requireVideoReadyCameraStageProject(created, record) {
  if (!record || record.id !== created.projectId) {
    throw new Error('运镜后的 3D 工程没有按返回引用落盘')
  }
  const scene = JSON.parse(record.sceneJson)
  const camera = scene.objects?.find((object) => object.id === created.defaultCameraId)
  if (camera?.type !== 'camera'
    || scene.activeCameraId !== created.defaultCameraId
    || !Array.isArray(scene.stateKeyframes)
    || scene.stateKeyframes.length < 2
    || scene.stateKeyframes[0]?.id !== created.defaultStateKeyframeId
    || !scene.stateKeyframes.some((stateKeyframe) => stateKeyframe.time > 0)) {
    throw new Error('正式运镜能力没有持久化视频所需的第二个状态关键帧')
  }
  return scene.stateKeyframes.length
}

async function beginCameraStageTaskEventCapture(page) {
  await page.evaluate(() => {
    window.__henjiRealityCameraStageTaskEvents?.dispose?.()
    const events = []
    const dispose = window.henjiNative.cameraStageRender.onEvent((event) => {
      events.push({
        canvasProjectId: event.canvasProjectId,
        nodeId: event.nodeId,
        requestId: event.requestId,
        status: event.status,
      })
    })
    window.__henjiRealityCameraStageTaskEvents = { dispose, events }
  })
}

async function endCameraStageTaskEventCapture(page) {
  await page.evaluate(() => {
    window.__henjiRealityCameraStageTaskEvents?.dispose?.()
    delete window.__henjiRealityCameraStageTaskEvents
  })
}

async function readActiveVideoRequestId(page, canvasProjectId) {
  return await page.evaluate(async ({ projectId, nodeId }) => {
    const tasks = await window.henjiNative.cameraStageRender.list(projectId)
    const matches = tasks.filter((task) => task.nodeId === nodeId
      && task.outputKind === 'video'
      && (task.status === 'queued' || task.status === 'running'))
    if (matches.length !== 1) {
      throw new Error(`活动视频渲染任务必须唯一，实际 ${matches.length} 个`)
    }
    return matches[0].requestId
  }, { projectId: canvasProjectId, nodeId: CAMERA_NODE_ID })
}

function resolveCancelledTaskEvent(events, requestId) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event.requestId !== requestId
      || !['completed', 'failed', 'cancelled'].includes(event.status)) continue
    if (event.status !== 'cancelled') {
      throw new Error(`待取消视频任务意外进入 ${event.status}`)
    }
    return event
  }
  return null
}

async function waitForCancelledTaskEvent(page, requestId, timeoutMs) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const events = await page.evaluate(() => (
      window.__henjiRealityCameraStageTaskEvents?.events ?? []
    ))
    const terminal = resolveCancelledTaskEvent(events, requestId)
    if (terminal) return terminal
    await page.waitForTimeout(100)
  }
  throw new Error('没有收到待取消视频任务对应的 cancelled 终态事件')
}

async function executeCapability(page, registryAsset, invocation, taskId) {
  return await page.evaluate(async ({ assetName, capability, callId }) => {
    const moduleUrl = new URL(`./assets/${assetName}`, window.location.href).href
    const registry = await import(moduleUrl)
    return await registry.executeApplicationCapabilityResult(capability, {
      signal: new AbortController().signal,
      requestId: callId,
      taskId: callId,
    })
  }, { assetName: registryAsset, capability: invocation, callId: taskId })
}

function requireCapabilitySuccess(result, capabilityId) {
  if (!result?.ok) {
    throw new Error(`${capabilityId} 正式处理器失败：${JSON.stringify(result?.error ?? null)}`)
  }
  return result.data
}

function requireSubmittedTask(result, capabilityId) {
  const task = requireCapabilitySuccess(result, capabilityId)
  if (task.status !== 'submitted' || task.taskRef?.kind !== 'camera_stage.render_task') {
    throw new Error(`${capabilityId} 没有返回稳定已提交任务：${JSON.stringify(task)}`)
  }
  return task
}

function requireCompletedTask(task, canvasProjectId) {
  if (task.status !== 'completed' || task.resultRefs?.length !== 1
    || task.resultRefs[0]?.kind !== 'canvas.node'
    || !task.resultRefs[0].id.startsWith(`${canvasProjectId}:`)) {
    throw new Error(`图片输出 completed 未返回唯一持久结果节点：${JSON.stringify(task)}`)
  }
  return task
}

function requireCancellationRequested(result) {
  const cancellation = requireCapabilitySuccess(result, 'cancel_camera_stage_render_task')
  if (cancellation.status !== 'cancellation_requested' || cancellation.resultRefs?.length !== 0) {
    throw new Error(`活动视频任务没有接受取消：${JSON.stringify(cancellation)}`)
  }
  return cancellation
}

function createCameraStageNode(projectId) {
  return {
    id: CAMERA_NODE_ID,
    type: 'cameraStageNode',
    position: { x: 220, y: 160 },
    width: 480,
    height: 320,
    measured: { width: 480, height: 320 },
    style: { width: 480, height: 320 },
    data: {
      displayName: '助手后台输出镜头',
      projectId,
      imageUrl: null,
      previewImageUrl: null,
      videoUrl: null,
      aspectRatio: '16:9',
      durationSec: null,
      selectedTimeSec: 0.25,
      mediaInputs: {},
      environmentImageUrl: null,
      imageExporting: false,
      imageRenderRequestId: null,
      imageRenderError: null,
      videoProgress: null,
      videoExporting: false,
      videoRenderPhase: null,
      videoRenderRequestId: null,
      videoRenderError: null,
      renderTask: null,
      outputKind: 'image',
    },
  }
}

async function waitForTaskStatus(
  page, registryAsset, taskRef, accepted, rejected, timeoutMs, executionPrefix
) {
  const startedAt = Date.now()
  let attempt = 0
  while (Date.now() - startedAt < timeoutMs) {
    const result = await executeCapability(page, registryAsset, {
      id: 'get_camera_stage_render_task',
      version: 1,
      input: { taskRef },
    }, `${executionPrefix}-get-${++attempt}`)
    const task = requireCapabilitySuccess(result, 'get_camera_stage_render_task')
    if (accepted.includes(task.status)) return task
    if (rejected.includes(task.status)) {
      throw new Error(`3D 输出任务提前进入 ${task.status}：${task.message ?? ''}`)
    }
    await page.waitForTimeout(200)
  }
  throw new Error(`等待 3D 输出任务状态 ${accepted.join('/')} 超时`)
}

async function readCanvasNodes(page, projectId) {
  return await page.evaluate(async (canvasProjectId) => {
    const rows = await window.henjiNative.db.select(
      'SELECT nodes_json FROM storyboard_projects WHERE id = ? LIMIT 1',
      [canvasProjectId]
    )
    return rows.length ? JSON.parse(rows[0].nodes_json) : []
  }, projectId)
}

async function setupCameraStageAssistantCapability(page, context, inspection = {}) {
  const { seedAndOpenCanvasPanoramaProject, settlePage } = context
  const executionPrefix = `reality-camera-stage-capability-${randomUUID()}`
  const registryAsset = await findRendererCapabilityRegistryAsset()
  const registered = await page.evaluate(async (assetName) => {
    const moduleUrl = new URL(`./assets/${assetName}`, window.location.href).href
    const registry = await import(moduleUrl)
    return registry.listRendererApplicationCapabilityIds()
  }, registryAsset)
  for (const capabilityId of REQUIRED_CAPABILITY_IDS) {
    if (!registered.includes(capabilityId)) throw new Error(`正式渲染层缺少能力 ${capabilityId}`)
  }

  const { projectId: canvasProjectId } = await seedAndOpenCanvasPanoramaProject(page)
  const created = requireCapabilitySuccess(await executeCapability(page, registryAsset, {
    id: 'create_camera_stage_project',
    version: 4,
    input: { name: '真实性巡检-助手后台3D工程' },
  }, `${executionPrefix}-create-project`), 'create_camera_stage_project')
  if (!await page.locator('.react-flow:visible').count()) {
    throw new Error('后台创建 3D 工程不应离开当前画布')
  }
  if (await page.locator('[data-camera-stage-editor]:visible').count()) {
    throw new Error('后台创建 3D 工程不应打开 3D 编辑器')
  }
  const persistedCameraProject = await page.evaluate(
    async (projectId) => await window.henjiNative.cameraStageProjects.getProjectRecord(projectId),
    created.projectId
  )
  requirePersistedCreatedProject(created, persistedCameraProject)
  requireCapabilitySuccess(await executeCapability(page, registryAsset, {
    id: 'apply_camera_stage_camera_move',
    version: 1,
    input: {
      projectId: created.projectId,
      cameraId: created.defaultCameraId,
      baseRevision: created.baseRevision,
      move: { kind: 'truck', offset: 1.5 },
      targetPoint: { x: 0, y: 0, z: 0 },
      duration: 2,
      speed: 'uniform',
    },
  }, `${executionPrefix}-prepare-video-keyframe`), 'apply_camera_stage_camera_move')
  const videoReadyProject = await page.evaluate(
    async (projectId) => await window.henjiNative.cameraStageProjects.getProjectRecord(projectId),
    created.projectId
  )
  requireVideoReadyCameraStageProject(created, videoReadyProject)
  if (!await page.locator('.react-flow:visible').count()
    || await page.locator('[data-camera-stage-editor]:visible').count()) {
    throw new Error('后台准备视频关键帧不应离开当前画布或打开 3D 编辑器')
  }

  await page.getByRole('button', { name: /返回项目|Back to Projects/ }).click()
  await settlePage(page, 400)
  const cameraNode = createCameraStageNode(created.projectId)
  await page.evaluate(async ({ projectId, node }) => {
    await window.henjiNative.db.execute(
      'UPDATE storyboard_projects SET node_count = 1, nodes_json = ?, edges_json = ?, viewport_json = ?, history_json = ? WHERE id = ?',
      [JSON.stringify([node]), '[]', JSON.stringify({ x: 180, y: 100, zoom: 0.8 }),
        JSON.stringify({ past: [], future: [], imagePool: [] }), projectId]
    )
  }, { projectId: canvasProjectId, node: cameraNode })
  await page.locator(`[data-project-id="${canvasProjectId}"]:visible`).click()
  await page.locator(`.react-flow__node[data-id="${CAMERA_NODE_ID}"]`)
    .waitFor({ state: 'visible', timeout: 12000 })

  const projectRef = { kind: 'canvas.project', id: canvasProjectId }
  const nodeRef = { kind: 'canvas.node', id: `${canvasProjectId}:${CAMERA_NODE_ID}` }
  const submitted = requireSubmittedTask(await executeCapability(page, registryAsset, {
    id: 'render_camera_stage_output',
    version: 1,
    input: { projectRef, nodeRef, outputKind: 'image', resolutionPreset: '720p', selectedTimeSec: 0.25 },
  }, `${executionPrefix}-render-image`), 'render_camera_stage_output')
  const completed = requireCompletedTask(await waitForTaskStatus(
    page,
    registryAsset,
    submitted.taskRef,
    ['completed'],
    ['failed', 'cancelled', 'interrupted'],
    45000,
    executionPrefix
  ), canvasProjectId)
  const imageNodes = await readCanvasNodes(page, canvasProjectId)
  const imageResultId = completed.resultRefs[0].id.slice(`${canvasProjectId}:`.length)
  if (!imageNodes.some((node) => node.id === imageResultId && node.type === 'exportImageNode')) {
    throw new Error('图片输出任务引用没有对应到正式持久画布结果')
  }

  await beginCameraStageTaskEventCapture(page)
  try {
    const videoSubmitted = requireSubmittedTask(await executeCapability(page, registryAsset, {
      id: 'render_camera_stage_output',
      version: 1,
      input: { projectRef, nodeRef, outputKind: 'video', resolutionPreset: '720p' },
    }, `${executionPrefix}-render-video`), 'render_camera_stage_output')
    const active = await waitForTaskStatus(
      page,
      registryAsset,
      videoSubmitted.taskRef,
      ['queued', 'running'],
      ['completed', 'failed', 'cancelled', 'interrupted'],
      8000,
      executionPrefix
    )
    if (active.resultRefs.length !== 0) throw new Error('活动视频任务不应提前返回结果节点')
    const videoRequestId = await readActiveVideoRequestId(page, canvasProjectId)
    requireCancellationRequested(await executeCapability(page, registryAsset, {
      id: 'cancel_camera_stage_render_task',
      version: 1,
      input: { taskRef: videoSubmitted.taskRef },
    }, `${executionPrefix}-cancel-video`))
    await waitForCancelledTaskEvent(page, videoRequestId, 15000)
    await page.waitForFunction(async ({ projectId, nodeId }) => {
      const rows = await window.henjiNative.db.select(
        'SELECT nodes_json FROM storyboard_projects WHERE id = ? LIMIT 1', [projectId]
      )
      const nodes = rows.length ? JSON.parse(rows[0].nodes_json) : []
      const source = nodes.find((node) => node.id === nodeId)
      return source?.data?.renderTask == null && source?.data?.videoExporting === false
        && nodes.every((node) => node.type !== 'exportVideoNode')
    }, { projectId: canvasProjectId, nodeId: CAMERA_NODE_ID }, { timeout: 15000 })
  } finally {
    await endCameraStageTaskEventCapture(page)
  }
  if (typeof inspection.capture === 'function') await inspection.capture('assistant-capability-completed-cancelled')
}

module.exports = {
  findRendererCapabilityRegistryAsset,
  hasFormalCapabilityRegistryExports,
  requireCancellationRequested,
  requireCompletedTask,
  requirePersistedCreatedProject,
  requireSubmittedTask,
  requireVideoReadyCameraStageProject,
  resolveCancelledTaskEvent,
  setupCameraStageAssistantCapability,
}
