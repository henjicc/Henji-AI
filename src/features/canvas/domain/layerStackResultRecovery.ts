import type { CanvasNodeData } from './canvasNodes'
import { readResumableServerTask, type ResumableServerTask } from './resumableTask'
import { isLayerStackDownloadFailure } from './generationFailure'

export interface LayerStackRecoveryNode {
  id: string
  data: CanvasNodeData
}

export interface LayerStackRecoveryHistory {
  past: ReadonlyArray<{ nodes: ReadonlyArray<LayerStackRecoveryNode> }>
}

export function hasLayerStackRecoveryResult(data: CanvasNodeData): boolean {
  return Boolean(data.imageUrl || data.previewImageUrl || data.layerStackDocument || data.imageEditSession)
}

const IDENTITY_FIELDS = [
  'generationInputSignature', 'generationSourceNodeId', 'generationProviderId',
  'sourceCapabilityId',
] as const

function sameGeneration(current: CanvasNodeData, previous: CanvasNodeData): boolean {
  return previous.resultKind === 'layer-stack'
    && IDENTITY_FIELDS.every((key) => (
      typeof current[key] === 'string' && current[key].length > 0 && current[key] === previous[key]
    ))
    && JSON.stringify(current.generationInputImages) === JSON.stringify(previous.generationInputImages)
}

export function resolveLayerStackRecoveryTask(
  node: LayerStackRecoveryNode,
  history: LayerStackRecoveryHistory,
): ResumableServerTask | null {
  if (node.data.isGenerating || hasLayerStackRecoveryResult(node.data) || !isLayerStackDownloadFailure(node.data)) return null
  const current = readResumableServerTask(node.data)
  if (current) return current

  // 历史仅用于兼容旧版下载失败清空任务号的节点。跨越节点创建/输入变更边界立即停止。
  for (let index = history.past.length - 1; index >= 0; index -= 1) {
    const previous = history.past[index]?.nodes.find((candidate) => candidate.id === node.id)
    if (!previous || !sameGeneration(node.data, previous.data) || hasLayerStackRecoveryResult(previous.data)) return null
    const task = readResumableServerTask(previous.data)
    if (!task) continue
    const legacyError = node.data.generationError
    if (typeof legacyError === 'string' && legacyError.startsWith('Continue polling failed for ')
      && legacyError !== `Continue polling failed for ${task.modelId}: terminated`) return null
    // 仅从确实运行过且尚未交付的快照恢复，不从更早失败任务跳回。
    return previous.data.isGenerating === true && !previous.data.generationError ? task : null
  }
  return null
}

export function canRetryLayerStackResult(
  node: LayerStackRecoveryNode,
  history: LayerStackRecoveryHistory,
): boolean {
  return resolveLayerStackRecoveryTask(node, history) !== null
}
