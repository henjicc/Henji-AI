// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { registry } from '@/core/ModelRegistry'
import { GenerationService } from '@/core/services/GenerationService'
import { useSettingsStore } from '@/stores/settingsStore'
import { databaseService } from '@/services/database/DatabaseService'
import type { HistoryRecord } from '@/services/database'
import { pauseCanvasProjectPersistence, useProjectStore } from '@/stores/projectStore'
import { useCanvasStore } from '@/stores/canvasStore'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { readGenerationTaskStatusSnapshot, replaceGenerationTaskStatusSnapshots } from '@/features/generation/application/generationTaskStatusRegistry'
import { CANVAS_NODE_TYPES } from '../domain/canvasNodes'
import { getCanvasGenerationTask, resolveCanvasGenerationOptions, submitCanvasGenerationTask } from './canvasGenerationTaskService'
import { registerCanvasNodeExecutor, resetCanvasExecutionServiceForTests } from './canvasExecutionService'
import { readPersistedCanvasProjectSnapshot } from './canvasQueryService'
import { confirmCanvasPersistence } from './canvasPersistenceService'
import { commitCanvasGenerationOutputs } from './generationOutputApplicationService'
import { createDefaultGenerationOutputItems } from '../domain/generationOutputs'
import { acquireCanvasGenerationResumeLease, releaseCanvasGenerationResumeLease } from '../generation/activeGenerationTasks'
import { createApplicationCallerGrant } from '@/core/application-control/callerContext'
import { MCP_CAPABILITY_IDS, MCP_READ_PERMISSIONS } from '@/core/application-control/localHostContracts'
import { createApplicationCapabilitySession } from '@/features/application-control/applicationCapabilityService'
import { resumeCanvasProjectGeneration } from './canvasResumePollingService'
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
  resetCanvasExecutionServiceForTests()
  records.clear()
  useSettingsStore.setState({ providerKeyStatus: { ...useSettingsStore.getState().providerKeyStatus, fixture: true } })
  vi.spyOn(GenerationService.getInstance(), 'getProgressEstimate').mockResolvedValue(null)
  vi.spyOn(GenerationService.getInstance(), 'generate').mockResolvedValue({ status: 'completed', url: 'C:/result.png', filePath: 'C:/result.png' })
  vi.spyOn(databaseService, 'getHistoryById').mockImplementation(async id => records.get(id) ?? null)
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

it('原生成仍在等待结果时可连续新增五个请求，节点与参考连线立即持久化', async () => {
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
    release()
    await vi.waitFor(() => expect(taskIds.map(id => records.get(id)?.status), JSON.stringify([...records.values()].map(record => ({ status: record.status, error: record.errorMessage })))).toEqual(Array(5).fill('success')))
    const completed = await readPersistedCanvasProjectSnapshot(projectId)
    expect(completed.nodes.filter(node => node.data.generationSourceNodeId && nodeIds.includes(String(node.data.generationSourceNodeId)))).toHaveLength(5)
  } finally { release() }
})

it('节点创建后切换项目不会在别的项目执行或重新付费', async () => {
  const taskId = crypto.randomUUID()
  await submitCanvasGenerationTask({ modelId: 'canvas-task-fixture', mediaType: 'image', prompt: '图', options: {} }, { mode: 'canvas', projectId, sourceNodeIds: [] }, taskId)
  useProjectStore.setState({ currentProjectId: 'other' })
  await vi.waitFor(() => expect(records.get(taskId)?.status).toBe('error'))
  expect(records.get(taskId)?.filePath).toBeNull()
})

it('供应商任务已保存后切换项目，返回可续查原任务并对账成功，不再次生成', async () => {
  vi.mocked(GenerationService.getInstance().generate).mockResolvedValue({ status: 'pending', taskId: 'persisted-provider-task', url: '' })
  let finishOriginal!: (value: { status: 'completed'; url: string; filePath: string }) => void
  const polling = vi.spyOn(GenerationService.getInstance(), 'continuePolling').mockImplementation(() => new Promise(resolve => { finishOriginal = resolve }))
  const taskId = crypto.randomUUID()
  await submitCanvasGenerationTask({ modelId: 'canvas-task-fixture', mediaType: 'image', prompt: '保留任务', options: {} },
    { mode: 'canvas', projectId, sourceNodeIds: [] }, taskId)
  await vi.waitFor(() => expect(polling).toHaveBeenCalledTimes(1))
  await confirmCanvasPersistence(projectId)
  useProjectStore.setState({ currentProjectId: 'other' })
  finishOriginal({ status: 'completed', url: 'C:/original.png', filePath: 'C:/original.png' })
  await vi.waitFor(() => expect(records.get(taskId)?.errorMessage).toContain('画布项目已切换'))
  expect(records.get(taskId)?.status).toBe('pending')
  useProjectStore.setState({ currentProjectId: projectId })
  polling.mockResolvedValue({ status: 'completed', url: 'C:/resumed.png', filePath: 'C:/resumed.png' })
  resumeCanvasProjectGeneration(projectId)
  await vi.waitFor(() => expect(useCanvasStore.getState().nodes.find(node => node.data.generationTaskId === taskId)?.data.imageUrl).toBe('C:/resumed.png'))
  await vi.waitFor(async () => expect(await getCanvasGenerationTask(taskId)).toMatchObject({ status: 'success', waitingExternal: false }))
  expect(records.get(taskId)).toMatchObject({ status: 'success', filePath: 'C:/resumed.png' })
  expect(GenerationService.getInstance().generate).toHaveBeenCalledTimes(1)
  expect(polling).toHaveBeenCalledTimes(2)
  expect(polling.mock.calls.every(call => call[1] === 'persisted-provider-task')).toBe(true)
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
