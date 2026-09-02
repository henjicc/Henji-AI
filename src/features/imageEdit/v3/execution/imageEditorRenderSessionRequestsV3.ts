import { imageEditOutputSizeV3 } from '@/core/imageEdit/v3'
import type { ImageEditorViewportLayoutV3 } from '../editor/useImageEditorViewportLayoutV3'
import type { ImageEditorRenderSnapshotV3 } from './imageEditorRenderSessionContractsV3'
import { resolveImageEditorBlurPreviewMipV3 } from './previewEffectScalingV3'
import {
  resolveImageEditorCoarsePreviewMipV3,
  resolveImageEditorInteractiveDraftMipV3,
} from './previewFallbackMipV3'
import type { ImageEditorViewportCompositeRequestV3 } from './viewportCompositeTypesV3'

interface RenderSessionLayoutV3 extends ImageEditorViewportLayoutV3 {
  cameraSequence: number
}

function visibleRequest(
  snapshot: ImageEditorRenderSnapshotV3,
  layout: RenderSessionLayoutV3,
): Pick<
  ImageEditorViewportCompositeRequestV3,
  'viewport' | 'viewportKey' | 'cameraSequence' | 'coverage'
  | 'overscanViewports' | 'forwardPrefetchViewports'
> {
  return {
    viewport: layout.viewport,
    viewportKey: layout.viewportKey,
    cameraSequence: layout.cameraSequence,
    coverage: 'viewport',
    overscanViewports: 0,
    forwardPrefetchViewports: 0,
  }
}

export function createImageEditorDraftRequestV3(
  snapshot: ImageEditorRenderSnapshotV3,
  layout: RenderSessionLayoutV3,
): ImageEditorViewportCompositeRequestV3 {
  const blurMip = resolveImageEditorBlurPreviewMipV3(snapshot.document, layout.viewport) ?? 0
  return {
    ...snapshot,
    ...visibleRequest(snapshot, layout),
    phase: 'coarse',
    preferredMip: Math.max(resolveImageEditorInteractiveDraftMipV3(layout.viewport), blurMip),
    quality: 'draft',
  }
}

export function createImageEditorAnalysisRequestV3(
  snapshot: ImageEditorRenderSnapshotV3,
  layout: RenderSessionLayoutV3,
  analysisMip: number,
): ImageEditorViewportCompositeRequestV3 {
  return {
    ...snapshot,
    viewport: layout.viewport,
    viewportKey: `analysis:${snapshot.renderGeneration}:${analysisMip}`,
    phase: 'analysis',
    cameraSequence: layout.cameraSequence,
    preferredMip: analysisMip,
    coverage: 'document',
    overscanViewports: 0,
    forwardPrefetchViewports: 0,
    analysisRequested: true,
  }
}

export function createImageEditorBackdropRequestV3(
  snapshot: ImageEditorRenderSnapshotV3,
  layout: RenderSessionLayoutV3,
): ImageEditorViewportCompositeRequestV3 {
  return {
    ...snapshot,
    viewport: layout.viewport,
    viewportKey: `backdrop:${snapshot.renderGeneration}`,
    phase: 'coarse',
    cameraSequence: layout.cameraSequence,
    preferredMip: resolveImageEditorCoarsePreviewMipV3(
      imageEditOutputSizeV3(snapshot.document.geometry),
    ),
    coverage: 'document',
    overscanViewports: 0,
    forwardPrefetchViewports: 0,
    quality: 'draft',
  }
}

export function createImageEditorTargetRequestV3(
  snapshot: ImageEditorRenderSnapshotV3,
  layout: RenderSessionLayoutV3,
  previousMip: number | undefined,
): ImageEditorViewportCompositeRequestV3 {
  return {
    ...snapshot,
    ...visibleRequest(snapshot, layout),
    phase: 'target',
    previousMip,
    preferredMip: resolveImageEditorBlurPreviewMipV3(snapshot.document, layout.viewport),
  }
}
