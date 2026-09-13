import { registry } from '@/core/ModelRegistry'
import { ApplicationPreflightFailure } from '@/core/application-control/execution/transactionFailure'
import { createLogger } from '@/core/logging'
import type { CanvasGenerationResumeInput, CanvasNodeGenerationInput, GenerationDestination } from '@/core/assistant/capabilities/generationApplicationCapabilities'
import type { GenerationPreparationInput } from '@/features/generation/application/generationPreparationService'
import { prepareGenerationModelInput } from '@/features/generation/application/generationPreparationService'
import { databaseService } from '@/services/database/DatabaseService'
import { useCanvasStore } from '@/stores/canvasStore'
import { useProjectStore } from '@/stores/projectStore'
import { useCanvasGenerationProgressStore } from '@/stores/canvasGenerationProgressStore'
import { CANVAS_NODE_TYPES, type CanvasNode } from '../domain/canvasNodes'
import { stageControlledCanvasNode, stageCanvasConnection, requireCurrentCanvasProject, CanvasApplicationError } from './canvasApplicationService'
import { runCanvasTransaction } from './canvasBatchService'
import { retainCanvasTaskExecutor, runCanvasNode, isCanvasNodeRunActive } from './canvasExecutionService'
import { createGenerationNodeExecutor } from './generationNodeExecutor'
import { readCanvasGenerationNodeProfile } from './canvasGenerationNodeProfile'
import { resolveGenerationNodeRuntime, createGenerationNodeRuntimeSignaturePayload } from '../nodes/shared/generationNodeRuntime'
import { createCanvasExecutionValueSignature } from './canvasExecutionCache'
import { createCanvasExecutionPlan } from './canvasExecutionPlan'
import { confirmCanvasPersistence, runCanvasMutationStage } from './canvasPersistenceService'
import { readPersistedCanvasProjectSnapshot } from './canvasQueryService'
import { getGraphNodeMediaOutputs } from './graphOutputResolver'
import { getCanvasNodeDefinition } from '../domain/nodeRegistry'
import { publishCanvasGenerationTaskStatus } from '@/features/generation/application/generationTaskStatusRegistry'
import { normalizeGenerationTaskStatus } from '@/core/assistant/externalWait'
import { readResumableServerTask } from '../domain/resumableTask'
import { isCanvasGenerationTaskActive, hasCanvasGenerationResumeLease } from '../generation/activeGenerationTasks'
import { resumeCanvasGenerationInProject, getCanvasResumeControllers } from './canvasResumePollingService'
import { CANVAS_GENERATION_CANCELLED_MESSAGE } from '../domain/generationFailure'

type CanvasDestination = Extract<GenerationDestination, { mode: 'canvas' }>
const logger = createLogger('features.canvas.generationTask')
const activeTasks = new Map<string, AbortController>()
const activeNodeTasks = new Map<string, string>()
const marker = '__canvasGeneration'

function completedTaskOutputPaths(nodes: CanvasNode[], taskId: string, sourceNodeId: string): string[] {
  const owned = nodes.filter(node => node.data.generationTaskId === taskId && node.data.generationSourceNodeId === sourceNodeId)
  if (!owned.length || owned.some(node => node.data.isGenerating === true || node.data.generationError
    || typeof node.data.generationOutputCommitId !== 'string')) return []
  const index = new Map(nodes.map(node => [node.id, node]))
  const outputs = owned.flatMap(node => getGraphNodeMediaOutputs(node, index))
  return outputs.length >= owned.length ? outputs.map(output => output.url) : []
}

function readNodeInputSignature(projectId: string, nodeId: string, store?: typeof useCanvasStore): string {
  if (!store) requireCurrentCanvasProject(projectId)
  const targetStore = store ?? useCanvasStore
  const profile = readCanvasGenerationNodeProfile(nodeId, targetStore)
  const runtime = resolveGenerationNodeRuntime(profile, targetStore)
  return createCanvasExecutionValueSignature({ ...createGenerationNodeRuntimeSignaturePayload(runtime),
    generationUi: runtime.data.generationUi, nodeId, projectId,
    edges: targetStore.getState().edges.filter(edge => edge.target === nodeId)
      .map(edge => ({ source: edge.source, sourceHandle: edge.sourceHandle, targetHandle: edge.targetHandle })) })
}

