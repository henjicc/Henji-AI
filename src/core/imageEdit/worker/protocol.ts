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
  | 'webgpu-device-recovery-cooldown'
  | 'webgpu-canvas-format-unavailable'
  | 'webgpu-baseline-pipeline-failed'
  | 'webgpu-diffusion-pipeline-failed'
  | 'webgpu-vgpu-blur-pipeline-failed'
  | 'webgpu-vgpu-glow-pipeline-failed'
  | 'webgpu-initialization-unknown'

export interface ImageEditWorkerInitializationFailure {
  code: ImageEditWorkerInitializationFailureCode
  detail: string
}

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
  supportedQualities?: readonly ('realtime' | 'high')[]
  hardCancellationSupported?: false
  fallback?: {
    backend: 'sharp'
    hardCancellationSupported: false
    unsupportedParameters: readonly string[]
  }
  initializationFailure?: ImageEditWorkerInitializationFailure
  reason?: string
}
