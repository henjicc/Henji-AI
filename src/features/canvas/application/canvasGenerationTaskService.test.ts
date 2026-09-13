// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { registry } from '@/core/ModelRegistry'
import { GenerationService } from '@/core/services/GenerationService'
import { useSettingsStore } from '@/stores/settingsStore'
import { databaseService } from '@/services/database/DatabaseService'
import type { HistoryRecord } from '@/services/database'
import { pauseCanvasProjectPersistence, useProjectStore } from '@/stores/projectStore'
import * as projectStorage from '@/stores/projectStore'
import { useCanvasStore } from '@/stores/canvasStore'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { readGenerationTaskStatusSnapshot, replaceGenerationTaskStatusSnapshots } from '@/features/generation/application/generationTaskStatusRegistry'
import { CANVAS_NODE_TYPES } from '../domain/canvasNodes'
import { getCanvasGenerationTask, resolveCanvasGenerationOptions, submitCanvasGenerationTask, prepareCanvasNodeGeneration, submitCanvasNodeGeneration } from './canvasGenerationTaskService'
import { registerCanvasNodeExecutor, resetCanvasExecutionServiceForTests, isCanvasNodeRunActive, runCanvasNode } from './canvasExecutionService'
import { createGenerationNodeExecutor } from './generationNodeExecutor'
import { readCanvasGenerationNodeProfile } from './canvasGenerationNodeProfile'
import { readPersistedCanvasProjectSnapshot } from './canvasQueryService'
import { confirmCanvasPersistence } from './canvasPersistenceService'
import { commitCanvasGenerationOutputs } from './generationOutputApplicationService'
import { createDefaultGenerationOutputItems } from '../domain/generationOutputs'
import { acquireCanvasGenerationResumeLease, releaseCanvasGenerationResumeLease } from '../generation/activeGenerationTasks'
import { createApplicationCallerGrant } from '@/core/application-control/callerContext'
import { MCP_CAPABILITY_IDS, MCP_READ_PERMISSIONS, MCP_WRITE_PERMISSIONS } from '@/core/application-control/localHostContracts'
import { createApplicationCapabilitySession } from '@/features/application-control/applicationCapabilityService'
import { resumeCanvasProjectGeneration } from './canvasResumePollingService'
import { loadRealModelsIntoRegistry } from '@/tests/loadRealModels'
import * as imageCommands from '@/commands/image'
import { CANVAS_IMAGE_CAPABILITY_IDS } from '../capabilities'
import { prepareNodeImage } from './imageData'
import { openCanvasProject } from './canvasApplicationService'
vi.mock('./imageData', async (original) => ({
  ...await original<typeof import('./imageData')>(),
  persistImageLocally: vi.fn(async (url: string) => url),
  prepareNodeImage: vi.fn(async (url: string) => ({ imageUrl: url, previewImageUrl: url, aspectRatio: '1:1', createdFilePaths: [] })),
}))

let projectId: string
const records = new Map<string, HistoryRecord>()
beforeEach(async () => {
  replaceGenerationTaskStatusSnapshots([])
  installHarnessNativeStorage()
  await useProjectStore.getState().hydrate()
  resetCanvasExecutionServiceForTests()
  records.clear()
  useSettingsStore.setState({ providerKeyStatus: { ...useSettingsStore.getState().providerKeyStatus, fixture: true } })
  vi.spyOn(GenerationService.getInstance(), 'getProgressEstimate').mockResolvedValue(null)
  vi.spyOn(GenerationService.getInstance(), 'generate').mockResolvedValue({ status: 'completed', url: 'C:/result.png', filePath: 'C:/result.png' })
  vi.spyOn(databaseService, 'getHistoryById').mockImplementation(async id => records.get(id) ?? null)
  vi.spyOn(databaseService, 'init').mockResolvedValue()
  vi.spyOn(databaseService, 'insertHistory').mockImplementation(async row => { records.set(row.id, { ...row, createdAt: 'now', updatedAt: 'now' }) })
  vi.spyOn(databaseService, 'updateHistory').mockImplementation(async (id, patch) => { Object.assign(records.get(id)!, patch) })
  registry.register({ meta: { id: 'canvas-task-fixture', canonicalModelId: 'nano-banana', provider: 'fixture', type: 'image', name: { zh: '测试', en: 'Test' } }, params: [], endpoints: '/fixture',
    inputLimits: { images: { max: 1 }, videos: { max: 0 }, audios: { max: 0 } }, pricing: { currency: '$', fixed: 0.03 }, request: { builder: params => params } })
  projectId = await useProjectStore.getState().createProject('画布生成测试')
  useCanvasStore.getState().setCanvasData([{ id: 'reference', type: CANVAS_NODE_TYPES.upload, position: { x: 10, y: 10 }, data: { imageUrl: 'C:/reference.png' } }], [])
})
afterEach(() => { replaceGenerationTaskStatusSnapshots([]); resetCanvasExecutionServiceForTests(); registry.unregister('canvas-task-fixture'); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })

it('无需挂载节点即可生成，页面中途挂载不会替换任务执行器或重复提交', async () => {
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  const generate = vi.mocked(GenerationService.getInstance().generate).mockImplementation(async () => {
    await pending
    return { status: 'completed', url: 'C:/result.png', filePath: 'C:/result.png' }
  })
  const destination = { mode: 'canvas' as const, projectId, sourceNodeIds: ['reference'] }
  const input = { modelId: 'canvas-task-fixture', mediaType: 'image' as const, prompt: '生成三视图', options: {} }
  input.options = resolveCanvasGenerationOptions(input, destination)
  const taskId = crypto.randomUUID()
  const submitted = await submitCanvasGenerationTask(input, destination, taskId)
  const saved = await readPersistedCanvasProjectSnapshot(projectId)
  const node = saved.nodes.find(item => item.type === CANVAS_NODE_TYPES.imageEdit)!
  expect(node.data).toMatchObject({ modelId: input.modelId, prompt: input.prompt })
  expect(node.position.x).toBeGreaterThan(10)
  expect(saved.edges).toEqual(expect.arrayContaining([expect.objectContaining({ source: 'reference', target: node.id })]))
  expect(submitted.nodeRef.id).toBe(`${projectId}:${node.id}`)
  await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1))
  const run = vi.fn(async () => ({ status: 'completed' as const, resultNodeIds: [] }))
  const unmount = registerCanvasNodeExecutor(node.id, { kind: 'standard-generation', run })
  release()
  await vi.waitFor(() => expect(records.get(taskId)?.status).toBe('success'))
  expect(run).not.toHaveBeenCalled()
  expect(generate).toHaveBeenCalledTimes(1)
  expect(generate).toHaveBeenCalledWith('canvas-task-fixture', expect.objectContaining({ images: ['C:/reference.png'] }), expect.any(Function), expect.any(Object))
  unmount()
  expect(await getCanvasGenerationTask(taskId)).toMatchObject({ status: 'success', resultAvailable: true, progress: 100 })
  expect(readGenerationTaskStatusSnapshot(taskId)).toMatchObject({ status: 'success', resultAvailable: true })
  expect(records.get(taskId)?.filePath).toBe('C:/result.png')
  expect(useCanvasStore.getState().nodes.find(item => item.data.generationSourceNodeId === node.id)?.data.generationTaskId).toBe(taskId)
})

