import type {
  ImageEditorRenderSnapshotV3,
} from './imageEditorRenderSessionContractsV3'
import type { ImageEditorManagedViewportCompositeV3 } from './viewportCompositeTypesV3'

interface RenderSessionViewIdentityV3 {
  viewportKey: string
  cameraSequence: number
}

export function sameImageEditorRenderSnapshotV3(
  left: ImageEditorRenderSnapshotV3 | null,
  right: ImageEditorRenderSnapshotV3,
): boolean {
  return Boolean(left
    && left.document === right.document
    && left.renderGeneration === right.renderGeneration
    && left.geometryHash === right.geometryHash
    && left.quality === right.quality
    && left.resourceDescriptors === right.resourceDescriptors)
}

export function imageEditorRenderResultMatchesViewV3(
  result: ImageEditorManagedViewportCompositeV3 | null,
  snapshot: ImageEditorRenderSnapshotV3 | null,
  layout: RenderSessionViewIdentityV3 | null,
): result is ImageEditorManagedViewportCompositeV3 {
  return Boolean(result && snapshot && layout
    && result.renderGeneration === snapshot.renderGeneration
    && result.geometryHash === snapshot.geometryHash
    && result.viewportKey === layout.viewportKey
    && result.cameraSequence === layout.cameraSequence)
}
