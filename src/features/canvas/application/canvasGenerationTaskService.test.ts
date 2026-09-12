// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { registry } from '@/core/ModelRegistry'
import { databaseService } from '@/services/database/DatabaseService'
import type { HistoryRecord } from '@/services/database'
import { useProjectStore } from '@/stores/projectStore'
import { useCanvasStore } from '@/stores/canvasStore'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { readGenerationTaskStatusSnapshot } from '@/features/generation/application/generationTaskStatusRegistry'
import { CANVAS_NODE_TYPES } from '../domain/canvasNodes'
import { getCanvasGenerationTask, resolveCanvasGenerationOptions, submitCanvasGenerationTask } from './canvasGenerationTaskService'
import { registerCanvasNodeExecutor, resetCanvasExecutionServiceForTests } from './canvasExecutionService'
import { readPersistedCanvasProjectSnapshot } from './canvasQueryService'
import { collectInputMedia } from './graphMediaResolver'

let projectId: string
const records = new Map<string, HistoryRecord>()
beforeEach(async () => {
  installHarnessNativeStorage()
  resetCanvasExecutionServiceForTests()
  records.clear()
  vi.spyOn(databaseService, 'getHistoryById').mockImplementation(async id => records.get(id) ?? null)
  vi.spyOn(databaseService, 'insertHistory').mockImplementation(async row => { records.set(row.id, { ...row, createdAt: 'now', updatedAt: 'now' }) })
  vi.spyOn(databaseService, 'updateHistory').mockImplementation(async (id, patch) => { Object.assign(records.get(id)!, patch) })
  registry.register({ meta: { id: 'canvas-task-fixture', canonicalModelId: 'nano-banana', provider: 'fixture', type: 'image', name: { zh: '测试', en: 'Test' } }, params: [], endpoints: '/fixture',
    inputLimits: { images: { max: 1 }, videos: { max: 0 }, audios: { max: 0 } }, pricing: { currency: '$', fixed: 0.03 }, request: { builder: params => params } })
  projectId = await useProjectStore.getState().createProject('画布生成测试')
  useCanvasStore.getState().setCanvasData([{ id: 'reference', type: CANVAS_NODE_TYPES.upload, position: { x: 10, y: 10 }, data: { imageUrl: 'C:/reference.png' } }], [])
})
afterEach(() => { resetCanvasExecutionServiceForTests(); registry.unregister('canvas-task-fixture'); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })

it('先持久创建标准节点和参考连线，再调用画布执行器并回读同一任务的结果', async () => {
  const destination = { mode: 'canvas' as const, projectId, sourceNodeIds: ['reference'] }
  const input = { modelId: 'canvas-task-fixture', mediaType: 'image' as const, prompt: '生成三视图', options: {} }
  input.options = resolveCanvasGenerationOptions(input, destination)
  const taskId = crypto.randomUUID()
  const submitted = await submitCanvasGenerationTask(input, destination, taskId)
  const saved = await readPersistedCanvasProjectSnapshot(projectId)
  const node = saved.nodes.find(item => item.type === CANVAS_NODE_TYPES.imageEdit)!
  expect(node.data).toMatchObject({ modelId: input.modelId, prompt: input.prompt })
  expect(node.position.x).toBeGreaterThan(10)
  expect(saved.edges).toEqual([expect.objectContaining({ source: 'reference', target: node.id })])
  expect(submitted.nodeRef.id).toBe(`${projectId}:${node.id}`)
  const run = vi.fn(async () => {
    expect(collectInputMedia(node.id, useCanvasStore.getState().nodes, useCanvasStore.getState().edges).map(item => item.url)).toEqual(['C:/reference.png'])
    const resultId = useCanvasStore.getState().addNode(CANVAS_NODE_TYPES.exportImage, { x: node.position.x + 400, y: 10 }, {
      imageUrl: 'C:/result.png', generationSourceNodeId: node.id, generationOutputCommitId: 'commit', generationOutputDescriptor: { outputId: 'output', order: 0 },
    })
    return { status: 'completed' as const, resultNodeIds: [resultId] }
  })
  registerCanvasNodeExecutor(node.id, { kind: 'standard-generation', dependency: { mode: 'auto', outputMode: 'result-nodes' }, run })
  await vi.waitFor(() => expect(records.get(taskId)?.status).toBe('success'))
  expect(run).toHaveBeenCalledTimes(1)
  expect(await getCanvasGenerationTask(taskId)).toMatchObject({ status: 'success', resultAvailable: true, progress: 100 })
  expect(readGenerationTaskStatusSnapshot(taskId)).toMatchObject({ status: 'success', resultAvailable: true })
  expect(records.get(taskId)?.filePath).toBe('C:/result.png')
})

