import {
  createTileRegion,
  imageEditOutputSizeV3,
  type ImageEditResourceBudget,
  type ImageEditSize,
} from '@/core/imageEdit/v3'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import {
  createImageEditorViewportSourceTileRequestsV3,
  estimateImageEditorViewportWorkingRegionPixelsV3,
  type PreparedImageEditorViewportCompositeV3,
} from './viewportCompositeDocumentV3'
import type { ImageEditorViewportTileCandidateV3 } from './viewportTilePlannerV3'

export function imageEditorViewportCompositeCandidateFitsBudgetV3(options: {
  budget: ImageEditResourceBudget
  prepared: PreparedImageEditorViewportCompositeV3
  document: ImageEditDocumentV3
  candidate: ImageEditorViewportTileCandidateV3
  bitDepth: 8 | 16 | 32
  wholeSource: boolean
  resourceSizes?: ReadonlyMap<string, ImageEditSize>
}): boolean {
  const resourceSizes = options.resourceSizes ?? new Map<string, ImageEditSize>()
  const sourceRequests = createImageEditorViewportSourceTileRequestsV3(
    options.prepared,
    options.candidate,
    options.bitDepth,
    options.wholeSource,
    resourceSizes,
  )
  const transferBytes = sourceRequests.reduce((total, request) => {
    const next = total + request.estimatedBytes
    if (!Number.isSafeInteger(next)) throw new Error('视口候选传输字节数超出安全范围')
    return next
  }, 0)
  const workingPixels = estimateImageEditorViewportWorkingRegionPixelsV3(
    options.prepared,
    options.candidate,
    options.wholeSource,
    resourceSizes,
  )
  const workingBytes = workingPixels * 4 * Float32Array.BYTES_PER_ELEMENT
    * Math.max(3, options.prepared.plan.nodes.length + 2)
  const documentSize = imageEditOutputSizeV3(options.document.geometry)
  const outputBytes = options.candidate.tiles.reduce((total, tile) => {
    const output = createTileRegion(
      documentSize,
      { mip: options.candidate.mip, x: tile.tileX, y: tile.tileY },
      tile.halo,
    ).outputRect
    const next = total + output.width * output.height * 4
    if (!Number.isSafeInteger(next)) throw new Error('视口候选成品字节数超出安全范围')
    return next
  }, 0)
  const totalBytes = transferBytes + workingBytes + outputBytes
  if (!Number.isSafeInteger(totalBytes)) throw new Error('视口候选总工作集超出安全范围')
  return options.budget.admission('in-flight', totalBytes).admitted
    && options.budget.admission('gpu', outputBytes).admitted
}