export async function prepareCanvasNodeGeneration(input: CanvasNodeGenerationInput) {
  const signature = readNodeInputSignature(input.projectId, input.nodeId)
  if (input.inputSignature && input.inputSignature !== signature) throw new CanvasApplicationError('INVALID_INPUT', '节点输入已改变，请重新调用 prepare_canvas_node_generation 获取当前参数和费用。', true)
  const canvas = useCanvasStore.getState()
  const plan = createCanvasExecutionPlan(input.nodeId, canvas.nodes, canvas.edges, () => 'auto')
  if (plan.dependencyNodeIds.length) throw new CanvasApplicationError('INVALID_INPUT', '请连接已完成的结果素材；本次节点估价不包含额外上游生成。', true)
  const executor = createGenerationNodeExecutor(() => readCanvasGenerationNodeProfile(input.nodeId))
  const prepared = await executor.prepare({ projectId: input.projectId, runId: 'prepare', trigger: 'direct', inputSignature: signature, assertCurrent: async () => undefined })
  if (readNodeInputSignature(input.projectId, input.nodeId) !== signature) throw new CanvasApplicationError('INVALID_INPUT', '准备期间节点输入已改变，请重新准备原节点。', true)
  const { runtime, generationParams } = prepared
  if (!runtime.model) throw new Error('原节点模型不存在。')
  const options = { ...generationParams, images: runtime.images, uploadedFilePaths: runtime.images,
    videos: runtime.videos, uploadedVideoFilePaths: runtime.videos, audios: runtime.audios, uploadedAudioFilePaths: runtime.audios }
  const resolved: GenerationPreparationInput = { modelId: runtime.modelId, mediaType: readCanvasGenerationNodeProfile(input.nodeId).modelType,
    prompt: String(generationParams.prompt ?? ''), options }
  return { preparation: prepareGenerationModelInput(resolved, runtime.model),
    submitInput: { projectId: input.projectId, nodeId: input.nodeId, inputSignature: signature } }
}

export async function submitCanvasNodeGeneration(input: CanvasNodeGenerationInput & { inputSignature: string }, taskId: string, signal?: AbortSignal) {
  const { preparation } = await prepareCanvasNodeGeneration(input).then(result => {
    signal?.throwIfAborted()
    return result
  }).catch(error => { throw new ApplicationPreflightFailure(error) })
  await confirmCanvasPersistence(input.projectId)
  if (signal?.aborted) throw new ApplicationPreflightFailure('任务已在提交前取消。')
  const profile = readCanvasGenerationNodeProfile(input.nodeId)
  const options = preparation.options as Record<string, unknown>
  return startCanvasGenerationTask({ modelId: String(preparation.modelId), mediaType: profile.modelType,
    prompt: String(options.prompt ?? ''), options }, { mode: 'canvas', projectId: input.projectId, sourceNodeIds: [] },
  input.nodeId, taskId, store => {
    const current = readNodeInputSignature(input.projectId, input.nodeId, store)
    if (current !== input.inputSignature) throw new Error('节点输入已更改，请重新准备生成参数和费用。')
    return current
  })
}

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
  await databaseService.init()
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
  const inputFingerprint = (store?: typeof useCanvasStore) => readNodeInputSignature(destination.projectId, nodeId, store)
  return startCanvasGenerationTask(input, destination, nodeId, taskId, inputFingerprint).catch(error => {
    // 此入口已经创建并保存节点，后续登记失败不能冒充整个操作尚未执行。
    if (error instanceof ApplicationPreflightFailure || error instanceof CanvasApplicationError) {
      throw new CanvasApplicationError('INVALID_INPUT', error.message, true,
        { nodeRef: { kind: 'canvas.node', id: `${destination.projectId}:${nodeId}` } })
    }
    throw error
  })
}

