import type { ImageEditorViewportLayoutV3 } from '../editor/useImageEditorViewportLayoutV3'
import {
  ImageEditorPresentationSurfaceV3,
  imageEditorViewportResultCoverageV3,
} from './imageEditorPresentationSurfaceV3'
import type { ImageEditorRenderSnapshotV3 } from './imageEditorRenderSessionContractsV3'
import { imageEditorRenderResultMatchesViewV3 } from './imageEditorRenderSessionIdentityV3'
import type { ImageEditorManagedViewportCompositeV3 } from './viewportCompositeTypesV3'

interface PresentationLayoutV3 extends ImageEditorViewportLayoutV3 {
  cameraSequence: number
}

export function presentImageEditorRenderSessionFrameV3(options: {
  compositor: ImageEditorPresentationSurfaceV3
  snapshot: ImageEditorRenderSnapshotV3
  layout: PresentationLayoutV3
  stable: ImageEditorManagedViewportCompositeV3 | null
  draft: ImageEditorManagedViewportCompositeV3 | null
  backdrop: ImageEditorManagedViewportCompositeV3 | null
}): { coverage: number; targetMipCoverage: number } | null {
  const { compositor, snapshot, layout, stable, draft, backdrop } = options
  const currentStable = imageEditorRenderResultMatchesViewV3(stable, snapshot, layout) ? stable : null
  const currentDraft = imageEditorRenderResultMatchesViewV3(draft, snapshot, layout) ? draft : null
  const currentBackdrop = backdrop?.renderGeneration === snapshot.renderGeneration
    && backdrop.geometryHash === snapshot.geometryHash
    ? backdrop
    : null
  const compatibleDraft = draft?.geometryHash === snapshot.geometryHash
    && draft.viewportKey === layout.viewportKey
    && draft.cameraSequence === layout.cameraSequence
    ? draft
    : null
  const compatibleBackdrop = backdrop?.geometryHash === snapshot.geometryHash ? backdrop : null
  const reusableClearStable = stable?.renderGeneration === snapshot.renderGeneration
    && stable.geometryHash === snapshot.geometryHash
    && stable.mip <= 1
    && imageEditorViewportResultCoverageV3(stable, layout) >= 0.999_999
    ? stable
    : null
  const fallback = snapshot.quality === 'draft'
    ? currentDraft ?? currentBackdrop ?? compatibleDraft ?? compatibleBackdrop ?? stable ?? backdrop
    : currentStable ?? currentBackdrop ?? stable ?? backdrop ?? draft
  const target = currentDraft && currentDraft !== fallback
    ? currentDraft
    : reusableClearStable
  if (!fallback && !target) return null
  return compositor.present(
    fallback,
    target,
    layout,
    layout.cameraSequence,
    snapshot.document.geometry,
    snapshot.geometryHash,
  )
}
