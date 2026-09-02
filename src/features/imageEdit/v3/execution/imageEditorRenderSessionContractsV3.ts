import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import type { ImageEditRenderQuality } from '@/core/imageEdit/v3/renderNodeDefinition'
import type { ImageEditorV3ResourceDescriptor } from '@/platform/contracts/imageEditorV3'
import type { ImageEditorViewportLayoutV3 } from '../editor/useImageEditorViewportLayoutV3'
import type { ImageEditorPresentationSurfaceElementsV3 } from './imageEditorPresentationSurfaceV3'
import type { ImageEditorRenderSessionClientDependenciesV3 } from './imageEditorRenderSessionClientsV3'
import type { ImageEditorManagedViewportCompositeV3 } from './viewportCompositeTypesV3'

export interface ImageEditorRenderSnapshotV3 {
  document: ImageEditDocumentV3
  renderGeneration: number
  geometryHash: string
  quality: ImageEditRenderQuality
  resourceDescriptors: readonly ImageEditorV3ResourceDescriptor[]
  eventTimestamp?: number
}

export interface ImageEditorRenderSessionDiagnosticsV3 {
  surfaceId: string | null
  renderGeneration: number
  geometryHash: string
  cameraSequence: number
  coverage: number
  targetMipCoverage: number
  targetMip: number | null
  eventToPresentMs: number | null
  rendering: boolean
  renderBackend: 'gpu' | 'cpu'
  deviceStatus: 'idle' | 'ready' | 'lost' | 'fallback'
  deviceGeneration: number
  fallbackRequired: boolean
  diagnostic: string | null
}

export interface ImageEditorRenderSessionStateV3 extends ImageEditorRenderSessionDiagnosticsV3 {
  result: ImageEditorManagedViewportCompositeV3 | null
}

export interface ImageEditorRenderSessionV3 {
  attachSurface(elements: ImageEditorPresentationSurfaceElementsV3): () => void
  updateSnapshot(snapshot: ImageEditorRenderSnapshotV3): void
  updateViewport(layout: ImageEditorViewportLayoutV3): void
  subscribeDiagnostics(listener: (value: ImageEditorRenderSessionDiagnosticsV3) => void): () => void
  setVisibility(visible: boolean): void
  dispose(): void
}

export interface ImageEditorRenderSessionDependenciesV3
  extends ImageEditorRenderSessionClientDependenciesV3 {}
