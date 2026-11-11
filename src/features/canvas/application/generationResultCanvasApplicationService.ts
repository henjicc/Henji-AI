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
import { generatedMediaName } from '@/core/documents/generatedMediaName'

/**
 * 组合生成与画布两个领域的窄桥梁。模型只传稳定 generation.result 引用；媒体路径由宿主内部
 * 解析并直接交给可信画布导入入口，既不要求先伪装成素材，也不向工具结果泄漏路径。
 */
/** 页面内存里的生成任务结果：与历史记录同一约定，没指定第几个时取最后一个。 */
function visibleTaskResultMedia(taskId: string, outputIndex?: number): { mediaType: 'image' | 'video' | 'audio'; url: string; filePath: string | undefined; prompt: string } | null {
  const task = getVisibleGenerationTaskResult(taskId)
  const index = outputIndex ?? -1
  const url = task?.urls.at(index)
  if (!task || !url) return null
  return { mediaType: task.mediaType, url, filePath: task.filePaths.at(index), prompt: task.prompt }
}

type ResultRef = { kind: 'generation.result' | 'image_edit.preview'; id: string }

async function readCanvasResultMedia(resultRef: ResultRef, outputIndex: number | undefined): Promise<{ mediaType: 'image' | 'video' | 'audio'; url: string; filePath: string | undefined; prompt: string }> {
  if (resultRef.kind === 'image_edit.preview') {
    return { mediaType: 'image', url: await materializeImageEditPreview(resultRef.id), filePath: undefined, prompt: '编辑结果' }
  }
  const saved = await readGenerationResultMedia(resultRef.id, undefined, outputIndex === undefined ? undefined : { outputIndex })
  const result = saved ? { mediaType: saved.mediaType, url: saved.source, filePath: saved.source, prompt: saved.prompt } : visibleTaskResultMedia(resultRef.id, outputIndex)
  if (!result) throw new Error('GENERATION_RESULT_NOT_AVAILABLE')
  return result
}

function mediaNodeInput(projectId: string, result: Awaited<ReturnType<typeof readCanvasResultMedia>>, placement: CanvasNodePlacement): Parameters<typeof addTrustedMediaCanvasNode>[0] {
  const payload: CanvasMediaSourcePayload = {
    type: result.mediaType,
    sourceType: 'history',
    imageUrl: result.url,
    filePath: result.filePath ?? result.url,
    displayName: generatedMediaName(result.prompt),
  }
  return { projectId, nodeType: mediaSourceNodeType(result.mediaType), placement, data: mediaSourceNodeData(payload) }
}

function defaultPlacement(projectId: string): CanvasNodePlacement {
  const selectedNodeId = useProjectStore.getState().currentProjectId === projectId
    ? useCanvasStore.getState().selectedNodeId : null
  return selectedNodeId
    ? { mode: 'right_of_node', anchorNodeId: selectedNodeId }
    : { mode: 'viewport_center' }
}

/**
 * 一次放入多个生成结果：同一个画布事务、一次撤销。第一个落在默认位置，其余依次排在前一个右侧，
 * 新节点之间与已有节点都由布局避让，不叠在一起。
 */
export async function addGenerationResultsToCanvas(input: {
  projectId: string
  results: ReadonlyArray<{ recordId: string; outputIndex: number }>
}): Promise<{ nodeIds: string[]; undoRef: string }> {
  const media: Array<Awaited<ReturnType<typeof readCanvasResultMedia>>> = []
  for (const result of input.results) media.push(await readCanvasResultMedia({ kind: 'generation.result', id: result.recordId }, result.outputIndex))
  const transaction = await withCanvasProjectRuntime(input.projectId, (runtime) => runCanvasTransaction(input.projectId, media.length, async (options) => {
    const created: Record<string, unknown>[] = []
    for (const result of media) {
      const previous = created.at(-1)?.nodeId
      const placement: CanvasNodePlacement = typeof previous === 'string'
        ? { mode: 'right_of_node', anchorNodeId: previous }
        : defaultPlacement(input.projectId)
      created.push(await addTrustedMediaCanvasNode(mediaNodeInput(input.projectId, result, placement), options))
    }
    return created
  }, { source: 'generation_batch' }, runtime))
  return { nodeIds: transaction.appliedOperations.map(operation => String(operation.nodeId)), undoRef: transaction.undoRef }
}

export async function addGenerationResultToCanvas(input: {
  projectId: string
  resultRef: ResultRef
  outputIndex?: number
  placement?: CanvasNodePlacement
}): Promise<Record<string, unknown>> {
  const result = await readCanvasResultMedia(input.resultRef, input.outputIndex)
  const placement = input.placement ?? defaultPlacement(input.projectId)
  const transaction = await withCanvasProjectRuntime(input.projectId, (runtime) => runCanvasTransaction(input.projectId, 1, async (options) => [
    await addTrustedMediaCanvasNode(mediaNodeInput(input.projectId, result, placement), options),
  ], {}, runtime))
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
