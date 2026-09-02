import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import type { ImageEditMemoryLease } from '@/core/imageEdit/v3/resourceBudget'
import type { ImageEditorViewportCompositeRenderedEventV3 } from './viewportCompositeProtocolV3'
import {
  ImageEditorViewportCompositeProgressV3,
  ImageEditorViewportCompositeResultOwnerV3,
} from './viewportCompositeResultOwnerV3'
import type { ImageEditorManagedViewportCompositeV3 } from './viewportCompositeTypesV3'

export interface CompleteImageEditorViewportCompositeOptionsV3 {
  event: ImageEditorViewportCompositeRenderedEventV3
  document: ImageEditDocumentV3
  viewportKey: string
  coverage: 'viewport' | 'document'
  progress: ImageEditorViewportCompositeProgressV3
  outputLease: ImageEditMemoryLease
  resultOwner: ImageEditorViewportCompositeResultOwnerV3
}

/** 校验完整帧后把逐片到达的 bitmap 与预留额度原子交给结果租约。 */
export function completeImageEditorViewportCompositeV3(
  options: CompleteImageEditorViewportCompositeOptionsV3,
): ImageEditorManagedViewportCompositeV3 {
  const tiles = options.progress.complete(options.event)
  try {
    const gpuBytes = tiles.reduce(
      (total, tile) => total + tile.outputRect.width * tile.outputRect.height * 4,
      0,
    )
    if (gpuBytes > options.outputLease.bytes) {
      throw new Error('视口 Worker 返回的成品超过预留 GPU 资源')
    }
    const geometry = options.document.geometry
    return {
      documentId: options.document.id,
      revision: options.event.revision,
      renderGeneration: options.event.renderGeneration,
      cameraSequence: options.event.cameraSequence,
      geometryHash: options.event.geometryHash,
      geometry: {
        ...geometry,
        orientation: { ...geometry.orientation },
        crop: geometry.crop ? { ...geometry.crop } : null,
      },
      viewportKey: options.viewportKey,
      coverage: options.coverage,
      mip: options.event.mip,
      documentWidth: options.event.documentWidth,
      documentHeight: options.event.documentHeight,
      diagnostics: options.event.diagnostics,
      tiles,
      release: options.resultOwner.lease(tiles, options.outputLease),
    }
  } catch (error) {
    for (const tile of tiles) tile.bitmap.close()
    throw error
  }
}