async function startCanvasGenerationTask(input: GenerationPreparationInput, destination: CanvasDestination,
  nodeId: string, taskId: string, inputFingerprint: (store?: typeof useCanvasStore) => string) {
  const key = `${destination.projectId}:${nodeId}`
  const existingTaskId = activeNodeTasks.get(key)
  if (existingTaskId) throw new CanvasApplicationError('INVALID_INPUT', '此节点已有正在执行的任务，请查询原任务；其他节点可以独立生成。', true,
    { execution: { notExecuted: true }, taskId: existingTaskId })
  if (isCanvasNodeRunActive(destination.projectId, nodeId)) throw new ApplicationPreflightFailure('此节点正在执行，请等待原节点完成；其他节点可以独立生成。')
  activeNodeTasks.set(key, taskId)
  try {
    return await registerCanvasGenerationTask(input, destination, nodeId, taskId, inputFingerprint, () => activeNodeTasks.delete(key))
  } catch (error) {
    activeNodeTasks.delete(key)
    throw error
  }
}

async function registerCanvasGenerationTask(input: GenerationPreparationInput, destination: CanvasDestination,
  nodeId: string, taskId: string, inputFingerprint: (store?: typeof useCanvasStore) => string, releaseNode: () => void) {
  const { model, fingerprint } = await (async () => {
    const fingerprint = inputFingerprint()
    await databaseService.init()
    if (await databaseService.getHistoryById(taskId)) throw new Error(`此任务已经登记，请查询原任务 ${taskId}。`)
    const model = registry.getModel(input.modelId)
    if (!model) throw new Error('生成模型不存在。')
    if (inputFingerprint() !== fingerprint) throw new Error('登记前节点输入已改变，请重新准备。')
    return { model, fingerprint }
  })().catch(error => { throw new ApplicationPreflightFailure(error) })
  const controller = new AbortController()
  const assertCurrent = (store?: typeof useCanvasStore): void => {
    controller.signal.throwIfAborted()
    if (inputFingerprint(store) !== fingerprint) throw new Error('节点输入已更改，请重新提交以核对生成参数和费用。')
  }
  const metadata = { version: 2, projectId: destination.projectId, nodeId }
  await databaseService.insertHistory({ id: taskId, modelId: input.modelId, providerId: model.meta.provider, type: input.mediaType,
    prompt: input.prompt, params: { ...input.options, [marker]: metadata }, filePath: null, taskId: null,
    status: 'pending', errorMessage: null, cost: null, duration: null })
  activeTasks.set(taskId, controller)
  const publish = (status: string, resultAvailable = false, errorMessage: string | null = null): void => publishCanvasGenerationTaskStatus({
    taskId, status, progress: resultAvailable ? 100 : 0, modelId: input.modelId, mediaType: input.mediaType,
    resultAvailable, errorCode: null, errorMessage, cancellable: ['pending', 'queued', 'generating'].includes(status) && !controller.signal.aborted,
  })
  publish('pending')
  const releaseExecutor = retainCanvasTaskExecutor(destination.projectId, nodeId, createGenerationNodeExecutor(store => {
    const profile = readCanvasGenerationNodeProfile(nodeId, store)
    const extra = profile.resultNodeExtraData
    return { ...profile, requestId: taskId, signal: controller.signal,
      resultNodeExtraData: data => ({ ...(typeof extra === 'function' ? extra(data) : extra), generationTaskId: taskId }) }
  }))
  logger.info('画布生成已创建节点与连线', { event: 'canvas.generationTask.start', taskId, projectId: destination.projectId, nodeId })
  void (async () => {
    await databaseService.updateHistory(taskId, { status: 'generating' })
    publish('generating')
    assertCurrent()
    const completed = await runCanvasNode(nodeId, assertCurrent)
    const snapshot = await readPersistedCanvasProjectSnapshot(destination.projectId)
    const index = new Map(snapshot.nodes.map(node => [node.id, node]))
    const outputs = snapshot.nodes.filter(node => completed.resultNodeIds.includes(node.id) && node.data.generationTaskId === taskId)
      .flatMap(node => getGraphNodeMediaOutputs(node, index))
    if (!outputs.length) throw new Error('生成结束但结果尚未保存，请在原画布检查。')
    await databaseService.updateHistory(taskId, { status: 'success', filePath: outputs[0].url })
    publish('success', true)
    logger.info('画布生成结果已保存', { event: 'canvas.generationTask.completed', taskId, nodeId })
  })().catch(async (error: unknown) => {
    const persisted = await readPersistedCanvasProjectSnapshot(destination.projectId).catch((readError: unknown) => {
      if (readError instanceof Error && readError.message === 'PROJECT_NOT_FOUND') return null
      throw readError
    })
    const completedOutputs = completedTaskOutputPaths(persisted?.nodes ?? [], taskId, nodeId)
    if (completedOutputs.length) {
      await databaseService.updateHistory(taskId, { status: 'success', filePath: completedOutputs.join('|||'), errorMessage: null })
      publish('success', true)
      logger.warn('生成结果已保存，后续执行信息未能完整发布', { event: 'canvas.generationTask.publication_incomplete', requestId: taskId,
        taskId, reason: error instanceof Error ? error.message : String(error) })
      return
    }
    if (controller.signal.aborted) logger.info('原画布任务已停止本地执行', { event: 'canvas.generationTask.cancelled', requestId: taskId, taskId })
    else logger.error('画布生成失败', error, { event: 'canvas.generationTask.failed', requestId: taskId, taskId })
    const canResume = persisted?.nodes.some(node => node.data.generationTaskId === taskId
      && readResumableServerTask(node.data as DynamicValueMap))
    const status = controller.signal.aborted ? 'cancelled' : canResume ? 'pending' : 'error'
    const message = controller.signal.aborted ? CANVAS_GENERATION_CANCELLED_MESSAGE
      : error instanceof Error ? error.message : '画布生成失败'
    publish(status, false, message)
    await databaseService.updateHistory(taskId, { status, errorMessage: message })
  }).catch(error => logger.error('画布生成状态保存失败', error, { event: 'canvas.generationTask.save_failed', taskId }))
    .finally(() => { activeTasks.delete(taskId); releaseExecutor(); releaseNode() })
  return { taskId, status: 'submitted', taskRef: { kind: 'generation.task', id: taskId },
    nodeRef: { kind: 'canvas.node', id: `${destination.projectId}:${nodeId}` },
    verification: { verified: true, condition: '生成节点、连线及任务已持久保存，后续进度在原画布中显示' } }
}

