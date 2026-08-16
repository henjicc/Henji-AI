import { mediaSourceNodeData, mediaSourceNodeType } from '@/features/canvas/application/assetMediaAssignment'
import { addTrustedMediaCanvasNode } from '@/features/canvas/application/canvasApplicationService'
import type { AssetDragPayload } from '@/features/assets/drag/assetDragPayload'
import type { CanvasNodePlacement } from '@/core/assistant/capabilities/canvasMutationApplicationCapabilities'

import { assetApplicationService } from './assetApplicationService'

export async function addAssetToCanvas(input: {
  projectId: string
  assetId: string
  placement: CanvasNodePlacement
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
  const result = addTrustedMediaCanvasNode({
    projectId: input.projectId,
    nodeType: mediaSourceNodeType(asset.mediaType),
    placement: input.placement,
    data: mediaSourceNodeData(payload),
  })
  return { ...result, assetId: asset.id, mediaType: asset.mediaType }
}
