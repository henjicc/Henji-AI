const { randomUUID } = require('node:crypto')
const { authorizeMcpConnection, callTool, connectMcpClient, disableMcp, operationEnvelope } = require('./uiInspectionMcpClient.cjs')

const CAMERA_NODE_ID = '__ui_camera_stage_assistant_capability'
const REQUIRED_CAPABILITY_IDS = [
  'create_document',
  'observe_camera_stage_scene',
  'render_camera_stage_output',
  'get_camera_stage_render_task',
  'cancel_camera_stage_render_task',
  'apply_camera_stage_camera_move',
]
const READ_CAPABILITY_IDS = new Set(['get_camera_stage_render_task', 'observe_camera_stage_scene'])

/**
 * 能力经正式外部入口（现代 MCP）调用。
 *
 * 旧做法按文件名在 out/renderer/assets 里找 registry 构建模块并动态 import；构建分包后注册表并入
 * 应用能力服务的公共块，执行与清单入口不再对外导出，按文件名定位必然 0 个。构建产物的分块与
 * 导出名不是契约，MCP 才是正式公共入口；读写结果统一投影回 `{ ok, data }`。
 */
async function executeCapability(client, invocation, baselines = []) {
  if (READ_CAPABILITY_IDS.has(invocation.id)) return await callTool(client, invocation.id, invocation.input)
  const written = await callTool(client, invocation.id, operationEnvelope(baselines, invocation.input))
  return written.result
}

async function readCapabilityBaseline(client, taskRef) {
  return await callTool(client, 'get_camera_stage_render_task', { taskRef })
}

/**
 * 3.2：镜头参考是通用文档。后台新建走通用 create_document（已命名、非草稿、不切换界面），
 * 文件立即落在作品目录“镜头参考”文件夹里；内容是空场景，第一次打开（观察）时补默认摄像机与首关键帧。
 */
function requirePersistedCreatedDocument(created, read) {
  const documentId = created?.resultRef?.id
  if (created?.resultRef?.kind !== 'documents.document' || !documentId) {
    throw new Error(`create_document 没有返回文档稳定引用：${JSON.stringify(created)}`)
  }
  if (!read || read.meta?.id !== documentId || read.meta.kind !== 'camera_stage'
    || read.meta.name !== created.name || read.meta.draft !== false
    || !String(read.meta.path ?? '').endsWith(`${created.name}.henji-stage`)) {
    throw new Error(`后台创建的镜头参考没有按返回引用落盘：${JSON.stringify(read?.meta ?? null)}`)
  }
  return documentId
}

/** 观察结果必须给出唯一的默认摄像机与 0 秒状态关键帧，且引用的是同一份文档。 */
function requireObservedDefaultScene(documentId, observed) {
  const scene = observed?.scene
  const camera = scene?.objects?.find((object) => object.id === scene.activeCameraId)
  const stateKeyframe = scene?.stateKeyframes?.[0]
  const valid = scene?.documentId === documentId
    && scene.objects?.length === 1
    && camera?.type === 'camera'
    && scene.stateKeyframes?.length === 1
    && stateKeyframe?.time === 0
    && stateKeyframe?.cameraId === camera.id
    && Number.isInteger(observed.baseRevision)
  if (!valid) {
    throw new Error(`新建镜头参考的默认相机、关键帧或稳定引用不一致：${JSON.stringify({
      documentId: scene?.documentId ?? null,
      activeCameraId: scene?.activeCameraId ?? null,
      objects: scene?.objects?.map((object) => ({ id: object.id, type: object.type })) ?? null,
      stateKeyframes: scene?.stateKeyframes?.map((item) => ({ id: item.id, time: item.time, cameraId: item.cameraId })) ?? null,
    })}`)
  }
  return { cameraId: camera.id, stateKeyframeId: stateKeyframe.id, baseRevision: observed.baseRevision }
}