it('原生成仍在等待结果时可连续新增五个请求，节点与参考连线立即持久化', async () => {
  let release!: () => void
  const waiting = new Promise<void>(resolve => { release = resolve })
  const taskIds: string[] = []
  const nodeIds: string[] = []
  const unregister: Array<() => void> = []
  try {
    for (let index = 0; index < 5; index++) {
      const taskId = crypto.randomUUID()
      const destination = { mode: 'canvas' as const, projectId, sourceNodeIds: ['reference'] }
      const input = { modelId: 'canvas-task-fixture', mediaType: 'image' as const, prompt: `第 ${index} 张`, options: {} }
      input.options = resolveCanvasGenerationOptions(input, destination)
      const submitted = await submitCanvasGenerationTask(input, destination, taskId)
      const nodeId = submitted.nodeRef.id.slice(projectId.length + 1)
      taskIds.push(taskId); nodeIds.push(nodeId)
      unregister.push(registerCanvasNodeExecutor(nodeId, { kind: 'standard-generation', dependency: { mode: 'auto', outputMode: 'result-nodes' }, run: async () => {
        await waiting
        const resultId = useCanvasStore.getState().addNode(CANVAS_NODE_TYPES.exportImage, { x: 500, y: index * 400 }, {
          imageUrl: `C:/result-${index}.png`, generationSourceNodeId: nodeId, generationOutputCommitId: `commit-${index}`,
          generationOutputDescriptor: { outputId: `output-${index}`, order: 0 },
        })
        return { status: 'completed', resultNodeIds: [resultId] }
      } }))
      if (index === 0) await vi.waitFor(() => expect(records.get(taskId)?.status).toBe('generating'))
    }
    const saved = await readPersistedCanvasProjectSnapshot(projectId)
    expect(saved.nodes.filter(node => nodeIds.includes(node.id))).toHaveLength(5)
    expect(saved.edges.filter(edge => edge.source === 'reference' && nodeIds.includes(edge.target))).toHaveLength(5)
    expect(taskIds.every(id => records.get(id)?.status !== 'success')).toBe(true)
    release()
    await vi.waitFor(() => expect(taskIds.map(id => records.get(id)?.status)).toEqual(Array(5).fill('success')))
    const completed = await readPersistedCanvasProjectSnapshot(projectId)
    expect(completed.nodes.filter(node => node.data.generationSourceNodeId && nodeIds.includes(String(node.data.generationSourceNodeId)))).toHaveLength(5)
  } finally { release(); unregister.forEach(dispose => dispose()) }
})

it('节点创建后切换项目不会在别的项目执行或重新付费', async () => {
  const taskId = crypto.randomUUID()
  await submitCanvasGenerationTask({ modelId: 'canvas-task-fixture', mediaType: 'image', prompt: '图', options: {} }, { mode: 'canvas', projectId, sourceNodeIds: [] }, taskId)
  useProjectStore.setState({ currentProjectId: 'other' })
  await vi.waitFor(() => expect(records.get(taskId)?.status).toBe('error'))
  expect(records.get(taskId)?.filePath).toBeNull()
})

it('等待节点就绪时用户修改生成参数，原任务不能按未经估价的新输入执行', async () => {
  const taskId = crypto.randomUUID()
  const task = await submitCanvasGenerationTask({ modelId: 'canvas-task-fixture', mediaType: 'image', prompt: '原提示词', options: {} }, { mode: 'canvas', projectId, sourceNodeIds: [] }, taskId)
  const nodeId = task.nodeRef.id.slice(projectId.length + 1)
  useCanvasStore.getState().updateNodeData(nodeId, { prompt: '新的提示词' })
  const run = vi.fn(async () => ({ status: 'completed' as const, resultNodeIds: [] }))
  registerCanvasNodeExecutor(nodeId, { kind: 'standard-generation', run })
  await vi.waitFor(() => expect(records.get(taskId)?.status).toBe('error'))
  expect(run).not.toHaveBeenCalled()
})