it('原视口位置固定后，移动画布仍将生成节点和持久结果放在原落点', async () => {
  const taskId = crypto.randomUUID()
  useCanvasStore.setState({ currentViewport: { x: 900, y: 600, zoom: 1 } })
  const result = await submitCanvasGenerationTask({ modelId: 'canvas-task-fixture', mediaType: 'image', prompt: '原视口生成' },
    { mode: 'canvas', projectId, sourceNodeIds: [], placement: { mode: 'absolute', x: 90, y: -20 } }, taskId)
  await vi.waitFor(() => expect(records.get(taskId)?.status).toBe('success'))
  const saved = await readPersistedCanvasProjectSnapshot(projectId)
  const source = saved.nodes.find(node => `${projectId}:${node.id}` === result.nodeRef.id)!
  expect(source.position).toEqual({ x: 90, y: -20 })
  const output = saved.nodes.find(node => node.data.generationTaskId === taskId)!
  expect(saved.edges).toEqual(expect.arrayContaining([expect.objectContaining({ source: source.id, target: output.id })]))
  expect(output.data.imageUrl).toBe('C:/result.png')
})

it('选中生成节点仅作为布局锚点时，新任务独立执行，不重新生成锚点或强加参考连线', async () => {
  const anchorId = useCanvasStore.getState().addNode(CANVAS_NODE_TYPES.imageEdit, { x: 100, y: 200 }, { prompt: '不可重放的旧请求' })
  const taskId = crypto.randomUUID()
  const result = await submitCanvasGenerationTask({ modelId: 'canvas-task-fixture', mediaType: 'image', prompt: '独立生成' },
    { mode: 'canvas', projectId, sourceNodeIds: [], placement: { mode: 'right_of_node', anchorNodeId: anchorId } }, taskId)
  await vi.waitFor(() => expect(records.get(taskId)?.status).toBe('success'))
  const saved = await readPersistedCanvasProjectSnapshot(projectId)
  const source = saved.nodes.find(node => `${projectId}:${node.id}` === result.nodeRef.id)!
  expect(source.position.x).toBeGreaterThan(100)
  expect(saved.edges.some(edge => edge.source === anchorId && edge.target === source.id)).toBe(false)
  expect(GenerationService.getInstance().generate).toHaveBeenCalledTimes(1)
  expect(GenerationService.getInstance().generate).toHaveBeenCalledWith('canvas-task-fixture',
    expect.objectContaining({ prompt: '独立生成' }), expect.any(Function), expect.any(Object))
})

async function restoredTask(extra: Record<string, unknown> = {}, version = 2) {
  const taskId = crypto.randomUUID()
  const nodeId = `source-${taskId}`
  const resultId = `result-${taskId}`
  await databaseService.insertHistory({ id: taskId, providerId: 'fixture', modelId: 'canvas-task-fixture', type: 'image',
    prompt: '恢复原图', params: { __canvasGeneration: { version, projectId, nodeId } },
    filePath: null, taskId: null, status: 'pending', errorMessage: null, cost: null, duration: null })
  useCanvasStore.getState().setCanvasData([
    { id: nodeId, type: CANVAS_NODE_TYPES.imageEdit, position: { x: 0, y: 0 }, data: { modelId: 'canvas-task-fixture', prompt: '恢复原图', params: {} } },
    { id: resultId, type: CANVAS_NODE_TYPES.exportImage, position: { x: 400, y: 0 },
      data: { generationSourceNodeId: nodeId, generationTaskId: taskId, isGenerating: true, ...extra } },
  ], [{ id: `edge-${taskId}`, source: nodeId, target: resultId }])
  await confirmCanvasPersistence(projectId)
  return { taskId, nodeId, resultId }
}

function taskControlSession() {
  const session = createApplicationCapabilitySession(createApplicationCallerGrant({ callerId: 'canvas-task-control',
    capabilityIds: [...MCP_CAPABILITY_IDS], permissions: [...MCP_READ_PERMISSIONS, ...MCP_WRITE_PERMISSIONS],
    allowWrites: true, allowDestructive: true }))
  return async (id: string, input: Record<string, unknown>) => {
    let expectedRevisions: Record<string, number> | undefined
    if (id === 'cancel_generation_task') {
      const read = await session.execute({ id: 'read_application_entity', version: 1, input: {
        ref: { kind: 'generation.task', id: input.taskId }, propertyIds: ['generation.task.status'],
      } }, { requestId: crypto.randomUUID(), signal: new AbortController().signal })
      if (!read.ok) throw new Error(JSON.stringify(read))
      expectedRevisions = (read.data as { revisions: Record<string, number> }).revisions
    }
    return session.execute({ id, version: 1, input, expectedRevisions },
      { requestId: crypto.randomUUID(), signal: new AbortController().signal })
  }
}

it.each([CANVAS_IMAGE_CAPABILITY_IDS.backgroundRemoval, CANVAS_IMAGE_CAPABILITY_IDS.photoRestoration,
  CANVAS_IMAGE_CAPABILITY_IDS.presetRelight, CANVAS_IMAGE_CAPABILITY_IDS.outpaint, CANVAS_IMAGE_CAPABILITY_IDS.upscale, CANVAS_IMAGE_CAPABILITY_IDS.panorama])(
  'MCP 图片工具 %s 从创建配置到原节点生成、持久结果查询闭环，无需 React 挂载', async capabilityId => {
  await loadRealModelsIntoRegistry()
  vi.spyOn(imageCommands, 'readImageInfo').mockResolvedValue({ source: 'C:/reference.png', fileName: 'reference.png', extension: 'png',
    width: 1024, height: 1024, orientation: null, hasAlpha: false, fileSizeBytes: 1024, createdAt: null, modifiedAt: null })
  if (capabilityId === CANVAS_IMAGE_CAPABILITY_IDS.panorama) vi.mocked(prepareNodeImage).mockImplementation(async url => ({
    imageUrl: url, previewImageUrl: url, aspectRatio: '2:1', createdFilePaths: [],
  }))
  useSettingsStore.setState({ providerKeyStatus: { ...useSettingsStore.getState().providerKeyStatus, fal: true } })
  const execute = taskControlSession()
  const created = await execute('apply_canvas_image_capability', { projectId, sourceNodeId: 'reference', capabilityId })
  expect(created, JSON.stringify(created)).toMatchObject({ ok: true })
  if (!created.ok) throw new Error('节点创建失败')
  const nodeId = String(created.data.nodeId)
  const selectedModel = registry.getModel(String(useCanvasStore.getState().nodes.find(node => node.id === nodeId)?.data.modelId))!
  expect(selectedModel).toBeDefined()
  useSettingsStore.setState({ providerKeyStatus: { ...useSettingsStore.getState().providerKeyStatus, [selectedModel.meta.provider]: true } })
  const ref = { kind: 'canvas.node', id: `${projectId}:${nodeId}` }
  const configuration = await execute('read_application_entity', { ref, propertyIds: ['canvas.node.generation_schema', 'canvas.node.generation_config'] })
  expect(configuration, JSON.stringify(configuration)).toMatchObject({ ok: true })
  const prepared = await execute('prepare_canvas_node_generation', { projectId, nodeId })
  expect(prepared, JSON.stringify(prepared)).toMatchObject({ ok: true })
  if (!prepared.ok) throw new Error('节点准备失败')
  const modelId = String((prepared.data.preparation as Record<string, unknown>).modelId)
  const generate = vi.mocked(GenerationService.getInstance().generate)
  expect(generate).not.toHaveBeenCalled()
  const result = await execute('submit_canvas_node_generation', prepared.data.submitInput as Record<string, unknown>)
  expect(result, JSON.stringify(result)).toMatchObject({ ok: true, data: { status: 'submitted' } })
  if (!result.ok) throw new Error('节点提交失败')
  const taskId = String(result.data.taskId)
  await vi.waitFor(() => expect(records.get(taskId)?.status).toBe('success'))
  expect(generate).toHaveBeenCalledTimes(1)
  expect(generate).toHaveBeenCalledWith(modelId, expect.objectContaining({ images: ['C:/reference.png'] }), expect.any(Function), expect.any(Object))
  const saved = await readPersistedCanvasProjectSnapshot(projectId)
  const sourceNode = saved.nodes.find(node => node.id === nodeId)!
  expect(saved.nodes.filter(node => node.type === sourceNode.type)).toHaveLength(1)
  const output = saved.nodes.find(node => node.data.generationTaskId === taskId)!
  expect(output.data).toMatchObject({ generationSourceNodeId: nodeId, imageUrl: 'C:/result.png', isGenerating: false })
  expect(saved.edges).toEqual(expect.arrayContaining([
    expect.objectContaining({ source: 'reference', target: nodeId }), expect.objectContaining({ source: nodeId, target: output.id }),
  ]))
  expect(await execute('get_generation_task', { taskId })).toMatchObject({ ok: true, data: { task: { status: 'success', resultAvailable: true } } })
})

