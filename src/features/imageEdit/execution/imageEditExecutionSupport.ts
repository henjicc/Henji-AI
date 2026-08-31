import {
  IMAGE_EDIT_OPERATION_IDS,
  type DiffusionOperationParams,
  type ImageEditEncodedFormat,
  type ImageEditExecutionCapabilities,
  type ImageEditExecutionDiagnostics,
  type ImageEditExecutionRequest,
  type ImageEditExecutionResult,
  type ImageEditWorkerComposition,
  type VgpuGlowOperationParams,
} from '@/core/imageEdit'
import { createLogger } from '@/core/logging'
import {
  fitWithinPixelBudget,
  IMAGE_EDIT_PREVIEW_MAX_PIXELS,
} from '@/core/imageEdit/worker/exportPrototype'
import type {
  ImageEditWorkerCapabilities,
  ImageEditWorkerInitializationFailureCode,
} from '@/core/imageEdit/worker/protocol'

const logger = createLogger('features.imageEdit.execution')
export const MAX_DEVICE_RECOVERY_RETRIES = 1

export interface WebGpuFallbackDiagnostic {
  reason: NonNullable<ImageEditExecutionDiagnostics['fallbackReason']>
  deviceRecoveryAttempts: number
  initializationFailureCode?: ImageEditWorkerInitializationFailureCode
}

export function assertSharpCompositionSupported(
  composition: ImageEditWorkerComposition
): void {
  const hasOrientation = composition.orientation.rotate !== 0 || composition.orientation.mirrored
  const hasAnnotations = Boolean(composition.annotations?.items.length)
  const hasCrop = composition.crop?.rect !== null && composition.crop?.rect !== undefined
  if (hasOrientation || hasAnnotations || hasCrop) {
    throw new Error('Sharp 柔光降级暂不支持与朝向、标注或裁剪合成，已保留原始编辑文档')
  }
}

export function getEnabledDiffusionParams(
  document: ImageEditExecutionRequest['document']
): DiffusionOperationParams | null {
  const operation = document.operations.find((entry) =>
    entry.enabled && entry.operationId === IMAGE_EDIT_OPERATION_IDS.diffusion
  )
  return (operation?.params as DiffusionOperationParams | undefined) ?? null
}

export function getEnabledVgpuGlowParams(
  document: ImageEditExecutionRequest['document']
): VgpuGlowOperationParams | null {
  const operation = document.operations.find((entry) =>
    entry.enabled && entry.operationId === IMAGE_EDIT_OPERATION_IDS.vgpuGlow
  )
  return (operation?.params as VgpuGlowOperationParams | undefined) ?? null
}

export function createWorkerComposition(
  document: ImageEditExecutionRequest['document'],
  includePostEffects: boolean
): ImageEditWorkerComposition {
  const getParams = <TParams extends object>(operationId: string, fallback: TParams): TParams => {
    const operation = document.operations.find(
      (entry) => entry.enabled && entry.operationId === operationId
    )
    return (operation?.params as TParams | undefined) ?? fallback
  }
  const orientation = getParams(
    IMAGE_EDIT_OPERATION_IDS.orientation,
    { rotate: 0 as const, mirrored: false }
  )
  if (!includePostEffects) return { orientation }
  return {
    orientation,
    annotations: getParams(IMAGE_EDIT_OPERATION_IDS.annotations, { items: [] }),
    crop: getParams(IMAGE_EDIT_OPERATION_IDS.crop, { rect: null }),
  }
}

export function resolveOrientedSize(
  width: number,
  height: number,
  rotate: number
): { width: number; height: number } {
  return rotate === 90 || rotate === 270
    ? { width: height, height: width }
    : { width, height }
}

export function createCapabilities(
  backend: 'webgpu-worker' | 'sharp',
  unsupportedParameters: readonly string[] = []
): ImageEditExecutionCapabilities {
  const fallbackUnsupported = backend === 'webgpu-worker'
    ? [...unsupportedParameters, IMAGE_EDIT_OPERATION_IDS.vgpuGlow]
    : unsupportedParameters
  return {
    executorId: 'image-edit-unified',
    backends: [backend],
    supportedOperationIds: [
      IMAGE_EDIT_OPERATION_IDS.orientation,
      IMAGE_EDIT_OPERATION_IDS.diffusion,
      IMAGE_EDIT_OPERATION_IDS.vgpuGlow,
      IMAGE_EDIT_OPERATION_IDS.annotations,
      IMAGE_EDIT_OPERATION_IDS.crop,
    ],
    purposes: ['preview', 'export'],
    qualities: ['realtime', 'high'],
    exportFormats: ['image/png', 'image/jpeg', 'image/webp'],
    hardCancellationSupported: false,
    fallback: {
      backend: 'sharp',
      unsupportedParameters: fallbackUnsupported,
      hardCancellationSupported: false,
    },
  }
}

export function throwVgpuGlowUnavailable(
  diagnostic: WebGpuFallbackDiagnostic
): never {
  throw new Error(
    `辉光 Pro 需要可用的 WebGPU，当前无法启动 VGPU（${diagnostic.reason}）`
  )
}

export function createFallbackDiagnostics(
  durationMs: number,
  unsupportedParameters: readonly string[],
  fallbackDiagnostic: WebGpuFallbackDiagnostic
): NonNullable<ImageEditExecutionResult['diagnostics']> {
  return {
    durationMs,
    fallbackReason: fallbackDiagnostic.reason,
    deviceRecoveryAttempts: fallbackDiagnostic.deviceRecoveryAttempts,
    unsupportedParameters,
  }
}

