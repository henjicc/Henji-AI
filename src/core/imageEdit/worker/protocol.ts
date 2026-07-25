import type { DiffusionRecipe } from '../diffusionRecipe'
import type { ImageEditRenderQuality } from '../execution'
import { IMAGE_EDIT_OPERATION_IDS, type AnnotationOperationParams, type CropOperationParams, type OrientationOperationParams } from '../types'

export type ImageEditWorkerSource =
  | { kind: 'url'; url: string }
  | { kind: 'blob'; blob: Blob }

export type ImageEditExportFormat = 'image/png' | 'image/jpeg' | 'image/webp'

/**
 * Worker 初始化失败时可安全写入日志的阶段码。它不携带路径、驱动版本或原始异常，
 * 以免将运行环境细节带入渲染层。
 */
export type ImageEditWorkerInitializationFailureCode =
  | 'worker-canvas-api-unavailable'
  | 'webgpu-api-unavailable'
  | 'webgpu-adapter-unavailable'
  | 'webgpu-device-request-failed'
  | 'webgpu-canvas-format-unavailable'
  | 'webgpu-baseline-pipeline-failed'
  | 'webgpu-diffusion-pipeline-failed'
  | 'webgpu-initialization-unknown'

export interface ImageEditWorkerInitializationFailure {
  code: ImageEditWorkerInitializationFailureCode
  detail: string
}

/** Worker 内可执行的固定操作顺序：朝向 → 柔光 → 标注 → 裁剪。 */
export interface ImageEditWorkerComposition {
  orientation: OrientationOperationParams
  annotations?: AnnotationOperationParams
  crop?: CropOperationParams
}

export interface ImageEditWorkerInitRequest {
  type: 'initialize'
  requestId: string
}

export interface ImageEditWorkerPreviewRequest {
  type: 'preview'
  requestId: string
  revision: number
  source: ImageEditWorkerSource
  recipe?: DiffusionRecipe
  composition?: ImageEditWorkerComposition
  quality?: ImageEditRenderQuality
  maxPixels?: number
}

export interface ImageEditWorkerExportRequest {
  type: 'export'
  requestId: string
  revision?: number
  source: ImageEditWorkerSource
  recipe?: DiffusionRecipe
  composition?: ImageEditWorkerComposition
  renderQuality?: ImageEditRenderQuality
  format: ImageEditExportFormat
  quality?: number
  tileSize?: number
  halo?: number
  globalScatterMaxDimension?: number
}

export interface ImageEditWorkerCancelRequest {
  type: 'cancel'
  requestId: string
}

export interface ImageEditWorkerDestroyRequest {
  type: 'destroy'
}

export type ImageEditWorkerRequest =
  | ImageEditWorkerInitRequest
  | ImageEditWorkerPreviewRequest
  | ImageEditWorkerExportRequest
  | ImageEditWorkerCancelRequest
  | ImageEditWorkerDestroyRequest

export interface ImageEditWorkerCapabilities {
  available: boolean
  adapterName: string | null
  backend: string | null
  isFallbackAdapter: boolean | null
  features: string[]
  limits: Record<string, number>
  rgba16Float: {
    renderable: boolean
    sampleable: boolean
  }
  offscreenCanvas: boolean
  imageBitmap: boolean
  supportedExportFormats: ImageEditExportFormat[]
  executionBackend?: 'webgpu-worker'
  supportedOperationIds?: readonly string[]
  supportedQualities?: readonly ImageEditRenderQuality[]
  hardCancellationSupported?: true
  fallback?: {
    backend: 'sharp'
    hardCancellationSupported: false
    unsupportedParameters: readonly string[]
  }
  initializationFailure?: ImageEditWorkerInitializationFailure
  reason?: string
}

export interface ImageEditWorkerCapabilitiesEvent {
  type: 'capabilities'
  requestId: string
  capabilities: ImageEditWorkerCapabilities
}

export interface ImageEditWorkerPreviewCompletedEvent {
  type: 'preview-completed'
  requestId: string
  revision: number
  bitmap: ImageBitmap
  width: number
  height: number
  durationMs: number
}

export interface ImageEditWorkerExportProgressEvent {
  type: 'export-progress'
  requestId: string
  stage?: 'decode' | 'source' | 'scatter' | 'composite' | 'encode'
  completedTiles: number
  totalTiles: number
}

export function withImageEditWorkerExecutionCapabilities(
  capabilities: ImageEditWorkerCapabilities
): ImageEditWorkerCapabilities {
  return {
    ...capabilities,
    executionBackend: 'webgpu-worker',
    supportedOperationIds: [
      IMAGE_EDIT_OPERATION_IDS.orientation,
      IMAGE_EDIT_OPERATION_IDS.diffusion,
      IMAGE_EDIT_OPERATION_IDS.annotations,
      IMAGE_EDIT_OPERATION_IDS.crop,
    ],
    supportedQualities: ['realtime', 'high'],
    hardCancellationSupported: true,
    fallback: {
      backend: 'sharp',
      hardCancellationSupported: false,
      unsupportedParameters: [
        'source',
        'tone',
        'detail',
        'lens',
        'scatter.anisotropy',
        'scatter.chromaticSpread',
      ],
    },
  }
}

export interface ImageEditWorkerExportCompletedEvent {
  type: 'export-completed'
  requestId: string
  revision?: number
  bytes: Uint8Array
  format: ImageEditExportFormat
  width: number
  height: number
  durationMs: number
}

export interface ImageEditWorkerCancelledEvent {
  type: 'cancelled'
  requestId: string
}

export interface ImageEditWorkerDeviceLostEvent {
  type: 'device-lost'
  reason: string
  recoverable: boolean
}

export type ImageEditWorkerErrorCode =
  | 'cancelled'
  | 'decode-failed'
  | 'device-unavailable'
  | 'device-lost'
  | 'image-too-large'
  | 'encoding-failed'
  | 'invalid-request'
  | 'unknown'

export interface ImageEditWorkerErrorEvent {
  type: 'error'
  requestId?: string
  code: ImageEditWorkerErrorCode
  message: string
  recoverable: boolean
}

export type ImageEditWorkerEvent =
  | ImageEditWorkerCapabilitiesEvent
  | ImageEditWorkerPreviewCompletedEvent
  | ImageEditWorkerExportProgressEvent
  | ImageEditWorkerExportCompletedEvent
  | ImageEditWorkerCancelledEvent
  | ImageEditWorkerDeviceLostEvent
  | ImageEditWorkerErrorEvent

export function isImageEditWorkerEvent(value: unknown): value is ImageEditWorkerEvent {
  if (!value || typeof value !== 'object') return false
  const type = Reflect.get(value, 'type')
  return typeof type === 'string' && [
    'capabilities',
    'preview-completed',
    'export-progress',
    'export-completed',
    'cancelled',
    'device-lost',
    'error',
  ].includes(type)
}
