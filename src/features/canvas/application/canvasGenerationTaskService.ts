import { registry } from '@/core/ModelRegistry'
import i18n from '@/i18n'
import { createLogger } from '@/core/logging'
import type { CanvasGenerationResumeInput, GenerationDestination } from '@/core/assistant/capabilities/generationApplicationCapabilities'
import type { GenerationPreparationInput } from '@/features/generation/application/generationPreparationService'
import { databaseService } from '@/services/database/DatabaseService'
import { useCanvasStore } from '@/stores/canvasStore'
import { useProjectStore } from '@/stores/projectStore'
import { useCanvasGenerationProgressStore } from '@/stores/canvasGenerationProgressStore'
import { CANVAS_NODE_TYPES, type CanvasNodeType } from '../domain/canvasNodes'
import { stageControlledCanvasNode, stageCanvasConnection, requireCurrentCanvasProject, CanvasApplicationError } from './canvasApplicationService'
import { runCanvasTransaction } from './canvasBatchService'
import { retainCanvasTaskExecutor, runCanvasNode } from './canvasExecutionService'
import { createGenerationNodeExecutor } from './generationNodeExecutor'
import { prepareImageEditNodeRuntime } from './imageEditNodePreparation'
import { confirmCanvasPersistence, runCanvasMutationStage } from './canvasPersistenceService'
import { readPersistedCanvasProjectSnapshot } from './canvasQueryService'
import { getGraphNodeMediaOutputs } from './graphOutputResolver'
import { getCanvasNodeDefinition } from '../domain/nodeRegistry'
import { publishCanvasGenerationTaskStatus } from '@/features/generation/application/generationTaskStatusRegistry'
import { normalizeGenerationTaskStatus } from '@/core/assistant/externalWait'
import { readResumableServerTask } from '../domain/resumableTask'
import { isCanvasGenerationTaskActive, hasCanvasGenerationResumeLease } from '../generation/activeGenerationTasks'
import { resumeCanvasProjectGeneration } from './canvasResumePollingService'

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
  const metadata = { version: 2, projectId: destination.projectId, nodeId }
  await databaseService.insertHistory({ id: taskId, modelId: input.modelId, providerId: model.meta.provider, type: input.mediaType,
    prompt: input.prompt, params: { ...input.options, [marker]: metadata }, filePath: null, taskId: null,
    status: 'pending', errorMessage: null, cost: null, duration: null })
  activeTasks.add(taskId)
  const publish = (status: string, resultAvailable = false, errorMessage: string | null = null): void => publishCanvasGenerationTaskStatus({
    taskId, status, progress: resultAvailable ? 100 : 0, modelId: input.modelId, mediaType: input.mediaType,
    resultAvailable, errorCode: null, errorMessage, cancellable: false,
  })
  publish('pending')
  const definition = getCanvasNodeDefinition(nodeType)!
  const acceptedKinds = definition.ports?.target?.accepts ?? []
  const releaseExecutor = retainCanvasTaskExecutor(destination.projectId, nodeId, createGenerationNodeExecutor(() => ({
    nodeId, modelType: input.mediaType, resultNodeType: definition.generation!.resultNodeType as CanvasNodeType,
    acceptedKinds, acceptedMediaKinds: (['image', 'video', 'audio'] as const).filter(kind => acceptedKinds.includes(kind)),
    capability: null, showModelInput: true, requirePrompt: true,
    promptRequiredKey: 'node.imageEdit.promptRequired', apiKeyRequiredKey: 'node.imageEdit.apiKeyRequired', resultTitleKey: definition.menuLabelKey,
    setPromptInvalid: () => undefined, t: i18n.t.bind(i18n),
    resultNodeExtraData: { generationTaskId: taskId, ...(input.mediaType === 'image' ? { resultKind: 'generic' } : {}) },
    ...(input.mediaType === 'image' ? {
      prepareRuntimeParams: context => prepareImageEditNodeRuntime(context, { isOutpaint: false, excludeParamIds: [], t: i18n.t.bind(i18n) }) } : {}),
  })))
  logger.info('画布生成已创建节点与连线', { event: 'canvas.generationTask.start', taskId, projectId: destination.projectId, nodeId })
  void (async () => {
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
    logger.error('画布生成失败', error, { event: 'canvas.generationTask.failed', taskId })
    const persisted = await readPersistedCanvasProjectSnapshot(destination.projectId).catch((readError: unknown) => {
      if (readError instanceof Error && readError.message === 'PROJECT_NOT_FOUND') return null
      throw readError
    })
    const canResume = persisted?.nodes.some(node => node.data.generationTaskId === taskId
      && readResumableServerTask(node.data as DynamicValueMap))
    const status = canResume ? 'pending' : 'error'
    const message = error instanceof Error ? error.message : '画布生成失败'
    publish(status, false, message)
    await databaseService.updateHistory(taskId, { status, errorMessage: message })
  }).catch(error => logger.error('画布生成状态保存失败', error, { event: 'canvas.generationTask.save_failed', taskId }))
    .finally(() => { activeTasks.delete(taskId); releaseExecutor() })
  return { taskId, status: 'submitted', taskRef: { kind: 'generation.task', id: taskId },
    nodeRef: { kind: 'canvas.node', id: `${destination.projectId}:${nodeId}` },
    verification: { verified: true, condition: '生成节点、连线及任务已持久保存，后续进度在原画布中显示' } }
}