export function classifyWebGpuFallbackReason(
  error: unknown,
  deviceRecoveryAttempts: number,
  initializationFailureCode?: ImageEditWorkerInitializationFailureCode
): NonNullable<ImageEditExecutionDiagnostics['fallbackReason']> {
  if (
    initializationFailureCode === 'webgpu-device-recovery-cooldown'
    || deviceRecoveryAttempts >= MAX_DEVICE_RECOVERY_RETRIES
      && isRecoverableDeviceError(error)
  ) return 'webgpu-device-recovery-exhausted'
  if (initializationFailureCode === 'webgpu-api-unavailable') {
    return 'webgpu-api-unavailable'
  }
  if (initializationFailureCode === 'webgpu-adapter-unavailable') {
    return 'webgpu-adapter-unavailable'
  }
  const message = getErrorMessage(error).toLowerCase()
  if (message.includes('navigator.gpu') || message.includes('webgpu api')) {
    return 'webgpu-api-unavailable'
  }
  if (message.includes('gpu adapter') || message.includes('可用 gpu')) {
    return 'webgpu-adapter-unavailable'
  }
  return 'webgpu-initialization-failed'
}

export function createWebGpuFallbackDiagnostic(
  error: unknown,
  deviceRecoveryAttempts: number,
  initializationFailureCode?: ImageEditWorkerInitializationFailureCode
): WebGpuFallbackDiagnostic {
  return {
    reason: classifyWebGpuFallbackReason(
      error,
      deviceRecoveryAttempts,
      initializationFailureCode
    ),
    deviceRecoveryAttempts,
    initializationFailureCode,
  }
}

export function logWebGpuFallback(
  requestId: string,
  purpose: 'preview' | 'export',
  diagnostic: WebGpuFallbackDiagnostic
): void {
  logger.warn('WebGPU 不可用，准备使用兼容执行器', {
    event: 'image_edit.execution.webgpu.unavailable',
    requestId,
    context: {
      purpose,
      fallbackReason: diagnostic.reason,
      deviceRecoveryAttempts: diagnostic.deviceRecoveryAttempts,
      initializationFailureCode: diagnostic.initializationFailureCode,
    },
  })
}

export function logPreviewBudget(
  requestId: string,
  purpose: 'preview' | 'export',
  sourceSize: { width: number; height: number },
  requestedMaxPixels: number | undefined
): void {
  if (purpose !== 'preview') return
  const maxPixels = requestedMaxPixels ?? IMAGE_EDIT_PREVIEW_MAX_PIXELS
  if (!Number.isInteger(maxPixels) || maxPixels <= 0) return
  const previewSize = fitWithinPixelBudget(sourceSize.width, sourceSize.height, maxPixels)
  logger.debug('预览像素预算已应用', {
    event: 'image_edit.execution.preview.budget',
    requestId,
    context: {
      sourceWidth: sourceSize.width,
      sourceHeight: sourceSize.height,
      previewWidth: previewSize.width,
      previewHeight: previewSize.height,
      maxPixels,
    },
  })
}

export function mapSharpFormat(
  format: ImageEditEncodedFormat
): 'png' | 'jpeg' | 'webp' {
  if (format === 'image/jpeg') return 'jpeg'
  if (format === 'image/webp') return 'webp'
  return 'png'
}

export function mapMimeFormat(
  format: 'png' | 'jpeg' | 'webp'
): ImageEditEncodedFormat {
  if (format === 'jpeg') return 'image/jpeg'
  if (format === 'webp') return 'image/webp'
  return 'image/png'
}

export function bindAbort(
  signal: AbortSignal | undefined,
  cancel: () => void
): () => void {
  if (!signal) return () => undefined
  throwIfAborted(signal)
  signal.addEventListener('abort', cancel, { once: true })
  return () => signal.removeEventListener('abort', cancel)
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('图片编辑任务已取消', 'AbortError')
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
    || error instanceof Error && error.message.includes('已取消')
}

export function isRecoverableDeviceError(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase()
  return message.includes('device-lost')
    || message.includes('设备丢失')
    || message.includes('device-unavailable')
    || message.includes('device unavailable')
}

export function shouldRetryWebGpuDeviceFailure(
  error: unknown,
  completedRetries: number
): boolean {
  return isRecoverableDeviceError(error)
    && completedRetries < MAX_DEVICE_RECOVERY_RETRIES
}

export function shouldRetryUnavailableWorkerCapabilities(
  capabilities: ImageEditWorkerCapabilities,
  completedRetries: number
): boolean {
  if (capabilities.available) return false
  const detail = [
    capabilities.initializationFailure?.detail,
    capabilities.reason,
  ].filter(Boolean).join(' | ')
  return shouldRetryWebGpuDeviceFailure(detail, completedRetries)
}

export function createLogicalRequestId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? `image-edit-${crypto.randomUUID()}`
    : `image-edit-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function createWorkerAttemptRequestId(
  logicalRequestId: string,
  attempt: number
): string {
  return `${logicalRequestId}:webgpu-attempt-${attempt}`
}

export function assertOutputQuality(value: number | undefined): void {
  if (
    value !== undefined
    && (!Number.isFinite(value) || value < 0 || value > 1)
  ) {
    throw new Error('图片导出质量必须在 0～1 之间')
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
