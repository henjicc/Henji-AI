import { assetSourceNodeData, assetSourceNodeType } from '@/features/canvas/application/assetMediaAssignment'
import { addCanvasNode } from '@/features/canvas/application/canvasApplicationService'
import type { AssetDragPayload } from '@/features/assets/drag/assetDragPayload'

import { assetApplicationService } from './assetApplicationService'

export async function addAssetToCanvas(input: {
  projectId: string
  assetId: string
  placement: { mode: 'viewport_center' } | { mode: 'right_of_node'; anchorNodeId: string }
}): Promise<Record<string, unknown>> {
  const asset = await assetApplicationService.inspect(input.assetId)
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
  const result = addCanvasNode({
    projectId: input.projectId,
    nodeType: assetSourceNodeType(asset.mediaType),
    placement: input.placement,
    data: assetSourceNodeData(payload),
  })
  return { ...result, assetId: asset.id, mediaType: asset.mediaType }
}
