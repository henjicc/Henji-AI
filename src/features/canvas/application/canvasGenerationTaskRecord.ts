import { createLogger } from '@/core/logging'
import { registry } from '@/core/ModelRegistry'
import { databaseService } from '@/services/database/DatabaseService'
import type { GenerationPreparationInput } from '@/features/generation/application/generationPreparationService'
import { publishCanvasGenerationTaskStatus } from '@/features/generation/application/generationTaskStatusRegistry'
import type { CanvasNode } from '../domain/canvasNodes'
import { CANVAS_GENERATION_CANCELLED_MESSAGE } from '../domain/generationFailure'
import { readResumableServerTask } from '../domain/resumableTask'
import { readPersistedCanvasProjectSnapshot } from './canvasQueryService'
import { getGraphNodeMediaOutputs } from './graphOutputResolver'
import type { CanvasNodeExecutionResult } from './canvasExecutionContracts'

const logger = createLogger('features.canvas.generationTask')
export const canvasGenerationTaskControls = new Map<string, AbortController>()
export const canvasGenerationNodeTasks = new Map<string, string>()
export const CANVAS_GENERATION_TASK_MARKER = '__canvasGeneration'

export function completedTaskOutputPaths(nodes: CanvasNode[], taskId: string, nodeId: string): string[] {
  const owned = nodes.filter(node => node.data.generationTaskId === taskId && node.data.generationSourceNodeId === nodeId)
  if (!owned.length || owned.some(node => node.data.isGenerating === true || node.data.generationError
    || typeof node.data.generationOutputCommitId !== 'string')) return []
  const index = new Map(nodes.map(node => [node.id, node]))
  const outputs = owned.flatMap(node => getGraphNodeMediaOutputs(node, index))
  return outputs.length >= owned.length ? outputs.map(output => output.url) : []
}

/** UI 和助手共用登记、取消与持久结果对账；不负责启动或重放执行图。 */
export async function createCanvasGenerationTaskRecord(input: GenerationPreparationInput, projectId: string, nodeId: string,
  taskId: string, controller: AbortController) {
  const nodeKey = `${projectId}:${nodeId}`
  const existing = canvasGenerationNodeTasks.get(nodeKey)
  if (existing && existing !== taskId) throw new Error(`此节点已有任务 ${existing}，请查询原任务；其他节点可以独立生成。`)
  canvasGenerationNodeTasks.set(nodeKey, taskId)
  try {
    await databaseService.init()
    if (await databaseService.getHistoryById(taskId)) throw new Error(`此任务已经登记，请查询原任务 ${taskId}。`)
    const model = registry.getModel(input.modelId)
    if (!model) throw new Error('生成模型不存在。')
    await databaseService.insertHistory({ id: taskId, modelId: input.modelId, providerId: model.meta.provider, type: input.mediaType,
      prompt: input.prompt, params: { ...input.options, [CANVAS_GENERATION_TASK_MARKER]: { version: 2, projectId, nodeId } },
      filePath: null, taskId: null, status: 'pending', errorMessage: null, cost: null, duration: null })
  } catch (error) {
    if (canvasGenerationNodeTasks.get(nodeKey) === taskId) canvasGenerationNodeTasks.delete(nodeKey)
    throw error
  }
  canvasGenerationTaskControls.set(taskId, controller)
  logger.info('画布生成任务已登记', { event: 'canvas.generationTask.registered', requestId: taskId, taskId, projectId, nodeId })
  const publish = (status: string, resultAvailable = false, errorMessage: string | null = null) => publishCanvasGenerationTaskStatus({
    taskId, status, progress: resultAvailable ? 100 : 0, modelId: input.modelId, mediaType: input.mediaType,
    resultAvailable, errorCode: null, errorMessage, cancellable: ['pending', 'queued', 'generating'].includes(status) && !controller.signal.aborted,
  })
  publish('pending')
  return {
    async run(execute: () => Promise<{ resultNodeIds: string[] }>): Promise<CanvasNodeExecutionResult> {
      try {
        await databaseService.updateHistory(taskId, { status: 'generating' })
        publish('generating')
        controller.signal.throwIfAborted()
        const completed = await execute()
        const snapshot = await readPersistedCanvasProjectSnapshot(projectId)
        const outputs = completedTaskOutputPaths(snapshot.nodes, taskId, nodeId)
        if (!outputs.length) throw new Error('生成结束但结果尚未保存，请在原画布检查。')
        await databaseService.updateHistory(taskId, { status: 'success', filePath: outputs.join('|||'), errorMessage: null })
        publish('success', true)
        logger.info('画布生成结果已保存', { event: 'canvas.generationTask.completed', taskId, nodeId })
        return { status: 'completed', resultNodeIds: completed.resultNodeIds }
      } catch (error) {
        const persisted = await readPersistedCanvasProjectSnapshot(projectId).catch((readError: unknown) => {
          if (readError instanceof Error && readError.message === 'PROJECT_NOT_FOUND') return null
          throw readError
        })
        const outputs = completedTaskOutputPaths(persisted?.nodes ?? [], taskId, nodeId)
        if (outputs.length) {
          await databaseService.updateHistory(taskId, { status: 'success', filePath: outputs.join('|||'), errorMessage: null })
          publish('success', true)
          logger.warn('生成结果已保存，后续执行信息未能完整发布', { event: 'canvas.generationTask.publication_incomplete', requestId: taskId, taskId,
            reason: error instanceof Error ? error.message : String(error) })
          return { status: 'completed', resultNodeIds: (persisted?.nodes ?? []).filter(node => node.data.generationTaskId === taskId).map(node => node.id) }
        }
        const canResume = persisted?.nodes.some(node => node.data.generationTaskId === taskId && readResumableServerTask(node.data as DynamicValueMap))
        const status = controller.signal.aborted ? 'cancelled' : canResume ? 'pending' : 'error'
        const message = controller.signal.aborted ? CANVAS_GENERATION_CANCELLED_MESSAGE : error instanceof Error ? error.message : '画布生成失败'
        await databaseService.updateHistory(taskId, { status, errorMessage: message })
        publish(status, false, message)
        if (controller.signal.aborted) logger.info('原画布任务已停止本地执行', { event: 'canvas.generationTask.cancelled', requestId: taskId, taskId })
        else logger.error('画布生成失败', error, { event: 'canvas.generationTask.failed', requestId: taskId, taskId })
        throw error
      } finally {
        canvasGenerationTaskControls.delete(taskId)
        if (canvasGenerationNodeTasks.get(nodeKey) === taskId) canvasGenerationNodeTasks.delete(nodeKey)
      }
    },
  }
}
