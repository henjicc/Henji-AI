import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import type { ImageEditRenderQuality } from '@/core/imageEdit/v3/renderNodeDefinition'
import type { ImageEditRect } from '@/core/imageEdit/v3/tileGeometry'
import type { ImageEditorV3SourceTile } from '@/platform/contracts/imageEditorV3'
import type { ImageEditorPreviewBrushTileV3 } from './previewProtocolV3'
import type { ImageEditorViewportTilePlanV3 } from './viewportTilePlannerV3'

export interface ImageEditorViewportCompositeRenderRequestV3 {
  type: 'render'
  requestId: string
  sequence: number
  renderGeneration: number
  cameraSequence: number
  geometryHash: string
  document: ImageEditDocumentV3
  quality: ImageEditRenderQuality
  plan: ImageEditorViewportTilePlanV3
  sourceTiles: ImageEditorV3SourceTile[]
  brushTiles: ImageEditorPreviewBrushTileV3[]
}

export interface ImageEditorViewportCompositeCancelRequestV3 {
  type: 'cancel'
  requestId: string
}

export interface ImageEditorViewportCompositeDisposeRequestV3 {
  type: 'dispose'
}

export type ImageEditorViewportCompositeWorkerRequestV3 =
  | ImageEditorViewportCompositeRenderRequestV3
  | ImageEditorViewportCompositeCancelRequestV3
  | ImageEditorViewportCompositeDisposeRequestV3

export interface ImageEditorViewportCompositeBitmapTileV3 {
  bitmap: ImageBitmap
  /** 当前 mip 坐标中的最终区域，不包含渲染 halo。 */
  outputRect: ImageEditRect
}

export interface ImageEditorViewportCompositeTileRenderedEventV3 {
  type: 'tile-rendered'
  requestId: string
  sequence: number
  renderGeneration: number
  cameraSequence: number
  geometryHash: string
  revision: number
  mip: number
  tileIndex: number
  tile: ImageEditorViewportCompositeBitmapTileV3
}

export interface ImageEditorViewportCompositeRenderedEventV3 {
  type: 'rendered'
  requestId: string
  sequence: number
  renderGeneration: number
  cameraSequence: number
  geometryHash: string
  revision: number
  mip: number
  documentWidth: number
  documentHeight: number
  diagnostics: string[]
  completedTiles: number
}

export interface ImageEditorViewportCompositeFailedEventV3 {
  type: 'failed'
  requestId: string
  sequence: number
  renderGeneration: number
  code: 'aborted' | 'render-failed'
  message: string
}

export type ImageEditorViewportCompositeWorkerEventV3 =
  | ImageEditorViewportCompositeTileRenderedEventV3
  | ImageEditorViewportCompositeRenderedEventV3
  | ImageEditorViewportCompositeFailedEventV3

export interface ImageEditorViewportCompositeWorkerPortV3 {
  onmessage: ((event: MessageEvent<ImageEditorViewportCompositeWorkerEventV3>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  postMessage(message: ImageEditorViewportCompositeWorkerRequestV3, transfer?: Transferable[]): void
  terminate(): void
}

export type ImageEditorViewportCompositeWorkerFactoryV3 = () => ImageEditorViewportCompositeWorkerPortV3