it('原节点准备后改输入必须重新估价，同节点运行中不重复登记，其他节点不受影响', async () => {
  const canvas = useCanvasStore.getState()
  const nodeId = canvas.addNode(CANVAS_NODE_TYPES.imageEdit, { x: 400, y: 0 }, { modelId: 'canvas-task-fixture', prompt: '第一张', params: {} })
  const execute = taskControlSession()
  const prepared = await execute('prepare_canvas_node_generation', { projectId, nodeId })
  expect(prepared, JSON.stringify(prepared)).toMatchObject({ ok: true })
  if (!prepared.ok) throw new Error('准备失败')
  canvas.updateNodeData(nodeId, { prompt: '修改后的任务' })
  const stale = await execute('submit_canvas_node_generation', prepared.data.submitInput as Record<string, unknown>)
  expect(stale).toMatchObject({ ok: false, error: { details: { execution: { notExecuted: true } } } })
  expect(records.size).toBe(0)
  expect(GenerationService.getInstance().generate).not.toHaveBeenCalled()
  const updated = await execute('prepare_canvas_node_generation', { projectId, nodeId })
  if (!updated.ok) throw new Error(JSON.stringify(updated))
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  vi.mocked(GenerationService.getInstance().generate).mockImplementation(async () => {
    await pending
    return { status: 'completed', url: 'C:/current.png', filePath: 'C:/current.png' }
  })
  const accepted = await execute('submit_canvas_node_generation', updated.data.submitInput as Record<string, unknown>)
  expect(accepted).toMatchObject({ ok: true })
  await vi.waitFor(() => expect(GenerationService.getInstance().generate).toHaveBeenCalledTimes(1))
  expect(await execute('submit_canvas_node_generation', updated.data.submitInput as Record<string, unknown>)).toMatchObject({ ok: false })
  expect(records.size).toBe(1)
  const otherTask = crypto.randomUUID()
  await submitCanvasGenerationTask({ modelId: 'canvas-task-fixture', mediaType: 'image', prompt: '独立请求' }, { mode: 'canvas', projectId, sourceNodeIds: [] }, otherTask)
  await vi.waitFor(() => expect(GenerationService.getInstance().generate).toHaveBeenCalledTimes(2))
  release()
  await vi.waitFor(() => expect([...records.values()].map(record => record.status)).toEqual(['success', 'success']))
})

it('准备阶段取消不登记任务，新增未估价上游连线也不能触发额外生成', async () => {
  const canvas = useCanvasStore.getState()
  const nodeId = canvas.addNode(CANVAS_NODE_TYPES.imageEdit, { x: 400, y: 0 }, { modelId: 'canvas-task-fixture', prompt: '目标', params: {} })
  const { submitInput } = await prepareCanvasNodeGeneration({ projectId, nodeId })
  const controller = new AbortController()
  const pending = submitCanvasNodeGeneration(submitInput, crypto.randomUUID(), controller.signal)
  controller.abort()
  await expect(pending).rejects.toThrow()
  expect(records.size).toBe(0)
  const upstream = canvas.addNode(CANVAS_NODE_TYPES.imageEdit, { x: 0, y: 0 }, { modelId: 'canvas-task-fixture', prompt: '额外生成', params: {} })
  canvas.addEdge(upstream, nodeId)
  await expect(submitCanvasNodeGeneration(submitInput, crypto.randomUUID())).rejects.toThrow('节点输入已改变')
  await expect(prepareCanvasNodeGeneration({ projectId, nodeId })).rejects.toThrow('额外上游生成')
  expect(records.size).toBe(0)
  expect(GenerationService.getInstance().generate).not.toHaveBeenCalled()
})

it('新建节点后登记失败保留已创建节点事实，不冒充整次操作未执行', async () => {
  vi.mocked(databaseService.getHistoryById).mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('历史存储读取失败'))
  await expect(submitCanvasGenerationTask({ modelId: 'canvas-task-fixture', mediaType: 'image', prompt: '新建后登记' },
    { mode: 'canvas', projectId, sourceNodeIds: [] }, crypto.randomUUID()))
    .rejects.toMatchObject({ details: { nodeRef: { kind: 'canvas.node' } } })
  const saved = await readPersistedCanvasProjectSnapshot(projectId)
  expect(saved.nodes.filter(node => node.type === CANVAS_NODE_TYPES.imageEdit)).toHaveLength(1)
  expect(records.size).toBe(0)
  expect(GenerationService.getInstance().generate).not.toHaveBeenCalled()
})

it.each([false, true])('界面直接执行登记同一份任务，MCP 可查询和取消（取消 %s）', async cancel => {
  const nodeId = useCanvasStore.getState().addNode(CANVAS_NODE_TYPES.imageEdit, { x: 400, y: 0 },
    { modelId: 'canvas-task-fixture', prompt: '界面直接生成', params: {} })
  registerCanvasNodeExecutor(nodeId, createGenerationNodeExecutor(store => readCanvasGenerationNodeProfile(nodeId, store)))
  let release!: () => void
  const waiting = new Promise<void>(resolve => { release = resolve })
  const generate = vi.mocked(GenerationService.getInstance().generate).mockImplementation(async () => {
    await waiting
    return { status: 'completed', url: 'C:/ui-task.png', filePath: 'C:/ui-task.png' }
  })
  const running = runCanvasNode(nodeId)
  const outcome = running.then(() => 'success', () => 'cancelled')
  try {
  await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1))
  expect(records.size).toBe(1)
  const taskId = [...records.keys()][0]
  const execute = taskControlSession()
  expect(await execute('get_generation_task', { taskId })).toMatchObject({ ok: true, data: { task: { waitingExternal: true, cancellable: true } } })
  await expect(submitCanvasNodeGeneration({ projectId, nodeId, inputSignature: (await prepareCanvasNodeGeneration({ projectId, nodeId })).submitInput.inputSignature }, crypto.randomUUID())).rejects.toThrow('此节点已有')
  const otherProject = await useProjectStore.getState().createProject('界面生成后的其他项目')
  if (cancel) expect(await execute('cancel_generation_task', { taskId, reason: '停止界面任务' })).toMatchObject({ ok: true })
  release()
  expect(await outcome).toBe(cancel ? 'cancelled' : 'success')
  expect(await getCanvasGenerationTask(taskId)).toMatchObject({ status: cancel ? 'cancelled' : 'success', resultAvailable: !cancel, cancellable: false })
  const saved = await readPersistedCanvasProjectSnapshot(projectId)
  expect(saved.nodes.filter(node => node.data.generationTaskId === taskId)).toHaveLength(1)
  expect(records.size).toBe(1)
  expect(generate).toHaveBeenCalledTimes(1)
  expect(useProjectStore.getState().currentProjectId).toBe(otherProject)
  expect(useCanvasStore.getState().nodes).toHaveLength(0)
  } finally { release(); await outcome }
})

