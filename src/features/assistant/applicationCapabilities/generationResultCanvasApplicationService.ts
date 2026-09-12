import type { CanvasNodePlacement } from '@/core/assistant/capabilities/canvasMutationApplicationCapabilities'
import {
  mediaSourceNodeData,
  mediaSourceNodeType,
  type CanvasMediaSourcePayload,
} from '@/features/canvas/application/assetMediaAssignment'
import { addTrustedMediaCanvasNode } from '@/features/canvas/application/canvasApplicationService'
import { withCanvasProjectRuntime } from '@/features/canvas/application/canvasProjectRuntime'
import { runCanvasTransaction } from '@/features/canvas/application/canvasBatchService'
import { readPersistedCanvasProjectSnapshot } from '@/features/canvas/application/canvasQueryService'
import { getVisibleGenerationTaskResult } from '@/workspaces/GenerationWorkspace/application/visibleGenerationTaskCommand'

/**
 * 组合生成与画布两个领域的窄桥梁。模型只传稳定 generation.result 引用；媒体路径由宿主内部
 * 解析并直接交给可信画布导入入口，既不要求先伪装成素材，也不向工具结果泄漏路径。
 */
export async function addGenerationResultToCanvas(input: {
  projectId: string
  resultRef: { kind: 'generation.result'; id: string }
  placement: CanvasNodePlacement
}): Promise<Record<string, unknown>> {
  const result = getVisibleGenerationTaskResult(input.resultRef.id)
  if (!result) throw new Error('GENERATION_RESULT_NOT_AVAILABLE')

  const payload: CanvasMediaSourcePayload = {
    type: result.mediaType,
    sourceType: 'history',
    imageUrl: result.url,
    filePath: result.filePath ?? result.url,
    displayName: result.prompt,
  }
  const transaction = await withCanvasProjectRuntime(input.projectId, (runtime) => runCanvasTransaction(input.projectId, 1, async (options) => [await addTrustedMediaCanvasNode({
    projectId: input.projectId,
    nodeType: mediaSourceNodeType(result.mediaType),
    placement: input.placement,
    data: mediaSourceNodeData(payload),
  }, options)], {}, runtime))
  const created = transaction.appliedOperations[0]
  const persisted = await readPersistedCanvasProjectSnapshot(input.projectId)
  const verified = persisted.nodes.some((node) => node.id === created.nodeId)
  return {
    ...created,
    resultRef: input.resultRef,
    mediaType: result.mediaType,
    nodeRef: { kind: 'canvas.node', id: `${input.projectId}:${String(created.nodeId)}` },
    verification: { verified, condition: '原画布中的新增结果节点已回读确认' },
  }
}
