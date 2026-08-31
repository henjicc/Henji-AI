import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import type { ImageEditRenderQuality } from '@/core/imageEdit/v3/renderNodeDefinition'

export interface ImageEditorPreviewProxyV3 {
  resourceId: string
  width: number
  height: number
  mediaType: 'image/webp'
  bytes: ArrayBuffer
}

export interface ImageEditorPreviewBrushTileV3 {
  resourceId: string
  storage: 'rgba-float32' | 'mask-float32'
  width: number
  height: number
  /** 独占且精确长度的 RGBA（4 通道）或蒙版（1 通道）Float32 字节。 */
  bytes: ArrayBuffer
}

export interface ImageEditorPreviewRenderRequestV3 {
  type: 'render'
  requestId: string
  sequence: number
  sessionId: string
  document: ImageEditDocumentV3
  quality: ImageEditRenderQuality
  maxDimension: number
  proxies: ImageEditorPreviewProxyV3[]
  brushTiles: ImageEditorPreviewBrushTileV3[]
}

export interface ImageEditorPreviewCancelRequestV3 {
  type: 'cancel'
  requestId: string
}

export interface ImageEditorPreviewDisposeRequestV3 {
  type: 'dispose'
}

export type ImageEditorPreviewWorkerRequestV3 =
  | ImageEditorPreviewRenderRequestV3
  | ImageEditorPreviewCancelRequestV3
  | ImageEditorPreviewDisposeRequestV3

interface ImageEditorPreviewCompletedBaseV3 {
  requestId: string
  sequence: number
  width: number
  height: number
  diagnostics: string[]
}

export interface ImageEditorPreviewBitmapEventV3 extends ImageEditorPreviewCompletedBaseV3 {
  type: 'rendered-bitmap'
  bitmap: ImageBitmap
}

export interface ImageEditorPreviewBlobEventV3 extends ImageEditorPreviewCompletedBaseV3 {
  type: 'rendered-blob'
  mediaType: 'image/png'
  bytes: ArrayBuffer
}

export interface ImageEditorPreviewFailedEventV3 {
  type: 'failed'
  requestId: string
  sequence: number
  code: 'aborted' | 'unsupported-effect' | 'render-failed'
  message: string
}

export type ImageEditorPreviewWorkerEventV3 =
  | ImageEditorPreviewBitmapEventV3
  | ImageEditorPreviewBlobEventV3
  | ImageEditorPreviewFailedEventV3

export interface ImageEditorPreviewWorkerPortV3 {
  onmessage: ((event: MessageEvent<ImageEditorPreviewWorkerEventV3>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  postMessage(message: ImageEditorPreviewWorkerRequestV3, transfer?: Transferable[]): void
  terminate(): void
}

export type ImageEditorPreviewWorkerFactoryV3 = () => ImageEditorPreviewWorkerPortV3