it.each([false, true])('界面五个请求入队即登记，卸载页面后继续执行或立即取消队尾（取消 %s）', async cancel => {
  const canvas = useCanvasStore.getState()
  const nodes = Array.from({ length: 5 }, (_, index) => canvas.addNode(CANVAS_NODE_TYPES.imageEdit, { x: 400, y: index * 250 },
    { modelId: 'canvas-task-fixture', prompt: `界面排队-${index}`, params: {} }))
  const unregister = nodes.map(nodeId => registerCanvasNodeExecutor(nodeId,
    createGenerationNodeExecutor(store => readCanvasGenerationNodeProfile(nodeId, store))))
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const generate = vi.mocked(GenerationService.getInstance().generate).mockImplementation(async () => {
    await gate
    return { status: 'completed', url: 'C:/ui-queued.png', filePath: 'C:/ui-queued.png' }
  })
  const outcomes = nodes.map(nodeId => runCanvasNode(nodeId).then(() => 'success', () => 'cancelled'))
  try {
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(records.size).toBe(5))
    const tail = [...records.values()].find(row => row.prompt === '界面排队-4')!
    expect(tail.status).toBe('queued')
    const execute = taskControlSession()
    expect(await execute('get_generation_task', { taskId: tail.id })).toMatchObject({ ok: true,
      data: { task: { status: 'queued', waitingExternal: true, cancellable: true } } })
    unregister.forEach(dispose => dispose())
    const otherProject = await useProjectStore.getState().createProject('排队时切到其他项目')
    if (cancel) {
      expect(await execute('cancel_generation_task', { taskId: tail.id, reason: '停止排队任务' })).toMatchObject({ ok: true })
      await vi.waitFor(() => expect(records.get(tail.id)?.status).toBe('cancelled'))
      expect(generate).toHaveBeenCalledTimes(2)
    }
    release()
    expect(await Promise.all(outcomes)).toEqual(['success', 'success', 'success', 'success', cancel ? 'cancelled' : 'success'])
    expect(generate).toHaveBeenCalledTimes(cancel ? 4 : 5)
    expect(records.size).toBe(5)
    const saved = await readPersistedCanvasProjectSnapshot(projectId)
    expect(saved.nodes.filter(node => node.data.generationTaskId)).toHaveLength(cancel ? 4 : 5)
    expect(useProjectStore.getState().currentProjectId).toBe(otherProject)
    expect(useCanvasStore.getState().nodes).toHaveLength(0)
  } finally { release(); await Promise.all(outcomes); unregister.forEach(dispose => dispose()) }
})

it('MCP 取消一个原任务不影响并行请求，迟到输出不冒充成功', async () => {
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  const signals = new Map<string, AbortSignal>()
  vi.mocked(GenerationService.getInstance().generate).mockImplementation(async (_model, _params, _progress, options) => {
    signals.set(options!.requestId!, options!.signal!)
    await pending
    return { status: 'completed', url: 'C:/late-output.png', filePath: 'C:/late-output.png' }
  })
  const ids = [crypto.randomUUID(), crypto.randomUUID()]
  for (const id of ids) await submitCanvasGenerationTask({ modelId: 'canvas-task-fixture', mediaType: 'image', prompt: `图-${id}`, options: {} },
    { mode: 'canvas', projectId, sourceNodeIds: [] }, id)
  await vi.waitFor(() => expect(signals.size).toBe(2))
  const execute = taskControlSession()
  expect(await getCanvasGenerationTask(ids[0])).toMatchObject({ cancellable: true })
  const cancelled = await execute('cancel_generation_task', { taskId: ids[0], reason: '只停止第一张' })
  expect(cancelled, JSON.stringify(cancelled)).toMatchObject({ ok: true, data: { status: 'cancelling' } })
  expect(signals.get(ids[0])!.aborted).toBe(true)
  expect(signals.get(ids[1])!.aborted).toBe(false)
  release()
  await vi.waitFor(() => {
    expect(records.get(ids[0])?.status).toBe('cancelled')
    expect(records.get(ids[1])?.status).toBe('success')
  })
  expect(await getCanvasGenerationTask(ids[0])).toMatchObject({ status: 'cancelled', resultAvailable: false, cancellable: false })
  expect(await execute('read_application_entity', { ref: { kind: 'generation.task', id: ids[0] }, propertyIds: ['generation.task.status'] }))
    .toMatchObject({ ok: true, data: { properties: { 'generation.task.status': 'cancelled' } } })
  const saved = await readPersistedCanvasProjectSnapshot(projectId)
  expect(saved.nodes.find(node => node.data.generationTaskId === ids[0])?.data).toMatchObject({ generationCancelled: true, isGenerating: false })
  expect(saved.nodes.find(node => node.data.generationTaskId === ids[0])?.data.imageUrl).toBeFalsy()
})

it('取消续查后保存停止状态，不自动恢复；明确恢复仍获取同一供应商任务', async () => {
  const { taskId, resultId } = await restoredTask({ serverTaskId: 'original-provider-task', serverTaskModelId: 'canvas-task-fixture' })
  const polling = vi.spyOn(GenerationService.getInstance(), 'continuePolling').mockImplementationOnce(async (_model, _task, _params, _progress, options) => {
    await new Promise<void>((_resolve, reject) => options!.signal!.addEventListener('abort', () => reject(new Error('本地停止')), { once: true }))
    throw new Error('unreachable')
  }).mockResolvedValue({ status: 'completed', url: 'C:/resumed-after-stop.png', filePath: 'C:/resumed-after-stop.png' })
  const execute = taskControlSession()
  const input = (await getCanvasGenerationTask(taskId))!.resumeInput as Record<string, unknown>
  expect(await execute('resume_canvas_generation_task', input)).toMatchObject({ ok: true })
  expect(await getCanvasGenerationTask(taskId)).toMatchObject({ cancellable: true })
  const cancelled = await execute('cancel_generation_task', { taskId, reason: '停止续查' })
  expect(cancelled, JSON.stringify(cancelled)).toMatchObject({ ok: true })
  await vi.waitFor(() => expect(useCanvasStore.getState().nodes.find(node => node.id === resultId)?.data.generationCancelled).toBe(true))
  await confirmCanvasPersistence(projectId)
  expect(await getCanvasGenerationTask(taskId)).toMatchObject({ status: 'cancelled', resultAvailable: false })
  expect(resumeCanvasProjectGeneration(projectId)).toBe(0)
  expect(polling).toHaveBeenCalledTimes(1)
  expect(await execute('resume_canvas_generation_task', input)).toMatchObject({ ok: true })
  await vi.waitFor(async () => expect(await getCanvasGenerationTask(taskId), JSON.stringify({ record: records.get(taskId), nodes: useCanvasStore.getState().nodes })).toMatchObject({ status: 'success', resultAvailable: true }))
  expect(polling).toHaveBeenCalledTimes(2)
  expect(polling.mock.calls.every(call => call[1] === 'original-provider-task')).toBe(true)
  expect(GenerationService.getInstance().generate).not.toHaveBeenCalled()
})

