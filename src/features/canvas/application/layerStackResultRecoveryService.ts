import type { ApplicationRef } from '@/core/application-control'
import { createLogger } from '@/core/logging'
import { applicationWritePreflight, type ApplicationWriteExecution } from '@/core/application-control/execution/writeExecution'
import { acquireCanvasProjectRuntime } from './canvasProjectRuntime'
import { resumeCanvasGenerationInProject } from './canvasResumePollingService'
import { readResumableServerTask } from '../domain/resumableTask'
import { hasLayerStackRecoveryResult, resolveLayerStackRecoveryTask } from '../domain/layerStackResultRecovery'
import { CanvasApplicationError } from './canvasApplicationService'

export { canRetryLayerStackResult } from '../domain/layerStackResultRecovery'

const logger = createLogger('features.canvas.layer_stack_result_recovery')

export interface RetryLayerStackResultInput {
  projectId: string
  nodeId: string
  signal?: AbortSignal
  correlation?: { requestId?: string; taskId?: string }
  execution?: ApplicationWriteExecution
}

export interface RetryLayerStackResultResult {
  nodeRef: ApplicationRef & { kind: 'canvas.node' }
  status: 'retrieving' | 'already_retrieving'
  resultRefs: Array<ApplicationRef & { kind: 'canvas.node' }>
  verification: { verified: boolean; condition: string }
}

/** 租用原文档并显式启动正式后台续查；不依赖活动画布或组件 hook。 */
export async function retryLayerStackResult(input: RetryLayerStackResultInput): Promise<RetryLayerStackResultResult> {
  const context = { projectId: input.projectId, nodeId: input.nodeId, ...input.correlation }
  logger.info('重新获取多图层图片开始', { event: 'canvas.layer_stack.retrieve.start', ...context })
  const owned = await applicationWritePreflight(input, async () => {
    if (input.signal?.aborted) throw new CanvasApplicationError('ABORTED', '重新获取结果已取消')
    return acquireCanvasProjectRuntime(input.projectId)
  })
  try {
    const { canvas, node, task } = await applicationWritePreflight(input, () => {
    input.signal?.throwIfAborted()
    const canvas = owned.runtime.store.getState()
    const node = canvas.nodes.find((candidate) => candidate.id === input.nodeId)
    if (!node || node.type !== 'layerStackResultNode') {
      throw new CanvasApplicationError('NOT_FOUND', '目标不是当前画布中的多图层结果节点，请重新读取画布节点引用。')
    }
    const retrieving = node.data.resultKind === 'layer-stack' && !hasLayerStackRecoveryResult(node.data)
      && node.data.isGenerating && !node.data.generationError
    const task = retrieving ? readResumableServerTask(node.data) : resolveLayerStackRecoveryTask(node, canvas.history)
    if (!task) throw new CanvasApplicationError('CAPABILITY_REJECTED',
      '该节点没有可安全续取的下载失败任务。请检查节点状态；已经完成、已取消、生成失败或来源已变化的结果不能重新获取。')
    return { canvas, node, task }
    })
    const nodeRef = { kind: 'canvas.node' as const, id: `${input.projectId}:${node.id}` }
    if (node.data.resultKind === 'layer-stack' && !hasLayerStackRecoveryResult(node.data)
      && node.data.isGenerating && !node.data.generationError && readResumableServerTask(node.data)) {
      logger.info('多图层结果正在获取', { event: 'canvas.layer_stack.retrieve.completed', status: 'already_retrieving', ...context })
      await resumeCanvasGenerationInProject(input.projectId, new Set([node.id]))
      return { nodeRef, status: 'already_retrieving', resultRefs: [nodeRef], verification: { verified: true, condition: '原节点已有续取状态，正式后台续查入口已接受。' } }
    }
    canvas.updateNodeData(node.id, {
      serverTaskId: task.taskId,
      serverTaskModelId: task.modelId,
      generationError: null,
      isGenerating: true,
    })
    input.execution?.report({ targetMutation: 'applied' })
    await owned.runtime.persist()
    await resumeCanvasGenerationInProject(input.projectId, new Set([node.id]))
    logger.info('多图层结果已进入续取', {
      event: 'canvas.layer_stack.retrieve.completed', taskId: task.taskId, modelId: task.modelId, ...context,
    })
    const current = owned.runtime.store.getState().nodes.find(item => item.id === node.id)
    return { nodeRef, status: 'retrieving', resultRefs: [nodeRef], verification: { verified: Boolean(current && (current.data.isGenerating || hasLayerStackRecoveryResult(current.data))), condition: '回读原节点确认已进入续取或取得结果。' } }
  } catch (error) {
    logger.error('重新获取多图层图片失败', error, { event: 'canvas.layer_stack.retrieve.failed', ...context })
    throw error
  } finally { owned.release() }
}
