import { registry } from '@/core/ModelRegistry'
import { createLogger } from '@/core/logging'
import type { GenerationDestination } from '@/core/assistant/capabilities/generationApplicationCapabilities'
import type { GenerationPreparationInput } from '@/features/generation/application/generationPreparationService'
import { databaseService } from '@/services/database/DatabaseService'
import { useCanvasStore } from '@/stores/canvasStore'
import { useProjectStore } from '@/stores/projectStore'
import { useCanvasGenerationProgressStore } from '@/stores/canvasGenerationProgressStore'
import { CANVAS_NODE_TYPES } from '../domain/canvasNodes'
import { stageControlledCanvasNode, stageCanvasConnection, requireCurrentCanvasProject } from './canvasApplicationService'
import { runCanvasTransaction } from './canvasBatchService'
import { isCanvasNodeExecutorReady, runCanvasNode } from './canvasExecutionService'
import { confirmCanvasPersistence, runCanvasMutationStage } from './canvasPersistenceService'
import { readPersistedCanvasProjectSnapshot } from './canvasQueryService'
import { getGraphNodeMediaOutputs } from './graphOutputResolver'
import { getCanvasNodeDefinition } from '../domain/nodeRegistry'
import { publishCanvasGenerationTaskStatus } from '@/features/generation/application/generationTaskStatusRegistry'

type CanvasDestination = Extract<GenerationDestination, { mode: 'canvas' }>
const logger = createLogger('features.canvas.generationTask')
const activeTasks = new Set<string>()
const marker = '__canvasGeneration'

export function resolveCanvasGenerationOptions(input: GenerationPreparationInput, destination: CanvasDestination): Record<string, unknown> {
  requireCurrentCanvasProject(destination.projectId)
  const { nodes } = useCanvasStore.getState()
  const index = new Map(nodes.map(node => [node.id, node]))
  const options = { ...input.options }
  for (const sourceId of destination.sourceNodeIds) {
    const source = index.get(sourceId)
    if (!source) throw new Error('参考节点已不存在，请重新读取原画布。')
    if (getCanvasNodeDefinition(source.type)?.executionKind) throw new Error('参考图请使用已生成的结果节点，不要把需要重新执行的生成节点作为输入。')
    const outputs = getGraphNodeMediaOutputs(source, index)
    if (!outputs.length) throw new Error('参考节点还没有可用素材，请先完成原节点。')
    for (const output of outputs) {
      const key = output.kind === 'image' ? 'images' : output.kind === 'video' ? 'videos' : output.kind === 'audio' ? 'audios' : null
      if (!key) continue
      const previous = Array.isArray(options[key]) ? options[key] as unknown[] : []
      options[key] = [...new Set([...previous, output.url])]
    }
  }
  return options
}