it.each([false, true])('离开原项目后 MCP 仍可取消续查（后台启动 %s）', async startInBackground => {
  const { taskId, resultId } = await restoredTask({ serverTaskId: 'background-original-task', serverTaskModelId: 'canvas-task-fixture' })
  const polling = vi.spyOn(GenerationService.getInstance(), 'continuePolling').mockImplementation(async (_model, _task, _params, _progress, options) => {
    await new Promise<void>((_resolve, reject) => options!.signal!.addEventListener('abort', () => reject(new Error('停止后台续查')), { once: true }))
    throw new Error('unreachable')
  })
  const execute = taskControlSession()
  const input = (await getCanvasGenerationTask(taskId))!.resumeInput as Record<string, unknown>
  let otherProject = startInBackground ? await useProjectStore.getState().createProject('后台启动续查') : null
  expect(await execute('resume_canvas_generation_task', input)).toMatchObject({ ok: true })
  await vi.waitFor(() => expect(polling).toHaveBeenCalledTimes(1))
  otherProject ??= await useProjectStore.getState().createProject('后台续查时的当前项目')
  expect(await getCanvasGenerationTask(taskId)).toMatchObject({ cancellable: true })
  expect(await execute('cancel_generation_task', { taskId, reason: '停止后台任务' })).toMatchObject({ ok: true })
  await vi.waitFor(async () => {
    const saved = await readPersistedCanvasProjectSnapshot(projectId)
    expect(saved.nodes.find(node => node.id === resultId)?.data).toMatchObject({ generationCancelled: true, isGenerating: false, serverTaskId: 'background-original-task' })
  })
  expect(await getCanvasGenerationTask(taskId)).toMatchObject({ status: 'cancelled', resultAvailable: false, cancellable: false })
  expect(useProjectStore.getState().currentProjectId).toBe(otherProject)
  expect(useCanvasStore.getState().nodes).toHaveLength(0)
  await openCanvasProject(projectId, new AbortController().signal)
  expect(resumeCanvasProjectGeneration(projectId)).toBe(0)
  expect(polling).toHaveBeenCalledTimes(1)
  expect(GenerationService.getInstance().generate).not.toHaveBeenCalled()
})

it('在其他项目中恢复标准任务，只续查原任务并保存原项目结果', async () => {
  const { taskId, resultId } = await restoredTask({ serverTaskId: 'offscreen-original', serverTaskModelId: 'canvas-task-fixture' })
  const input = (await getCanvasGenerationTask(taskId))!.resumeInput as Record<string, unknown>
  const otherProject = await useProjectStore.getState().createProject('恢复时保留的页面')
  const polling = vi.spyOn(GenerationService.getInstance(), 'continuePolling').mockResolvedValue({
    status: 'completed', url: 'C:/offscreen-resumed.png', filePath: 'C:/offscreen-resumed.png',
  })
  const execute = taskControlSession()
  expect(await execute('resume_canvas_generation_task', input)).toMatchObject({ ok: true })
  await vi.waitFor(async () => expect(await getCanvasGenerationTask(taskId)).toMatchObject({ status: 'success', resultAvailable: true }))
  const saved = await readPersistedCanvasProjectSnapshot(projectId)
  expect(saved.nodes.find(node => node.id === resultId)?.data).toMatchObject({ isGenerating: false, imageUrl: 'C:/offscreen-resumed.png' })
  expect(polling).toHaveBeenCalledTimes(1)
  expect(polling.mock.calls[0]?.[1]).toBe('offscreen-original')
  expect(GenerationService.getInstance().generate).not.toHaveBeenCalled()
  expect(useProjectStore.getState().currentProjectId).toBe(otherProject)
  expect(useCanvasStore.getState().nodes).toHaveLength(0)
})

it.each([false, true])('续查失败对账并保留原任务，明确恢复后完成且不重复付费（后台 %s）', async background => {
  const { taskId, resultId } = await restoredTask({ serverTaskId: 'retry-original-task', serverTaskModelId: 'canvas-task-fixture' })
  let fail!: () => void
  const pending = new Promise<void>(resolve => { fail = resolve })
  const polling = vi.spyOn(GenerationService.getInstance(), 'continuePolling').mockImplementationOnce(async () => {
    await pending
    throw new Error('原任务结果下载暂时中断')
  }).mockResolvedValue({ status: 'completed', url: 'C:/retry-original.png', filePath: 'C:/retry-original.png' })
  const execute = taskControlSession()
  const input = (await getCanvasGenerationTask(taskId))!.resumeInput as Record<string, unknown>
  expect(await execute('resume_canvas_generation_task', input)).toMatchObject({ ok: true })
  await vi.waitFor(() => expect(polling).toHaveBeenCalledTimes(1))
  if (background) await useProjectStore.getState().createProject('续查失败时的其他项目')
  fail()
  await vi.waitFor(async () => expect(await getCanvasGenerationTask(taskId)).toMatchObject({ status: 'error',
    errorMessage: expect.stringContaining('原任务结果下载暂时中断'), resumeInput: input, waitingExternal: false, resultAvailable: false }))
  expect(records.get(taskId)?.status).toBe('error')
  const saved = await readPersistedCanvasProjectSnapshot(projectId)
  expect(saved.nodes.find(node => node.id === resultId)?.data).toMatchObject({ serverTaskId: 'retry-original-task', isGenerating: false })
  await openCanvasProject(projectId, new AbortController().signal)
  expect(resumeCanvasProjectGeneration(projectId)).toBe(0)
  expect(polling).toHaveBeenCalledTimes(1)
  expect(await execute('resume_canvas_generation_task', input)).toMatchObject({ ok: true })
  await vi.waitFor(async () => expect(await getCanvasGenerationTask(taskId)).toMatchObject({ status: 'success', resultAvailable: true, errorMessage: null }))
  expect(records.get(taskId)?.filePath).toBe('C:/retry-original.png')
  expect(polling.mock.calls.map(call => call[1])).toEqual(['retry-original-task', 'retry-original-task'])
  expect(GenerationService.getInstance().generate).not.toHaveBeenCalled()
})

it('界面正式恢复入口完成后也清除已对账的旧错误，历史保存失败不会冒充已同步', async () => {
  const { taskId } = await restoredTask({ isGenerating: false, generationError: '下载中断',
    serverTaskId: 'ui-original-task', serverTaskModelId: 'canvas-task-fixture' })
  vi.mocked(databaseService.updateHistory).mockRejectedValueOnce(new Error('历史暂不可写'))
  await expect(getCanvasGenerationTask(taskId)).rejects.toThrow('历史暂不可写')
  expect(records.get(taskId)?.status).toBe('pending')
  expect(await getCanvasGenerationTask(taskId)).toMatchObject({ status: 'error', errorMessage: '下载中断' })
  const polling = vi.spyOn(GenerationService.getInstance(), 'continuePolling').mockResolvedValue({
    status: 'completed', url: 'C:/ui-recovered.png', filePath: 'C:/ui-recovered.png',
  })
  expect(resumeCanvasProjectGeneration(projectId, undefined, { retryFailed: true })).toBe(1)
  await vi.waitFor(async () => expect(await getCanvasGenerationTask(taskId)).toMatchObject({ status: 'success', errorMessage: null, resultAvailable: true }))
  expect(records.get(taskId)).toMatchObject({ status: 'success', errorMessage: null, filePath: 'C:/ui-recovered.png' })
  expect(polling).toHaveBeenCalledTimes(1)
  expect(GenerationService.getInstance().generate).not.toHaveBeenCalled()
})

it('MCP 使用原任务返回的恢复参数续查，错误目标不执行，重复请求不重复轮询', async () => {
  const { taskId } = await restoredTask({ serverTaskId: 'original-provider-task', serverTaskModelId: 'canvas-task-fixture' })
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  const polling = vi.spyOn(GenerationService.getInstance(), 'continuePolling').mockImplementation(async () => {
    await pending
    return { status: 'completed', url: 'C:/mcp-resumed.png', filePath: 'C:/mcp-resumed.png' }
  })
  const session = createApplicationCapabilitySession(createApplicationCallerGrant({ callerId: 'resume-original-task',
    capabilityIds: [...MCP_CAPABILITY_IDS], permissions: [...MCP_READ_PERMISSIONS, ...MCP_WRITE_PERMISSIONS],
    allowWrites: true, allowDestructive: false }))
  const execute = (id: string, input: Record<string, unknown>) => session.execute({ id, version: 1, input },
    { requestId: crypto.randomUUID(), signal: new AbortController().signal })
  const read = await execute('get_generation_task', { taskId })
  expect(read.ok).toBe(true)
  if (!read.ok) throw new Error('原任务读取失败')
  const task = (read.data as { task: { resumeInput: Record<string, unknown> } }).task
  const invalid = await execute('resume_canvas_generation_task', { ...task.resumeInput, resultNodeIds: ['wrong-result'] })
  expect(invalid).toMatchObject({ ok: false, error: { details: { execution: { notExecuted: true } } } })
  expect(polling).not.toHaveBeenCalled()
  expect(useProjectStore.getState().currentProjectId).toBe(projectId)
  expect(useProjectStore.getState().currentProject?.id).toBe(projectId)
  const resumed = await execute('resume_canvas_generation_task', task.resumeInput)
  expect(resumed, JSON.stringify(resumed)).toMatchObject({ ok: true })
  expect(await execute('resume_canvas_generation_task', task.resumeInput)).toMatchObject({ ok: true })
  expect(polling).toHaveBeenCalledTimes(1)
  release()
  await vi.waitFor(async () => expect(await getCanvasGenerationTask(taskId)).toMatchObject({ status: 'success', resultAvailable: true }))
  expect(records.get(taskId)?.filePath).toBe('C:/mcp-resumed.png')
  expect(GenerationService.getInstance().generate).not.toHaveBeenCalled()
})