export async function getCanvasGenerationTask(taskId: string): Promise<Record<string, unknown> | null> {
  const record = await databaseService.getHistoryById(taskId)
  const value = record?.params[marker]
  if (!record || !value || typeof value !== 'object' || Array.isArray(value)) return null
  const { projectId, nodeId, version } = value as Record<string, unknown>
  if (typeof projectId !== 'string' || typeof nodeId !== 'string') return null
  const snapshot = await readPersistedCanvasProjectSnapshot(projectId).catch((error: unknown) => {
    if (error instanceof Error && error.message === 'PROJECT_NOT_FOUND') return null
    throw error
  })
  const savedNodes = snapshot?.nodes ?? []
  const nodes = useProjectStore.getState().currentProjectId === projectId ? useCanvasStore.getState().nodes : savedNodes
  const ownsResult = (node: (typeof nodes)[number]): boolean => node.data.generationSourceNodeId === nodeId
    && (version === 2 ? node.data.generationTaskId === taskId : node.data.generationTaskId === undefined)
  const resultNodes = nodes.filter(ownsResult)
  const savedResults = savedNodes.filter(ownsResult)
  const savedIndex = new Map(savedNodes.map(node => [node.id, node]))
  const outputs = savedResults.flatMap(node => getGraphNodeMediaOutputs(node, savedIndex))
  const resumable = resultNodes.flatMap(node => {
    const task = readResumableServerTask(node.data as DynamicValueMap)
    return task ? [task] : []
  })
  const hasActiveWork = activeTasks.has(taskId) || resumable.some(task =>
    isCanvasGenerationTaskActive(task.taskId) || hasCanvasGenerationResumeLease(projectId, task.taskId))
  let recordedStatus = normalizeGenerationTaskStatus(record.status)
  // 仅从本任务带身份的、完整持久化的原子输出修复历史。旧无身份结果不能冒认。
  if (!hasActiveWork && version === 2 && ['pending', 'queued', 'generating'].includes(recordedStatus ?? '') && savedResults.length > 0
    && outputs.length >= savedResults.length && savedResults.every(node =>
      node.data.isGenerating !== true && !node.data.generationError && typeof node.data.generationOutputCommitId === 'string')) {
    const filePath = outputs.map(output => output.url).join('|||')
    await databaseService.updateHistory(taskId, { status: 'success', filePath, errorMessage: null })
    record.status = 'success'; record.filePath = filePath; record.errorMessage = null
    recordedStatus = 'success'
    logger.info('原画布任务已按保存结果对账', { event: 'canvas.generationTask.reconciled', taskId, projectId, nodeId })
  }
  const resultAvailable = recordedStatus === 'success' && Boolean(record.filePath)
  const waitingExternal = !resultAvailable && hasActiveWork
  const status = resultAvailable ? 'success' : waitingExternal ? 'generating'
    : recordedStatus === 'error' || recordedStatus === 'timeout' ? recordedStatus
      : resumable.length ? 'pending' : 'error'
  const progressState = useCanvasGenerationProgressStore.getState()
  const progress = status === 'success' ? 100 : Math.max(0, ...resultNodes.map(item => (progressState.progress[item.id] ?? 0) * 100))
  const errorCode = status === 'error' && !record.errorMessage ? 'GENERATION_OUTCOME_UNKNOWN' : null
  const errorMessage = status === 'error' || status === 'timeout'
    ? record.errorMessage ?? '原画布任务的执行结果尚未核实；当前没有活动执行，不能据此重新提交生成。'
    : status === 'pending' ? '原供应商任务已登记，等待续查；不会重新提交生成。' : null
  publishCanvasGenerationTaskStatus({ taskId, status, progress, modelId: record.modelId, mediaType: record.type,
    resultAvailable, cancellable: false, waitingExternal, errorCode, errorMessage })
  return { taskId, status, normalizedStatus: status, progress, modelId: record.modelId, mediaType: record.type,
    resultAvailable, cancellable: false, waitingExternal, errorCode, errorMessage,
    resumeInput: !resultAvailable && resumable.length > 0 ? {
      taskId, projectId, sourceNodeId: nodeId, resultNodeIds: resultNodes.map(node => node.id),
    } satisfies CanvasGenerationResumeInput : null,
    taskRef: { kind: 'generation.task', id: taskId }, nodeRef: { kind: 'canvas.node', id: `${projectId}:${nodeId}` },
    resultRefs: resultNodes.map(item => ({ kind: 'canvas.node', id: `${projectId}:${item.id}` })) }
}