export async function submitCanvasGenerationTask(input: GenerationPreparationInput, destination: CanvasDestination, taskId: string) {
  requireCurrentCanvasProject(destination.projectId)
  if (await databaseService.getHistoryById(taskId)) throw new Error('此生成任务已登记，请查询原任务，不要重新提交。')
  const model = registry.getModel(input.modelId)
  if (!model) throw new Error('生成模型不存在。')
  const params = Object.fromEntries(Object.entries(input.options ?? {}).filter(([key]) => model.params.some(param => param.id === key)))
  const nodeType = input.mediaType === 'image' ? CANVAS_NODE_TYPES.imageEdit : input.mediaType === 'video' ? CANVAS_NODE_TYPES.videoGen : CANVAS_NODE_TYPES.audioGen
  const placement = destination.placement ?? (destination.sourceNodeIds[0]
    ? { mode: 'right_of_node' as const, anchorNodeId: destination.sourceNodeIds[0] }
    : { mode: 'viewport_center' as const })
  const transaction = await runCanvasTransaction(destination.projectId, destination.sourceNodeIds.length + 1, options => {
    const created = stageControlledCanvasNode({ projectId: destination.projectId, nodeType, placement,
      data: { modelId: input.modelId, prompt: input.prompt, params } }, options)
    const nodeId = String(created.nodeId)
    const connections = []
    for (const sourceNodeId of destination.sourceNodeIds) connections.push(stageCanvasConnection({ projectId: destination.projectId, sourceNodeId, targetNodeId: nodeId }, options))
    // 媒体由宿主解析；沿用标准节点的本地媒体输入，连线仍由正式图解析器负责。
    const mediaInputs = Object.fromEntries(['image', 'video', 'audio'].map(kind => [kind,
      Array.isArray(input.options?.[`${kind}s`]) ? input.options![`${kind}s`] : []]))
    runCanvasMutationStage(options, () => useCanvasStore.getState().updateNodeData(nodeId, { mediaInputs }))
    return [created, ...connections]
  })
  const nodeId = String(transaction.appliedOperations[0].nodeId)
  const inputFingerprint = (): string => {
    requireCurrentCanvasProject(destination.projectId)
    const { nodes, edges } = useCanvasStore.getState()
    const current = nodes.find(node => node.id === nodeId)?.data as DynamicValueMap | undefined
    return JSON.stringify({ modelId: current?.modelId, prompt: current?.prompt, params: current?.params,
      mediaInputs: current?.mediaInputs, sources: destination.sourceNodeIds.map(id => {
        const source = nodes.find(node => node.id === id)
        return source ? getGraphNodeMediaOutputs(source, new Map(nodes.map(node => [node.id, node]))) : null
      }),
      edges: edges.filter(edge => edge.target === nodeId) })
  }
  const fingerprint = inputFingerprint()
  const assertCurrent = (): void => { if (inputFingerprint() !== fingerprint) throw new Error('节点输入已更改，请重新提交以核对生成参数和费用。') }
  const metadata = { projectId: destination.projectId, nodeId }
  await databaseService.insertHistory({ id: taskId, modelId: input.modelId, providerId: model.meta.provider, type: input.mediaType,
    prompt: input.prompt, params: { ...input.options, [marker]: metadata }, filePath: null, taskId: null,
    status: 'pending', errorMessage: null, cost: null, duration: null })
  activeTasks.add(taskId)
  const publish = (status: string, resultAvailable = false, errorMessage: string | null = null): void => publishCanvasGenerationTaskStatus({
    taskId, status, progress: resultAvailable ? 100 : 0, modelId: input.modelId, mediaType: input.mediaType,
    resultAvailable, errorCode: null, errorMessage, cancellable: false,
  })
  publish('pending')
  logger.info('画布生成已创建节点与连线', { event: 'canvas.generationTask.start', taskId, projectId: destination.projectId, nodeId })
  void (async () => {
    const deadline = Date.now() + 10000
    while (!isCanvasNodeExecutorReady(nodeId)) {
      requireCurrentCanvasProject(destination.projectId)
      if (Date.now() >= deadline) throw new Error('生成节点尚未就绪，节点和参数已保留，可在画布中重试。')
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    await databaseService.updateHistory(taskId, { status: 'generating' })
    publish('generating')
    assertCurrent()
    await runCanvasNode(nodeId, assertCurrent)
    await confirmCanvasPersistence(destination.projectId)
    const snapshot = await readPersistedCanvasProjectSnapshot(destination.projectId)
    const source = snapshot.nodes.find(node => node.id === nodeId)
    const outputs = source ? getGraphNodeMediaOutputs(source, new Map(snapshot.nodes.map(node => [node.id, node]))) : []
    if (!outputs.length) throw new Error('生成结束但结果尚未保存，请在原画布检查。')
    await databaseService.updateHistory(taskId, { status: 'success', filePath: outputs[0].url })
    publish('success', true)
    logger.info('画布生成结果已保存', { event: 'canvas.generationTask.completed', taskId, nodeId })
  })().catch(async (error: unknown) => {
    publish('error', false, error instanceof Error ? error.message : '画布生成失败')
    logger.error('画布生成失败', error, { event: 'canvas.generationTask.failed', taskId })
    await databaseService.updateHistory(taskId, { status: 'error', errorMessage: error instanceof Error ? error.message : '画布生成失败' })
  }).catch(error => logger.error('画布生成状态保存失败', error, { event: 'canvas.generationTask.save_failed', taskId }))
    .finally(() => activeTasks.delete(taskId))
  return { taskId, status: 'submitted', taskRef: { kind: 'generation.task', id: taskId },
    nodeRef: { kind: 'canvas.node', id: `${destination.projectId}:${nodeId}` },
    verification: { verified: true, condition: '生成节点、连线及任务已持久保存，后续进度在原画布中显示' } }
}

export async function getCanvasGenerationTask(taskId: string): Promise<Record<string, unknown> | null> {
  const record = await databaseService.getHistoryById(taskId)
  const value = record?.params[marker]
  if (!record || !value || typeof value !== 'object' || Array.isArray(value)) return null
  const { projectId, nodeId } = value as Record<string, unknown>
  if (typeof projectId !== 'string' || typeof nodeId !== 'string') return null
  const snapshot = await readPersistedCanvasProjectSnapshot(projectId)
  const nodes = useProjectStore.getState().currentProjectId === projectId ? useCanvasStore.getState().nodes : snapshot.nodes
  const node = nodes.find(item => item.id === nodeId)
  const outputs = node ? getGraphNodeMediaOutputs(node, new Map(nodes.map(item => [item.id, item]))) : []
  const resultNodes = nodes.filter(item => (item.data as DynamicValueMap).generationSourceNodeId === nodeId)
  const waitingExternal = activeTasks.has(taskId) || resultNodes.some(item => item.data.isGenerating === true)
  const status = outputs.length ? 'success' : waitingExternal ? 'generating' : 'error'
  const progressState = useCanvasGenerationProgressStore.getState()
  const progress = status === 'success' ? 100 : Math.max(0, ...resultNodes.map(item => (progressState.progress[item.id] ?? 0) * 100))
  const errorMessage = status === 'error' ? record.errorMessage ?? '原画布任务未完成，请检查原生成节点；不会自动重复提交。' : null
  publishCanvasGenerationTaskStatus({ taskId, status, progress, modelId: record.modelId, mediaType: record.type,
    resultAvailable: outputs.length > 0, cancellable: false, errorCode: null, errorMessage })
  return { taskId, status, normalizedStatus: status, progress, modelId: record.modelId, mediaType: record.type,
    resultAvailable: outputs.length > 0, cancellable: false, waitingExternal, errorMessage,
    taskRef: { kind: 'generation.task', id: taskId }, nodeRef: { kind: 'canvas.node', id: `${projectId}:${nodeId}` },
    resultRefs: resultNodes.map(item => ({ kind: 'canvas.node', id: `${projectId}:${item.id}` })) }
}