it('冷启动后通用实体读取按原任务已保存结果恢复历史，后续画布变化不篡改原完成事实', async () => {
  const { taskId, nodeId, resultId } = await restoredTask()
  await commitCanvasGenerationOutputs({ sourceNodeId: nodeId, placeholderNodeId: resultId,
    resultNodeType: CANVAS_NODE_TYPES.exportImage, completionId: `recovered-${taskId}`,
    contract: { version: 1, strategy: 'single', resultKind: 'image', outputs: createDefaultGenerationOutputItems({
      sources: ['C:/recovered-original.png'], mediaType: 'image', resultKind: 'image', semanticKind: 'generated-media',
    }) } })
  expect(records.get(taskId)?.status).toBe('pending')
  vi.mocked(databaseService.updateHistory).mockRejectedValueOnce(new Error('历史保存失败'))
  await expect(getCanvasGenerationTask(taskId)).rejects.toThrow('历史保存失败')
  expect(records.get(taskId)?.status).toBe('pending')
  const session = createApplicationCapabilitySession(createApplicationCallerGrant({ callerId: 'read-restored-task',
    capabilityIds: [...MCP_CAPABILITY_IDS], permissions: [...MCP_READ_PERMISSIONS], allowWrites: false, allowDestructive: false }))
  const read = await session.execute({ id: 'read_application_entity', version: 1, input: {
    ref: { kind: 'generation.task', id: taskId }, propertyIds: ['generation.task.status', 'generation.task.waiting_external'],
  } }, { requestId: crypto.randomUUID(), signal: new AbortController().signal })
  expect(read).toMatchObject({ ok: true, data: { properties: { 'generation.task.status': 'success', 'generation.task.waiting_external': false } } })
  expect(records.get(taskId)).toMatchObject({ status: 'success', filePath: 'C:/recovered-original.png' })
  replaceGenerationTaskStatusSnapshots([{ taskId, modelId: 'canvas-task-fixture', mediaType: 'image',
    status: 'generating', progress: 0, resultAvailable: false, errorCode: null, errorMessage: null }])
  const refreshed = await session.execute({ id: 'read_application_entity', version: 1, input: {
    ref: { kind: 'generation.task', id: taskId }, propertyIds: ['generation.task.status'],
  } }, { requestId: crypto.randomUUID(), signal: new AbortController().signal })
  expect(refreshed).toMatchObject({ ok: true, data: { properties: { 'generation.task.status': 'success' } } })
  useCanvasStore.getState().setCanvasData([], [])
  await confirmCanvasPersistence(projectId)
  expect(await getCanvasGenerationTask(taskId)).toMatchObject({ status: 'success', resultAvailable: true, waitingExternal: false })
  expect(records.get(taskId)?.filePath).toBe('C:/recovered-original.png')
  expect(GenerationService.getInstance().generate).not.toHaveBeenCalled()
})

it('残留生成标记不是活动任务；没有供应商标识时报告结果未知，不自动重试', async () => {
  const { taskId } = await restoredTask()
  expect(await getCanvasGenerationTask(taskId)).toMatchObject({ status: 'error', waitingExternal: false,
    resultAvailable: false, errorCode: 'GENERATION_OUTCOME_UNKNOWN' })
  expect(records.get(taskId)?.status).toBe('pending')
  expect(GenerationService.getInstance().generate).not.toHaveBeenCalled()
})

it('有原供应商标识的下载失败仍可续查', async () => {
  const retryable = await restoredTask({ isGenerating: false, generationError: '下载失败', resultKind: 'layer-stack',
    serverTaskId: 'download-task', serverTaskModelId: 'canvas-task-fixture' })
  expect(await getCanvasGenerationTask(retryable.taskId)).toMatchObject({ status: 'error', errorMessage: '下载失败', resumeInput: { taskId: retryable.taskId } })
  expect(records.get(retryable.taskId)?.status).toBe('error')
  expect(GenerationService.getInstance().generate).not.toHaveBeenCalled()
})

it('尚未保存的画布输出不能提前把原任务记为成功', async () => {
  const { taskId, resultId } = await restoredTask()
  const before = useCanvasStore.getState()
  const release = pauseCanvasProjectPersistence(projectId)
  try {
    useCanvasStore.getState().updateNodeData(resultId, {
      imageUrl: 'C:/not-saved.png', isGenerating: false, generationOutputCommitId: 'not-saved',
    })
    expect(await getCanvasGenerationTask(taskId)).toMatchObject({ resultAvailable: false })
    expect(records.get(taskId)?.status).toBe('pending')
    expect(databaseService.updateHistory).not.toHaveBeenCalled()
  } finally {
    useCanvasStore.getState().setCanvasData(before.nodes, before.edges, before.history)
    release()
    await confirmCanvasPersistence(projectId)
  }
})

it('原供应商任务区分等待续查与正在续查，读取不会发起生成', async () => {
  const { taskId } = await restoredTask({ serverTaskId: 'original-provider-task', serverTaskModelId: 'canvas-task-fixture' })
  expect(await getCanvasGenerationTask(taskId)).toMatchObject({ status: 'pending', waitingExternal: false })
  const lease = acquireCanvasGenerationResumeLease(projectId, 'original-provider-task')!
  try {
    expect(await getCanvasGenerationTask(taskId)).toMatchObject({ status: 'generating', waitingExternal: true })
  } finally { releaseCanvasGenerationResumeLease(projectId, 'original-provider-task', lease) }
  expect(GenerationService.getInstance().generate).not.toHaveBeenCalled()
})

it('旧任务不能把同来源节点上另一次生成的结果认成自己的结果', async () => {
  const { taskId } = await restoredTask({ generationTaskId: 'another-task', imageUrl: 'C:/another.png',
    isGenerating: false, generationOutputCommitId: 'another-output' }, 1)
  expect(await getCanvasGenerationTask(taskId)).toMatchObject({ resultAvailable: false, waitingExternal: false })
  expect(records.get(taskId)?.status).toBe('pending')
})

