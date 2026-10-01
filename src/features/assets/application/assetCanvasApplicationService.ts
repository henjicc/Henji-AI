import { mediaSourceNodeData, mediaSourceNodeType } from '@/features/canvas/application/assetMediaAssignment'
import { addTrustedMediaCanvasNode } from '@/features/canvas/application/canvasApplicationService'
import { readPersistedCanvasProjectSnapshot } from '@/features/canvas/application/canvasQueryService'
import type { AssetDragPayload } from '@/features/assets/drag/assetDragPayload'
import type { CanvasNodePlacement } from '@/core/application-control/domains/canvas/canvasMutationApplicationCapabilities'

import { assetApplicationService } from './assetApplicationService'

export async function addAssetToCanvas(input: {
  projectId: string
  assetId: string
  placement: CanvasNodePlacement
}, signal?: AbortSignal): Promise<Record<string, unknown>> {
  signal?.throwIfAborted()
  const asset = await assetApplicationService.inspect(input.assetId)
  signal?.throwIfAborted()
  const payload: AssetDragPayload = {
    assetId: asset.id,
    type: asset.mediaType,
    sourceType: 'asset',
    filePath: asset.filePath,
    imageUrl: asset.displayUrl,
    thumbnailUrl: asset.thumbnailUrl,
    aspectRatio: asset.width && asset.height ? `${asset.width}:${asset.height}` : undefined,
    durationSeconds: asset.durationSeconds,
    displayName: asset.displayName,
  }
  const data = mediaSourceNodeData(payload)
  const nodeType = mediaSourceNodeType(asset.mediaType)
  const result = await addTrustedMediaCanvasNode({
    projectId: input.projectId,
    nodeType,
    placement: input.placement,
    data,
  })
  const persisted = await readPersistedCanvasProjectSnapshot(input.projectId)
  const node = persisted.nodes.find(node => node.id === result.nodeId)
  const verified = node?.type === nodeType && Object.entries(data).every(([key, value]) => JSON.stringify(node.data[key as keyof typeof node.data]) === JSON.stringify(value))
  return { ...result, assetId: asset.id, mediaType: asset.mediaType, nodeRef: { kind: 'canvas.node', id: `${input.projectId}:${String(result.nodeId)}` }, verification: { verified, condition: '原画布已保存并回读新增节点与正式素材的媒体字段。' } }
}