export async function getCanvasGenerationTask(taskId: string): Promise<Record<string, unknown> | null> {
  await databaseService.init()
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
  const resumable = resultNodes.flatMap(node => {
    const task = readResumableServerTask(node.data as DynamicValueMap)
    return task ? [task] : []
  })
  const hasActiveWork = activeTasks.has(taskId) || getCanvasResumeControllers(taskId).length > 0 || resumable.some(task =>
    isCanvasGenerationTaskActive(task.taskId) || hasCanvasGenerationResumeLease(projectId, task.taskId))
  let recordedStatus = normalizeGenerationTaskStatus(record.status)
  if (!hasActiveWork && savedResults.length > 0 && savedResults.every(node => node.data.generationCancelled === true && !node.data.isGenerating)
    && resultNodes.every(node => node.data.generationCancelled === true)
    && ['pending', 'queued', 'generating'].includes(recordedStatus ?? '')) {
    await databaseService.updateHistory(taskId, { status: 'cancelled', errorMessage: CANVAS_GENERATION_CANCELLED_MESSAGE })
    record.status = 'cancelled'; record.errorMessage = CANVAS_GENERATION_CANCELLED_MESSAGE; recordedStatus = 'cancelled'
  }
  // 已保存的本地失败用于任务对账；保留原供应商标识，不把续查失败解释为重新生成许可。
  const failedResults = savedResults.filter(node => !node.data.isGenerating && !node.data.generationCancelled
    && typeof node.data.generationError === 'string' && node.data.generationError.trim()
    && readResumableServerTask(node.data as DynamicValueMap))
  if (version === 2 && !hasActiveWork && ['pending', 'queued', 'generating'].includes(recordedStatus ?? '')
    && failedResults.length > 0 && failedResults.length === savedResults.length
    && resultNodes.every(node => !node.data.isGenerating && savedResults.some(saved => saved.id === node.id
      && saved.data.generationError === node.data.generationError))) {
    const errorMessage = [...new Set(failedResults.map(node => String(node.data.generationError)))].join('\n')
    await databaseService.updateHistory(taskId, { status: 'error', errorMessage })
    record.status = 'error'; record.errorMessage = errorMessage; recordedStatus = 'error'
  }
  // 仅从本任务带身份的、完整持久化的原子输出修复历史。旧无身份结果不能冒认。
  const completedOutputs = version === 2 ? completedTaskOutputPaths(savedNodes, taskId, nodeId) : []
  if (!hasActiveWork && ['pending', 'queued', 'generating', 'error', 'timeout'].includes(recordedStatus ?? '') && completedOutputs.length > 0) {
    const filePath = completedOutputs.join('|||')
    await databaseService.updateHistory(taskId, { status: 'success', filePath, errorMessage: null })
    record.status = 'success'; record.filePath = filePath; record.errorMessage = null
    recordedStatus = 'success'
    logger.info('原画布任务已按保存结果对账', { event: 'canvas.generationTask.reconciled', taskId, projectId, nodeId })
  }
  const resultAvailable = recordedStatus === 'success' && Boolean(record.filePath)
  const waitingExternal = !resultAvailable && hasActiveWork
  const status = resultAvailable ? 'success' : waitingExternal ? 'generating'
    : recordedStatus === 'error' || recordedStatus === 'timeout' || recordedStatus === 'cancelled' ? recordedStatus
      : resumable.length ? 'pending' : 'error'
  const progressState = useCanvasGenerationProgressStore.getState()
  const progress = status === 'success' ? 100 : Math.max(0, ...resultNodes.map(item => (progressState.progress[item.id] ?? 0) * 100))
  const errorCode = status === 'error' && !record.errorMessage ? 'GENERATION_OUTCOME_UNKNOWN' : null
  const errorMessage = status === 'error' || status === 'timeout' || status === 'cancelled'
    ? record.errorMessage ?? '原画布任务的执行结果尚未核实；当前没有活动执行，不能据此重新提交生成。'
    : status === 'pending' ? '原供应商任务已登记，等待续查；不会重新提交生成。' : null
  const controllers = [activeTasks.get(taskId), ...getCanvasResumeControllers(taskId)].filter((value): value is AbortController => Boolean(value))
  const cancellable = !resultAvailable && controllers.some(controller => !controller.signal.aborted)
  publishCanvasGenerationTaskStatus({ taskId, status, progress, modelId: record.modelId, mediaType: record.type,
    resultAvailable, cancellable, waitingExternal, errorCode, errorMessage })
  return { taskId, status, normalizedStatus: status, progress, modelId: record.modelId, mediaType: record.type,
    resultAvailable, cancellable, waitingExternal, errorCode, errorMessage,
    resumeInput: !resultAvailable && resumable.length > 0 ? {
      taskId, projectId, sourceNodeId: nodeId, resultNodeIds: resultNodes.map(node => node.id),
    } satisfies CanvasGenerationResumeInput : null,
    taskRef: { kind: 'generation.task', id: taskId }, nodeRef: { kind: 'canvas.node', id: `${projectId}:${nodeId}` },
    resultRefs: resultNodes.map(item => ({ kind: 'canvas.node', id: `${projectId}:${item.id}` })) }
}