it.each(['foreground', 'background', 'cancel-queued'] as const)('五个请求保持独立执行、排队和原项目归属（%s）', async mode => {
  const background = mode !== 'foreground'
  let release!: () => void
  const waiting = new Promise<void>(resolve => { release = resolve })
  const taskIds: string[] = []
  const nodeIds: string[] = []
  const generate = vi.mocked(GenerationService.getInstance().generate).mockImplementation(async (_model, params) => {
    await waiting
    const path = `C:/result-${String(params.prompt)}.png`
    return { status: 'completed', url: path, filePath: path }
  })
  try {
    for (let index = 0; index < 5; index++) {
      const taskId = crypto.randomUUID()
      const destination = { mode: 'canvas' as const, projectId, sourceNodeIds: ['reference'] }
      const input = { modelId: 'canvas-task-fixture', mediaType: 'image' as const, prompt: `第 ${index} 张`, options: {} }
      input.options = resolveCanvasGenerationOptions(input, destination)
      const submitted = await submitCanvasGenerationTask(input, destination, taskId)
      const nodeId = submitted.nodeRef.id.slice(projectId.length + 1)
      taskIds.push(taskId); nodeIds.push(nodeId)
      if (index === 0) await vi.waitFor(() => expect(records.get(taskId)?.status).toBe('generating'))
    }
    const saved = await readPersistedCanvasProjectSnapshot(projectId)
    expect(saved.nodes.filter(node => nodeIds.includes(node.id))).toHaveLength(5)
    expect(saved.edges.filter(edge => edge.source === 'reference' && nodeIds.includes(edge.target))).toHaveLength(5)
    expect(taskIds.every(id => records.get(id)?.status !== 'success')).toBe(true)
    expect(generate.mock.calls.length).toBeLessThanOrEqual(2)
    await vi.waitFor(() => expect(nodeIds.every(id => isCanvasNodeRunActive(projectId, id))).toBe(true))
    expect(await getCanvasGenerationTask(taskIds[4])).toMatchObject({ status: 'queued', waitingExternal: true, cancellable: true })
    const otherProject = background ? await useProjectStore.getState().createProject('队列期间的另一个项目') : null
    if (mode === 'cancel-queued') {
      expect(await taskControlSession()('cancel_generation_task', { taskId: taskIds[4], reason: '取消队尾任务' })).toMatchObject({ ok: true })
      await vi.waitFor(() => expect(records.get(taskIds[4])?.status).toBe('cancelled'))
      expect(generate).toHaveBeenCalledTimes(2)
    }
    release()
    await vi.waitFor(() => expect(taskIds.map(id => records.get(id)?.status), JSON.stringify([...records.values()].map(record => ({ status: record.status, error: record.errorMessage })))).toEqual(taskIds.map((_id, index) => mode === 'cancel-queued' && index === 4 ? 'cancelled' : 'success')))
    const completed = await readPersistedCanvasProjectSnapshot(projectId)
    expect(completed.nodes.filter(node => node.data.generationSourceNodeId && nodeIds.includes(String(node.data.generationSourceNodeId)))).toHaveLength(mode === 'cancel-queued' ? 4 : 5)
    expect(generate).toHaveBeenCalledTimes(mode === 'cancel-queued' ? 4 : 5)
    if (background) {
      expect(useProjectStore.getState().currentProjectId).toBe(otherProject)
      expect(useCanvasStore.getState().nodes).toHaveLength(0)
    }
  } finally { release() }
})

it.each([false, true])('任务刚登记就切换项目，执行与取消保持原归属（取消 %s）', async cancel => {
  const taskId = crypto.randomUUID()
  let release!: () => void
  const waiting = new Promise<void>(resolve => { release = resolve })
  const update = databaseService.updateHistory
  vi.mocked(databaseService.updateHistory).mockImplementationOnce(async (...args) => { await waiting; return update(...args) })
  await submitCanvasGenerationTask({ modelId: 'canvas-task-fixture', mediaType: 'image', prompt: '图', options: {} }, { mode: 'canvas', projectId, sourceNodeIds: [] }, taskId)
  const otherProject = await useProjectStore.getState().createProject('登记后立即切换')
  if (cancel) expect(await taskControlSession()('cancel_generation_task', { taskId, reason: '取消刚登记的任务' })).toMatchObject({ ok: true })
  release()
  await vi.waitFor(() => expect(records.get(taskId)?.status).toBe(cancel ? 'cancelled' : 'success'))
  expect(GenerationService.getInstance().generate).toHaveBeenCalledTimes(cancel ? 0 : 1)
  const saved = await readPersistedCanvasProjectSnapshot(projectId)
  expect(saved.nodes.filter(node => node.data.generationTaskId === taskId)).toHaveLength(cancel ? 0 : 1)
  expect(useProjectStore.getState().currentProjectId).toBe(otherProject)
  expect(useCanvasStore.getState().nodes).toHaveLength(0)
})

it.each([false, true])('生成前等待估算时切换项目，执行与取消均保持原归属（取消 %s）', async cancel => {
  let release!: () => void
  const gate = new Promise<null>(resolve => { release = () => resolve(null) })
  vi.mocked(GenerationService.getInstance().getProgressEstimate).mockReturnValue(gate)
  const taskId = crypto.randomUUID()
  await submitCanvasGenerationTask({ modelId: 'canvas-task-fixture', mediaType: 'image', prompt: '原项目准备中', options: {} },
    { mode: 'canvas', projectId, sourceNodeIds: [] }, taskId)
  await vi.waitFor(() => expect(GenerationService.getInstance().getProgressEstimate).toHaveBeenCalledTimes(1))
  const otherProject = await useProjectStore.getState().createProject('准备期间切换')
  if (cancel) expect(await taskControlSession()('cancel_generation_task', { taskId, reason: '取消准备中的任务' })).toMatchObject({ ok: true })
  release()
  await vi.waitFor(() => expect(records.get(taskId)?.status).toBe(cancel ? 'cancelled' : 'success'))
  const saved = await readPersistedCanvasProjectSnapshot(projectId)
  expect(saved.nodes.filter(node => node.data.generationTaskId === taskId)).toHaveLength(cancel ? 0 : 1)
  expect(GenerationService.getInstance().generate).toHaveBeenCalledTimes(cancel ? 0 : 1)
  expect(useProjectStore.getState().currentProjectId).toBe(otherProject)
  expect(useCanvasStore.getState().nodes).toHaveLength(0)
})

it('后台占位保存失败时不提交供应商，并保存原节点失败状态', async () => {
  let release!: () => void
  vi.mocked(GenerationService.getInstance().getProgressEstimate).mockReturnValue(new Promise(resolve => { release = () => resolve(null) }))
  const taskId = crypto.randomUUID()
  await submitCanvasGenerationTask({ modelId: 'canvas-task-fixture', mediaType: 'image', prompt: '保存失败', options: {} },
    { mode: 'canvas', projectId, sourceNodeIds: [] }, taskId)
  await vi.waitFor(() => expect(GenerationService.getInstance().getProgressEstimate).toHaveBeenCalledTimes(1))
  await useProjectStore.getState().createProject('保存失败时的当前项目')
  vi.spyOn(projectStorage, 'persistBackgroundCanvasProject').mockRejectedValueOnce(new Error('后台占位写入失败'))
  release()
  await vi.waitFor(() => expect(records.get(taskId)?.status).toBe('error'))
  expect(GenerationService.getInstance().generate).not.toHaveBeenCalled()
  const saved = await readPersistedCanvasProjectSnapshot(projectId)
  expect(saved.nodes.filter(node => node.data.generationTaskId === taskId).every(node => node.data.isGenerating !== true)).toBe(true)
  expect(useCanvasStore.getState().nodes).toHaveLength(0)
})