/** 运镜后文档文件里必须有默认摄像机与第二个状态关键帧（视频输出需要时长）。 */
function requireVideoReadyCameraStageDocument(defaults, read) {
  const scene = read?.content
  const camera = scene?.objects?.find((object) => object.id === defaults.cameraId)
  if (read?.meta?.id !== defaults.documentId
    || camera?.type !== 'camera'
    || scene.activeCameraId !== defaults.cameraId
    || !Array.isArray(scene.stateKeyframes)
    || scene.stateKeyframes.length < 2
    || scene.stateKeyframes[0]?.id !== defaults.stateKeyframeId
    || !scene.stateKeyframes.some((stateKeyframe) => stateKeyframe.time > 0)) {
    throw new Error('正式运镜能力没有在镜头参考文档里持久化视频所需的第二个状态关键帧')
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

async function waitForTaskStatus(page, client, taskRef, accepted, rejected, timeoutMs) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const result = await executeCapability(client, { id: 'get_camera_stage_render_task', input: { taskRef } })
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
    const stored = await window.henjiNative.testFixtures.readCanvas(canvasProjectId)
    return (stored?.nodes ?? [])
  }, projectId)
}

async function setupCameraStageAssistantCapability(page, context, inspection = {}) {
  const { seedAndOpenCanvasPanoramaProject, settlePage, reopenCanvasProjectFromStorage } = context
  const { projectId: canvasProjectId } = await seedAndOpenCanvasPanoramaProject(page)
  // 取消视频任务是破坏性操作，需删除授权并提供原读取凭据（与 mcp-camera-render 同一授权档）。
  const identity = await authorizeMcpConnection(page, {
    name: `助手3D后台输出验收-${randomUUID().slice(0, 8)}`, allowWrites: true, allowDestructive: true,
  })
  const client = await connectMcpClient(identity.config, 'Henji camera stage capability Reality')
  try {
    const published = new Set((await client.listTools()).tools.map((tool) => tool.name))
    for (const capabilityId of REQUIRED_CAPABILITY_IDS) {
      if (!published.has(capabilityId)) throw new Error(`正式外部入口缺少能力 ${capabilityId}`)
    }
    await runCameraStageCapabilityChain(page, client, {
      canvasProjectId, settlePage, reopenCanvasProjectFromStorage,
    })
  } finally {
    await client.close()
    await disableMcp(page)
  }
  if (typeof inspection.capture === 'function') await inspection.capture('assistant-capability-completed-cancelled')
}