/** 停止本地执行；取消回执不冒充供应商端撤销或费用退回。 */
export async function cancelCanvasGenerationTask(taskId: string): Promise<Record<string, unknown> | null> {
  const task = await getCanvasGenerationTask(taskId)
  if (!task) return null
  if (task.resultAvailable || task.status === 'cancelled') return { taskId, status: task.status }
  const controllers = [activeTasks.get(taskId), ...getCanvasResumeControllers(taskId)].filter((value): value is AbortController => Boolean(value))
  if (!controllers.length) throw new CanvasApplicationError('INVALID_INPUT', '原画布任务当前没有可停止的本地执行。', true, { execution: { notExecuted: true } })
  controllers.forEach(controller => controller.abort(new Error('本地任务已停止')))
  logger.info('已请求停止原画布任务', { event: 'canvas.generationTask.cancel_requested', requestId: taskId, taskId })
  return { taskId, status: 'cancelling' }
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
    started = await resumeCanvasGenerationInProject(input.projectId, selected)
    if (started && ['cancelled', 'error', 'timeout'].includes(String(task.status))) await databaseService.updateHistory(input.taskId, { status: 'pending', errorMessage: null })
  }
  const current = await getCanvasGenerationTask(input.taskId)
  if (!current) throw new Error('恢复期间原任务已不存在。')
  if (!started && !current.waitingExternal && !current.resultAvailable) return reject('原任务未能开始续查，请检查原结果节点。')
  return { taskId: input.taskId, status: String(current.status), task: current }
}
