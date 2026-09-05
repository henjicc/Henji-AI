import type { ApplicationRef } from '@/core/application-control'
import { createLogger } from '@/core/logging'
import { useCanvasStore } from '@/stores/canvasStore'
import { useProjectStore } from '@/stores/projectStore'
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
}

export interface RetryLayerStackResultResult {
  nodeRef: ApplicationRef & { kind: 'canvas.node' }
  status: 'retrieving' | 'already_retrieving'
  resultRefs: Array<ApplicationRef & { kind: 'canvas.node' }>
}

/** 同步原子启用现有续查 hook；不提交模型生成，不回退工程历史，也不改变其他节点。 */
export function retryLayerStackResult(input: RetryLayerStackResultInput): RetryLayerStackResultResult {
  const context = { projectId: input.projectId, nodeId: input.nodeId, ...input.correlation }
  logger.info('重新获取多图层图片开始', { event: 'canvas.layer_stack.retrieve.start', ...context })
  try {
    if (input.signal?.aborted) throw new CanvasApplicationError('ABORTED', '重新获取结果已取消')
    const project = useProjectStore.getState()
    if (project.currentProjectId !== input.projectId || project.currentProject?.id !== input.projectId) {
      throw new CanvasApplicationError('STALE_CONTEXT', `请先打开画布项目 ${input.projectId}，再重新获取它的多图层结果。`)
    }
    const canvas = useCanvasStore.getState()
    const node = canvas.nodes.find((candidate) => candidate.id === input.nodeId)
    if (!node || node.type !== 'layerStackResultNode') {
      throw new CanvasApplicationError('NOT_FOUND', '目标不是当前工程中的多图层结果节点，请重新读取画布节点引用。')
    }
    const nodeRef = { kind: 'canvas.node' as const, id: `${input.projectId}:${node.id}` }
    if (node.data.resultKind === 'layer-stack' && !hasLayerStackRecoveryResult(node.data)
      && node.data.isGenerating && !node.data.generationError && readResumableServerTask(node.data)) {
      logger.info('多图层结果正在获取', { event: 'canvas.layer_stack.retrieve.completed', status: 'already_retrieving', ...context })
      return { nodeRef, status: 'already_retrieving', resultRefs: [nodeRef] }
    }
    const task = resolveLayerStackRecoveryTask(node, canvas.history)
    if (!task) {
      throw new CanvasApplicationError('CAPABILITY_REJECTED',
        '该节点没有可安全续取的下载失败任务。请检查节点状态；已经完成、已取消、生成失败或来源已变化的结果不能重新获取。')
    }
    canvas.updateNodeData(node.id, {
      serverTaskId: task.taskId,
      serverTaskModelId: task.modelId,
      generationError: null,
      isGenerating: true,
    })
    logger.info('多图层结果已进入续取', {
      event: 'canvas.layer_stack.retrieve.completed', taskId: task.taskId, modelId: task.modelId, ...context,
    })
    return { nodeRef, status: 'retrieving', resultRefs: [nodeRef] }
  } catch (error) {
    logger.error('重新获取多图层图片失败', error, { event: 'canvas.layer_stack.retrieve.failed', ...context })
    throw error
  }
}
