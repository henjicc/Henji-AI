export type ImageEditWorkerSource =
  | { kind: 'url'; url: string }
  | { kind: 'blob'; blob: Blob }

export type ImageEditExportFormat = 'image/png' | 'image/jpeg' | 'image/webp'

export interface ImageEditWorkerInitRequest {
  type: 'initialize'
  requestId: string
}

export interface ImageEditWorkerPreviewRequest {
  type: 'preview'
  requestId: string
  revision: number
  source: ImageEditWorkerSource
  maxPixels?: number
}

export interface ImageEditWorkerExportRequest {
  type: 'export'
  requestId: string
  source: ImageEditWorkerSource
  format: ImageEditExportFormat
  quality?: number
  tileSize?: number
  halo?: number
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
  completedTiles: number
  totalTiles: number
}

export interface ImageEditWorkerExportCompletedEvent {
  type: 'export-completed'
  requestId: string
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
