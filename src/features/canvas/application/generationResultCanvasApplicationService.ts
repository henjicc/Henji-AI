import type { CanvasNodePlacement } from '@/core/application-control/domains/canvas/canvasMutationApplicationCapabilities'
import { mediaSourceNodeData, mediaSourceNodeType, type CanvasMediaSourcePayload } from '@/features/canvas/application/assetMediaAssignment'
import { addTrustedMediaCanvasNode } from '@/features/canvas/application/canvasApplicationService'
import { withCanvasProjectRuntime } from '@/features/canvas/application/canvasProjectRuntime'
import { runCanvasTransaction } from '@/features/canvas/application/canvasBatchService'
import { readPersistedCanvasProjectSnapshot } from '@/features/canvas/application/canvasQueryService'
import { getVisibleGenerationTaskResult } from '@/workspaces/GenerationWorkspace/application/visibleGenerationTaskCommand'
import { useProjectStore } from '@/stores/projectStore'
import { useCanvasStore } from '@/stores/canvasStore'
import { materializeImageEditPreview } from '@/features/imageEdit/application/imageEditApplicationService'
import { readGenerationResultMedia } from '@/features/generation/application/generationResultSource'

/**
 * 组合生成与画布两个领域的窄桥梁。模型只传稳定 generation.result 引用；媒体路径由宿主内部
 * 解析并直接交给可信画布导入入口，既不要求先伪装成素材，也不向工具结果泄漏路径。
 */
/** 页面内存里的生成任务结果：与历史记录同一约定，多个结果取最后一个。 */
function visibleTaskResultMedia(taskId: string): { mediaType: 'image' | 'video' | 'audio'; url: string; filePath: string | undefined; prompt: string } | null {
  const task = getVisibleGenerationTaskResult(taskId)
  const url = task?.urls.at(-1)
  if (!task || !url) return null
  return { mediaType: task.mediaType, url, filePath: task.filePaths.at(-1), prompt: task.prompt }
}

export async function addGenerationResultToCanvas(input: {
  projectId: string
  resultRef: { kind: 'generation.result' | 'image_edit.preview'; id: string }
  placement?: CanvasNodePlacement
}): Promise<Record<string, unknown>> {
  const saved = input.resultRef.kind === 'generation.result' ? await readGenerationResultMedia(input.resultRef.id) : null
  const result = input.resultRef.kind === 'image_edit.preview'
    ? { mediaType: 'image' as const, url: await materializeImageEditPreview(input.resultRef.id), filePath: undefined, prompt: '编辑结果' }
    : saved ? { mediaType: saved.mediaType, url: saved.source, filePath: saved.source, prompt: saved.name }
      : visibleTaskResultMedia(input.resultRef.id)
  if (!result) throw new Error('GENERATION_RESULT_NOT_AVAILABLE')

  const payload: CanvasMediaSourcePayload = {
    type: result.mediaType,
    sourceType: 'history',
    imageUrl: result.url,
    filePath: result.filePath ?? result.url,
    displayName: result.prompt.trim().replace(/\s+/g, ' ').slice(0, 120) || '生成结果',
  }
  const selectedNodeId = useProjectStore.getState().currentProjectId === input.projectId
    ? useCanvasStore.getState().selectedNodeId : null
  const placement = input.placement ?? (selectedNodeId
    ? { mode: 'right_of_node' as const, anchorNodeId: selectedNodeId }
    : { mode: 'viewport_center' as const })
  const transaction = await withCanvasProjectRuntime(input.projectId, (runtime) => runCanvasTransaction(input.projectId, 1, async (options) => [await addTrustedMediaCanvasNode({
    projectId: input.projectId,
    nodeType: mediaSourceNodeType(result.mediaType),
    placement,
    data: mediaSourceNodeData(payload),
  }, options)], {}, runtime))
  const created = transaction.appliedOperations[0]
  const persisted = await readPersistedCanvasProjectSnapshot(input.projectId)
  const verified = persisted.nodes.some((node) => node.id === created.nodeId)
  return {
    ...created,
    undoRef: transaction.undoRef,
    resultRef: input.resultRef,
    mediaType: result.mediaType,
    nodeRef: { kind: 'canvas.node', id: `${input.projectId}:${String(created.nodeId)}` },
    verification: { verified, condition: '原画布中的新增结果节点已回读确认' },
  }
}