export async function resumeCanvasGenerationTask(input: CanvasGenerationResumeInput, signal?: AbortSignal) {
  const reject = (message: string): never => { throw new CanvasApplicationError('INVALID_INPUT', message, true, { execution: { notExecuted: true } }) }
  const task = await getCanvasGenerationTask(input.taskId)
  if (!task) return reject('原画布任务不存在，请用 get_generation_task 核对任务。')
  const nodeRef = task.nodeRef as { id: string }
  if (nodeRef.id !== `${input.projectId}:${input.sourceNodeId}`) {
    return reject('项目或来源节点与原任务不一致，请使用 get_generation_task 返回的 resumeInput。')
  }
  if (task.resultAvailable) return { taskId: input.taskId, status: 'success', task }
  const expected = task.resumeInput as CanvasGenerationResumeInput | null
  if (!expected) return reject('原任务没有可续查的供应商任务标识，不能通过恢复入口重新生成。')
  const selected = new Set(input.resultNodeIds)
  if (selected.size !== input.resultNodeIds.length || selected.size !== expected.resultNodeIds.length
    || expected.resultNodeIds.some(id => !selected.has(id))) {
    return reject('结果节点与原任务不一致，请重新读取 get_generation_task 的 resumeInput。')
  }
  let started = 0
  if (!task.waitingExternal) {
    if (signal?.aborted) return reject('恢复请求在开始前已取消。')
    try { requireCurrentCanvasProject(input.projectId) } catch { return reject('请先打开任务的原画布项目，再续查原任务。') }
    started = resumeCanvasProjectGeneration(input.projectId, selected, { retryFailed: true })
  }
  const current = await getCanvasGenerationTask(input.taskId)
  if (!current) throw new Error('恢复期间原任务已不存在。')
  if (!started && !current.waitingExternal && !current.resultAvailable) return reject('原任务未能开始续查，请检查原结果节点。')
  return { taskId: input.taskId, status: String(current.status), task: current }
}