it('供应商任务已保存后切换项目，持续轮询并保存原项目，不影响当前项目', async () => {
  vi.mocked(GenerationService.getInstance().generate).mockResolvedValue({ status: 'pending', taskId: 'persisted-provider-task', url: '' })
  let finishOriginal!: (value: { status: 'completed'; url: string; filePath: string }) => void
  const polling = vi.spyOn(GenerationService.getInstance(), 'continuePolling').mockImplementation(() => new Promise(resolve => { finishOriginal = resolve }))
  const taskId = crypto.randomUUID()
  await submitCanvasGenerationTask({ modelId: 'canvas-task-fixture', mediaType: 'image', prompt: '保留任务', options: {} },
    { mode: 'canvas', projectId, sourceNodeIds: [] }, taskId)
  await vi.waitFor(() => expect(polling).toHaveBeenCalledTimes(1))
  await confirmCanvasPersistence(projectId)
  const otherProject = await useProjectStore.getState().createProject('另一个工作区')
  await openCanvasProject(otherProject, new AbortController().signal)
  const currentCanvas = useCanvasStore.getState()
  finishOriginal({ status: 'completed', url: 'C:/original.png', filePath: 'C:/original.png' })
  await vi.waitFor(() => expect(records.get(taskId)?.status, records.get(taskId)?.errorMessage ?? '').toBe('success'))
  expect(useProjectStore.getState().currentProjectId).toBe(otherProject)
  expect(useCanvasStore.getState()).toBe(currentCanvas)
  await openCanvasProject(projectId, new AbortController().signal)
  expect(useCanvasStore.getState().nodes.find(node => node.data.generationTaskId === taskId)?.data.imageUrl).toBe('C:/original.png')
  await vi.waitFor(async () => expect(await getCanvasGenerationTask(taskId)).toMatchObject({ status: 'success', waitingExternal: false }))
  expect(records.get(taskId)).toMatchObject({ status: 'success', filePath: 'C:/original.png' })
  expect(GenerationService.getInstance().generate).toHaveBeenCalledTimes(1)
  expect(polling).toHaveBeenCalledTimes(1)
  expect(polling.mock.calls.every(call => call[1] === 'persisted-provider-task')).toBe(true)
})

it('切走后才收到供应商任务号，仍保存原任务并继续获取结果', async () => {
  let submitted!: () => void
  vi.mocked(GenerationService.getInstance().generate).mockImplementation(async () => {
    await new Promise<void>(resolve => { submitted = resolve })
    return { status: 'pending', taskId: 'late-provider-id', url: '' }
  })
  const polling = vi.spyOn(GenerationService.getInstance(), 'continuePolling').mockResolvedValue({ status: 'completed', url: 'C:/late-id.png', filePath: 'C:/late-id.png' })
  const taskId = crypto.randomUUID()
  await submitCanvasGenerationTask({ modelId: 'canvas-task-fixture', mediaType: 'image', prompt: '迟到任务号', options: {} },
    { mode: 'canvas', projectId, sourceNodeIds: [] }, taskId)
  await vi.waitFor(() => expect(submitted).toBeTypeOf('function'))
  const otherProject = await useProjectStore.getState().createProject('切走等待')
  await openCanvasProject(otherProject, new AbortController().signal)
  submitted()
  await vi.waitFor(() => expect(records.get(taskId)?.status, records.get(taskId)?.errorMessage ?? '').toBe('success'))
  expect(polling).toHaveBeenCalledTimes(1)
  expect(polling.mock.calls[0][1]).toBe('late-provider-id')
  expect(useProjectStore.getState().currentProjectId).toBe(otherProject)
  expect(useCanvasStore.getState().nodes).toHaveLength(0)
  expect((await readPersistedCanvasProjectSnapshot(projectId)).nodes.find(node => node.data.generationTaskId === taskId)?.data.imageUrl).toBe('C:/late-id.png')
})

it('在其他项目中取消原画布任务，停止状态仍保存到原节点', async () => {
  vi.mocked(GenerationService.getInstance().generate).mockResolvedValue({ status: 'pending', taskId: 'background-cancel', url: '' })
  const polling = vi.spyOn(GenerationService.getInstance(), 'continuePolling').mockImplementation(async (_model, _task, _params, _progress, options) => {
    await new Promise<void>((_resolve, reject) => options!.signal!.addEventListener('abort', () => reject(new Error('停止本地轮询')), { once: true }))
    throw new Error('unreachable')
  })
  const taskId = crypto.randomUUID()
  await submitCanvasGenerationTask({ modelId: 'canvas-task-fixture', mediaType: 'image', prompt: '后台取消', options: {} },
    { mode: 'canvas', projectId, sourceNodeIds: [] }, taskId)
  await vi.waitFor(() => expect(polling).toHaveBeenCalledTimes(1))
  const otherProject = await useProjectStore.getState().createProject('其他项目')
  await openCanvasProject(otherProject, new AbortController().signal)
  const active = useCanvasStore.getState()
  const execute = taskControlSession()
  expect(await execute('cancel_generation_task', { taskId, reason: '取消原任务' })).toMatchObject({ ok: true })
  await vi.waitFor(() => expect(records.get(taskId)?.status).toBe('cancelled'))
  expect(useCanvasStore.getState()).toBe(active)
  const saved = await readPersistedCanvasProjectSnapshot(projectId)
  expect(saved.nodes.find(node => node.data.generationTaskId === taskId)?.data).toMatchObject({
    generationCancelled: true, isGenerating: false, serverTaskId: 'background-cancel',
  })
  expect(await getCanvasGenerationTask(taskId)).toMatchObject({ status: 'cancelled', cancellable: false, resultAvailable: false })
})

it('生成已经派发后修改输入，原结果保存成功不会被缓存发布校验误报失败', async () => {
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  const generate = vi.mocked(GenerationService.getInstance().generate).mockImplementation(async () => {
    await pending
    return { status: 'completed', url: 'C:/original-result.png', filePath: 'C:/original-result.png' }
  })
  const taskId = crypto.randomUUID()
  const submitted = await submitCanvasGenerationTask({ modelId: 'canvas-task-fixture', mediaType: 'image', prompt: '原始描述', options: {} },
    { mode: 'canvas', projectId, sourceNodeIds: [] }, taskId)
  await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1))
  const nodeId = submitted.nodeRef.id.slice(projectId.length + 1)
  useCanvasStore.getState().updateNodeData(nodeId, { prompt: '下次生成的描述' })
  release()
  await vi.waitFor(() => expect(records.get(taskId)?.status).toBe('success'))
  expect(await getCanvasGenerationTask(taskId)).toMatchObject({ status: 'success', resultAvailable: true })
  const saved = await readPersistedCanvasProjectSnapshot(projectId)
  expect(saved.nodes.find(node => node.id === nodeId)?.data.prompt).toBe('下次生成的描述')
  expect(saved.nodes.find(node => node.data.generationTaskId === taskId)?.data).toMatchObject({ imageUrl: 'C:/original-result.png', isGenerating: false })
  expect(generate).toHaveBeenCalledTimes(1)
})

it('没有活动执行的旧任务取消明确返回未执行，保留原供应商标识', async () => {
  const { taskId, resultId } = await restoredTask({ serverTaskId: 'original-server', serverTaskModelId: 'canvas-task-fixture' })
  const result = await taskControlSession()('cancel_generation_task', { taskId, reason: '停止原任务' })
  expect(result).toMatchObject({ ok: false, error: { details: { execution: { notExecuted: true } } } })
  expect(useCanvasStore.getState().nodes.find(node => node.id === resultId)?.data.serverTaskId).toBe('original-server')
  expect(records.get(taskId)?.status).toBe('pending')
})

it('提交前用户修改生成参数，原任务不能按未经估价的新输入执行', async () => {
  const taskId = crypto.randomUUID()
  const task = await submitCanvasGenerationTask({ modelId: 'canvas-task-fixture', mediaType: 'image', prompt: '原提示词', options: {} }, { mode: 'canvas', projectId, sourceNodeIds: [] }, taskId)
  const nodeId = task.nodeRef.id.slice(projectId.length + 1)
  useCanvasStore.getState().updateNodeData(nodeId, { prompt: '新的提示词' })
  const run = vi.fn(async () => ({ status: 'completed' as const, resultNodeIds: [] }))
  registerCanvasNodeExecutor(nodeId, { kind: 'standard-generation', run })
  await vi.waitFor(() => expect(records.get(taskId)?.status).toBe('error'))
  expect(run).not.toHaveBeenCalled()
  expect(GenerationService.getInstance().generate).not.toHaveBeenCalled()
})
