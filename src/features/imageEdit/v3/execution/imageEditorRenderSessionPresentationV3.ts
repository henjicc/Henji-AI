import type { ImageEditorViewportLayoutV3 } from '../editor/useImageEditorViewportLayoutV3'
import { ImageEditorPresentationSurfaceV3 } from './imageEditorPresentationSurfaceV3'
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
  const fallback = currentStable ?? currentBackdrop ?? stable ?? backdrop ?? draft
  const target = currentDraft && currentDraft !== fallback ? currentDraft : null
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