async function runCameraStageCapabilityChain(page, client, { canvasProjectId, settlePage, reopenCanvasProjectFromStorage }) {
  const created = requireCapabilitySuccess(await executeCapability(client, {
    id: 'create_document',
    input: { kind: 'camera_stage', name: `真实性巡检-助手后台镜头参考-${randomUUID().slice(0, 8)}` },
  }), 'create_document')
  if (!await page.locator('.react-flow:visible').count()) {
    throw new Error('后台创建镜头参考不应离开当前画布')
  }
  if (await page.locator('[data-camera-stage-editor]:visible').count()) {
    throw new Error('后台创建镜头参考不应打开 3D 编辑器')
  }
  const readDocument = async (id) => await page.evaluate(async (documentId) => await window.henjiNative.documents.readDocument({ id: documentId }), id)
  const documentId = requirePersistedCreatedDocument(created, await readDocument(created.resultRef.id))
  const defaults = {
    documentId,
    ...requireObservedDefaultScene(documentId, requireCapabilitySuccess(await executeCapability(client, {
      id: 'observe_camera_stage_scene',
      input: { documentId },
    }), 'observe_camera_stage_scene')),
  }
  requireCapabilitySuccess(await executeCapability(client, {
    id: 'apply_camera_stage_camera_move',
    input: {
      documentId,
      cameraId: defaults.cameraId,
      baseRevision: defaults.baseRevision,
      move: { kind: 'truck', offset: 1.5 },
      targetPoint: { x: 0, y: 0, z: 0 },
      duration: 2,
      speed: 'uniform',
    },
  }), 'apply_camera_stage_camera_move')
  requireVideoReadyCameraStageDocument(defaults, await readDocument(documentId))
  if (!await page.locator('.react-flow:visible').count()
    || await page.locator('[data-camera-stage-editor]:visible').count()) {
    throw new Error('后台准备视频关键帧不应离开当前画布或打开 3D 编辑器')
  }

  await page.getByRole('button', { name: /返回画布列表|Back to Canvases/ }).click()
  await settlePage(page, 400)
  const cameraNode = createCameraStageNode(documentId)
  await page.evaluate(async ({ projectId, node }) => {
    await window.henjiNative.testFixtures.writeCanvas(projectId, { nodes: [node], edges: [], viewport: { x: 180, y: 100, zoom: 0.8 }, clearHistory: true })
  }, { projectId: canvasProjectId, node: cameraNode })
  // 画布实例常驻内存，直接改文件后必须经 reload 重新读取（见 reopenCanvasProjectFromStorage）
  await reopenCanvasProjectFromStorage(page, canvasProjectId)
  await page.locator(`.react-flow__node[data-id="${CAMERA_NODE_ID}"]`)
    .waitFor({ state: 'visible', timeout: 12000 })

  const projectRef = { kind: 'canvas.document', id: canvasProjectId }
  const nodeRef = { kind: 'canvas.node', id: `${canvasProjectId}:${CAMERA_NODE_ID}` }
  const submitted = requireSubmittedTask(await executeCapability(client, {
    id: 'render_camera_stage_output',
    input: { canvasRef: projectRef, nodeRef, outputKind: 'image', resolutionPreset: '720p', selectedTimeSec: 0.25 },
  }), 'render_camera_stage_output')
  const completed = requireCompletedTask(await waitForTaskStatus(
    page, client, submitted.taskRef, ['completed'], ['failed', 'cancelled', 'interrupted'], 45000,
  ), canvasProjectId)
  const imageNodes = await readCanvasNodes(page, canvasProjectId)
  const imageResultId = completed.resultRefs[0].id.slice(`${canvasProjectId}:`.length)
  if (!imageNodes.some((node) => node.id === imageResultId && node.type === 'exportImageNode')) {
    throw new Error('图片输出任务引用没有对应到正式持久画布结果')
  }

  await beginCameraStageTaskEventCapture(page)
  try {
    const videoSubmitted = requireSubmittedTask(await executeCapability(client, {
      id: 'render_camera_stage_output',
      input: { canvasRef: projectRef, nodeRef, outputKind: 'video', resolutionPreset: '720p' },
    }), 'render_camera_stage_output')
    const active = await waitForTaskStatus(
      page, client, videoSubmitted.taskRef, ['queued', 'running'],
      ['completed', 'failed', 'cancelled', 'interrupted'], 8000,
    )
    if (active.resultRefs.length !== 0) throw new Error('活动视频任务不应提前返回结果节点')
    const videoRequestId = await readActiveVideoRequestId(page, canvasProjectId)
    const baseline = await readCapabilityBaseline(client, videoSubmitted.taskRef)
    requireCancellationRequested(await executeCapability(client, {
      id: 'cancel_camera_stage_render_task',
      input: { taskRef: videoSubmitted.taskRef },
    }, [baseline]))
    await waitForCancelledTaskEvent(page, videoRequestId, 15000)
    await page.waitForFunction(async ({ projectId, nodeId }) => {
      const stored = await window.henjiNative.testFixtures.readCanvas(projectId)
      const nodes = (stored?.nodes ?? [])
      const source = nodes.find((node) => node.id === nodeId)
      return source?.data?.renderTask == null && source?.data?.videoExporting === false
        && nodes.every((node) => node.type !== 'exportVideoNode')
    }, { projectId: canvasProjectId, nodeId: CAMERA_NODE_ID }, { timeout: 15000 })
  } finally {
    await endCameraStageTaskEventCapture(page)
  }
}

module.exports = {
  executeCapability,
  requireCancellationRequested,
  requireCompletedTask,
  requireObservedDefaultScene,
  requirePersistedCreatedDocument,
  requireSubmittedTask,
  requireVideoReadyCameraStageDocument,
  resolveCancelledTaskEvent,
  setupCameraStageAssistantCapability,
}
