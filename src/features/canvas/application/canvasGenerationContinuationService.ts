import { CONTINUATION_PARAM } from '@henjicc/ai-sdk'

import i18n from '@/i18n'
import { createLogger } from '@/core/logging'
import { registry } from '@/core/ModelRegistry'
import { listGenerationContinuations, prepareGenerationContinuation, type AvailableGenerationContinuation } from '@/core/services/generationContinuations'
import type { CanvasNode } from '../domain/canvasNodes'
import { CANVAS_NODE_TYPES } from '../domain/canvasNodeConstants'
import { CanvasApplicationError } from './canvasApplicationError'
import { reportCanvasOperationFailure } from './canvasOperationFeedback'
import { addControlledCanvasNode } from './canvasApplicationService'
import { runCanvasNode } from './canvasExecutionService'
import { selectCanvasNode } from './canvasMutationService'
import { getCanvasProjectInstance } from './canvasProjectInstances'

const logger = createLogger('features.canvas.application.canvasGenerationContinuationService')

const GENERATION_NODE_TYPE = {
  image: CANVAS_NODE_TYPES.imageEdit,
  video: CANVAS_NODE_TYPES.videoGen,
  audio: CANVAS_NODE_TYPES.audioGen,
} as const

/** 画布结果节点现在能做的续接。 */
export function listCanvasNodeContinuations(node: Pick<CanvasNode, 'data'>): AvailableGenerationContinuation[] {
  const source = node.data.generationContinuation
  // 生成中、失败或取消的节点没有可用结果，不给续接入口。
  if (!source || node.data.isGenerating || node.data.generationError || node.data.generationCancelled) return []
  return listGenerationContinuations(source.modelId, source.params)
}

/**
 * 在结果旁边建一个续接生成节点：模型、参数与续接引用都已填好。
 * 参数齐全的（草稿转正片）直接运行；要补写的（续写、做成视频）选中它，由用户或助手补完再运行。
 * 媒体输入不随参数带过去，续接靠平台引用，不靠重新上传结果。
 */
export async function continueCanvasGenerationResult(input: {
  projectId: string
  nodeId: string
  continuationId: string
  /** 助手补写的提示词；省略时沿用源提示词 */
  prompt?: string
}): Promise<{ projectId: string; nodeId: string; continuationId: string; started: boolean }> {
  const instance = await getCanvasProjectInstance(input.projectId)
  const node = instance.store.getState().nodes.find(item => item.id === input.nodeId)
  if (!node) throw new CanvasApplicationError('NOT_FOUND', '画布结果节点不存在', true, { nodeId: input.nodeId })
  const source = node.data.generationContinuation
  const prepared = source ? prepareGenerationContinuation(source.modelId, source.params, input.continuationId) : null
  const target = prepared ? registry.getModel(prepared.targetModelId) : undefined
  if (!prepared || !target) throw new CanvasApplicationError('INVALID_INPUT', '这个结果不能做这个续接', true, { nodeId: input.nodeId, continuationId: input.continuationId })
  const nodeType = GENERATION_NODE_TYPE[target.meta.type as keyof typeof GENERATION_NODE_TYPE]
  if (!nodeType) throw new CanvasApplicationError('INVALID_INPUT', '续接目标模型没有对应的画布生成节点', true, { modelId: target.meta.id })

  // 生成节点只收目标模型声明过的参数，外加续接引用。
  const declared = new Set(target.params.map(param => param.id))
  const params = Object.fromEntries(Object.entries(prepared.params).filter(([key]) => declared.has(key) || key === CONTINUATION_PARAM))
  const sourcePrompt = typeof prepared.params.prompt === 'string' ? prepared.params.prompt : ''
  const created = await addControlledCanvasNode({
    projectId: input.projectId,
    nodeType,
    placement: { mode: 'right_of_node', anchorNodeId: input.nodeId },
    // 标题写明续接动作，让人一眼看出这个节点是接着哪个结果做的。
    data: { displayName: i18n.t(`ui:workspace.continuation.action.${prepared.id}`), modelId: prepared.targetModelId, params, prompt: input.prompt ?? sourcePrompt },
  })
  const nodeId = String(created.nodeId)
  const start = prepared.submit === 'direct' || input.prompt !== undefined
  if (start) {
    void runCanvasNode(nodeId, undefined, input.projectId).catch((error) => {
      logger.warn('续接节点运行失败', { event: 'canvas.continuation.run_failed', context: { nodeId, continuationId: input.continuationId }, error })
      reportCanvasOperationFailure(error)
    })
  }
  else selectCanvasNode(input.projectId, nodeId)
  return { projectId: input.projectId, nodeId, continuationId: input.continuationId, started: start }
}
