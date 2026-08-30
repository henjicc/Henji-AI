import type { CanvasNodeType } from '../domain/canvasNodes'
import { getCanvasNodeDefinition } from '../domain/nodeRegistry'

/** 复制配方只复制输入与策略，不继承原节点的执行任务、缓存或输出。 */
export function resetDuplicatedCanvasExecutionData(
  nodeType: CanvasNodeType,
  data: DynamicValueMap,
): void {
  if (!getCanvasNodeDefinition(nodeType)?.executionKind) return

  for (const key of [
    'latestExecution',
    'lastOutputFingerprint',
    'lastExecutionStatus',
    'multiAngleBatch',
    'multiAngleResultPlaceholderId',
  ]) delete data[key]
  if ('lastOutput' in data) data.lastOutput = ''
  if ('lastOutputRevision' in data) data.lastOutputRevision = 0
  if ('imageUrl' in data) data.imageUrl = null
  if ('previewImageUrl' in data) data.previewImageUrl = null
  if ('videoUrl' in data) data.videoUrl = null
  if ('audioUrl' in data) data.audioUrl = null
  if ('isGenerating' in data) data.isGenerating = false
  if ('generationStartedAt' in data) data.generationStartedAt = null
  if ('generationError' in data) data.generationError = null
  if ('serverTaskId' in data) data.serverTaskId = null
  if ('serverTaskModelId' in data) data.serverTaskModelId = null
}
