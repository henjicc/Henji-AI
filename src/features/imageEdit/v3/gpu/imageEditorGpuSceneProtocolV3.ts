import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import type { ImageEditTransformV3 } from '@/core/imageEdit/v3/layerTypes'
import type { ImageEditRenderQuality } from '@/core/imageEdit/v3/renderNodeDefinition'
import type {
  ImageEditorV3ResourceDescriptor,
  ImageEditorV3ResourceRef,
  ImageEditorV3SourceTile,
} from '@/platform/contracts/imageEditorV3'
import type { ImageEditorViewportLayoutV3 } from '../editor/useImageEditorViewportLayoutV3'

export const IMAGE_EDITOR_GPU_SCENE_PROTOCOL_VERSION_V3 = 1 as const
export const IMAGE_EDITOR_GPU_SCENE_DEFAULT_BUDGET_BYTES_V3 = 256 * 1024 * 1024

export interface ImageEditorGpuSceneTileKeyV3 {
  resourceRef: ImageEditorV3ResourceRef
  mip: number
  tileX: number
  tileY: number
  contentVersion: string
  /** 颜色资源为 RGBA；蒙版统一上传为紧凑 r8unorm。 */
  format?: 'rgba8unorm' | 'r8unorm'
}

export interface ImageEditorGpuSceneUploadTileV3 {
  key: ImageEditorGpuSceneTileKeyV3
  tile: ImageEditorV3SourceTile
  estimatedGpuBytes: number
  protections?: readonly ImageEditorGpuSceneResourceProtectionV3[]
}

export type ImageEditorGpuSceneResourceProtectionV3 =
  | 'viewport'
  | 'interaction'
  | 'stable-frame'

interface ImageEditorGpuSceneSequencedRequestV3 {
  sceneGeneration: number
}

export interface ImageEditorGpuSceneInitializeRequestV3 {
  type: 'initialize'
  protocolVersion: typeof IMAGE_EDITOR_GPU_SCENE_PROTOCOL_VERSION_V3
  sessionId: string
  memoryBudgetBytes: number
}

export interface ImageEditorGpuSceneSyncRequestV3 extends ImageEditorGpuSceneSequencedRequestV3 {
  type: 'sync-scene'
  document: ImageEditDocumentV3
  resourceDescriptors: readonly ImageEditorV3ResourceDescriptor[]
}

export interface ImageEditorGpuSceneUploadTilesRequestV3 extends ImageEditorGpuSceneSequencedRequestV3 {
  type: 'upload-tiles'
  tiles: readonly ImageEditorGpuSceneUploadTileV3[]
}

export interface ImageEditorGpuSceneTransformRequestV3 extends ImageEditorGpuSceneSequencedRequestV3 {
  type: 'update-transform'
  interactionSequence: number
  layerId: string
  transform: ImageEditTransformV3 | null
}

export interface ImageEditorGpuSceneViewportRequestV3 extends ImageEditorGpuSceneSequencedRequestV3 {
  type: 'update-viewport'
  cameraSequence: number
  layout: ImageEditorViewportLayoutV3
}

export interface ImageEditorGpuSceneRenderRequestV3 extends ImageEditorGpuSceneSequencedRequestV3 {
  type: 'render'
  requestId: string
  cameraSequence: number
  interactionSequence: number
  quality: ImageEditRenderQuality
}

export interface ImageEditorGpuSceneExportRequestV3 extends ImageEditorGpuSceneSequencedRequestV3 {
  type: 'export'
  requestId: string
  quality: ImageEditRenderQuality
  outputTiles: readonly { tileX: number; tileY: number; width: number; height: number }[]
}

export interface ImageEditorGpuSceneDisposeRequestV3 {
  type: 'dispose'
}

export type ImageEditorGpuSceneWorkerRequestV3 =
  | ImageEditorGpuSceneInitializeRequestV3
  | ImageEditorGpuSceneSyncRequestV3
  | ImageEditorGpuSceneUploadTilesRequestV3
  | ImageEditorGpuSceneTransformRequestV3
  | ImageEditorGpuSceneViewportRequestV3
  | ImageEditorGpuSceneRenderRequestV3
  | ImageEditorGpuSceneExportRequestV3
  | ImageEditorGpuSceneDisposeRequestV3

interface ImageEditorGpuSceneEventBaseV3 {
  sceneGeneration: number
  deviceGeneration: number
}

export interface ImageEditorGpuSceneReadyEventV3 extends ImageEditorGpuSceneEventBaseV3 {
  type: 'ready'
  recovered: boolean
}

export interface ImageEditorGpuSceneTilesNeededEventV3 extends ImageEditorGpuSceneEventBaseV3 {
  type: 'tiles-needed'
  keys: readonly ImageEditorGpuSceneTileKeyV3[]
}

export interface ImageEditorGpuSceneFrameReadyEventV3 extends ImageEditorGpuSceneEventBaseV3 {
  type: 'frame-ready'
  requestId: string
  cameraSequence: number
  interactionSequence: number
  quality: ImageEditRenderQuality
  bitmap: ImageBitmap
  diagnostics?: {
    uploadCount: number
    pipelineCompileCount: number
    frameCount: number
    diagnosticReadbackCount: number
    transientUniformUpdateCount: number
  }
}

export interface ImageEditorGpuSceneExportTileEventV3 extends ImageEditorGpuSceneEventBaseV3 {
  type: 'export-tile'
  requestId: string
  tileX: number
  tileY: number
  width: number
  height: number
  pixels: ArrayBuffer
  completed: boolean
}

export interface ImageEditorGpuSceneDeviceLostEventV3 extends ImageEditorGpuSceneEventBaseV3 {
  type: 'device-lost'
  reason: string
  retryAfterMs: number
}

export interface ImageEditorGpuSceneFailedEventV3 extends ImageEditorGpuSceneEventBaseV3 {
  type: 'failed'
  requestId: string | null
  code: 'initialization-failed' | 'resource-budget-exceeded' | 'composition-not-ready' | 'export-not-ready'
  message: string
  recoverable: boolean
}

export type ImageEditorGpuSceneWorkerEventV3 =
  | ImageEditorGpuSceneReadyEventV3
  | ImageEditorGpuSceneTilesNeededEventV3
  | ImageEditorGpuSceneFrameReadyEventV3
  | ImageEditorGpuSceneExportTileEventV3
  | ImageEditorGpuSceneDeviceLostEventV3
  | ImageEditorGpuSceneFailedEventV3

export interface ImageEditorGpuSceneWorkerPortV3 {
  onmessage: ((event: MessageEvent<ImageEditorGpuSceneWorkerEventV3>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  postMessage(message: ImageEditorGpuSceneWorkerRequestV3, transfer?: Transferable[]): void
  terminate(): void
}

export type ImageEditorGpuSceneWorkerFactoryV3 = () => ImageEditorGpuSceneWorkerPortV3

export function imageEditorGpuSceneTileKeyV3(key: ImageEditorGpuSceneTileKeyV3): string {
  return [key.format ?? 'rgba8unorm', key.resourceRef, key.mip, key.tileX, key.tileY, key.contentVersion].join(':')
}
