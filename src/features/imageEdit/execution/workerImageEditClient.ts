import {
  isImageEditWorkerEvent,
  type ImageEditExportFormat,
  type ImageEditWorkerCapabilities,
  type ImageEditWorkerComposition,
  type ImageEditWorkerEvent,
  type ImageEditWorkerRequest,
  type ImageEditWorkerSource,
} from '@/core/imageEdit/worker/protocol'
import type { DiffusionRecipe } from '@/core/imageEdit/diffusionRecipe'
import type { VgpuGlowRecipe } from '@/core/imageEdit/vgpuGlowRecipe'
import { createLogger } from '@/core/logging'
import { toFetchableMediaUrl } from '@/services/imageSource'
import { PreviewRevisionTracker } from '@/core/imageEdit/worker/previewRevisionTracker'

const logger = createLogger('features.imageEdit.worker')

interface WorkerLike {
  postMessage(message: ImageEditWorkerRequest): void
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void
  removeEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void
  terminate(): void
}

interface PendingRequest<T> {
  resolve: (value: T) => void
  reject: (reason: Error) => void
}

export interface WorkerImageEditPreviewResult {
  bitmap: ImageBitmap
  revision: number
  width: number
  height: number
  durationMs: number
}

export interface WorkerImageEditPreviewOptions {
  requestId?: string
  previewScopeId?: string
}

export interface WorkerImageEditExportResult {
  bytes: Uint8Array
  format: ImageEditExportFormat
  width: number
  height: number
  durationMs: number
  revision?: number
}

export interface WorkerImageEditExportOptions {
  requestId?: string
  format: ImageEditExportFormat
  quality?: number
  renderQuality?: 'realtime' | 'high'
  revision?: number
  recipe?: DiffusionRecipe
  vgpuGlowRecipe?: VgpuGlowRecipe
  composition?: ImageEditWorkerComposition
  tileSize?: number
  halo?: number
  globalScatterMaxDimension?: number
  onProgress?: (completedTiles: number, totalTiles: number) => void
}

export class WorkerImageEditClient {
  private readonly worker: WorkerLike
  private readonly pendingCapabilities = new Map<
    string,
    PendingRequest<ImageEditWorkerCapabilities>
  >()
  private readonly pendingPreviews = new Map<
    string,
    PendingRequest<WorkerImageEditPreviewResult>
  >()
  private readonly pendingExports = new Map<
    string,
    PendingRequest<WorkerImageEditExportResult>
  >()
  private readonly exportProgress = new Map<
    string,
    NonNullable<WorkerImageEditExportOptions['onProgress']>
  >()
  private readonly previewRevisions = new PreviewRevisionTracker()
  private readonly pendingPreviewScopes = new Map<string, string>()
  private destroyed = false

  constructor(workerFactory: () => WorkerLike = createDefaultWorker) {
    this.worker = workerFactory()
    this.worker.addEventListener('message', this.handleMessage)
  }

  initialize(recoverDevice = false): Promise<ImageEditWorkerCapabilities> {
    this.assertActive()
    const requestId = createRequestId('initialize')
    logger.debug('image_edit.worker.initialize.start', { requestId })
    const promise = createPendingPromise(this.pendingCapabilities, requestId)
    this.worker.postMessage({ type: 'initialize', requestId, recoverDevice })
    return promise
  }

  preview(
    source: ImageEditWorkerSource,
    revision: number,
    maxPixels?: number,
    recipe?: DiffusionRecipe,
    vgpuGlowRecipe?: VgpuGlowRecipe,
    composition?: ImageEditWorkerComposition,
    options: WorkerImageEditPreviewOptions = {}
  ): Promise<WorkerImageEditPreviewResult> {
    this.assertActive()
    const requestId = options.requestId ?? createRequestId('preview')
    const resolvedPreviewScopeId = options.previewScopeId ?? requestId
    this.previewRevisions.register(resolvedPreviewScopeId, revision)
    this.pendingPreviewScopes.set(requestId, resolvedPreviewScopeId)
    logger.debug('image_edit.worker.preview.start', {
      requestId,
      revision,
      previewScopeId: resolvedPreviewScopeId,
    })
    const promise = createPendingPromise(this.pendingPreviews, requestId)
    this.worker.postMessage({
      type: 'preview',
      requestId,
      previewScopeId: resolvedPreviewScopeId,
      revision,
      source: normalizeWorkerSource(source),
      recipe,
      vgpuGlowRecipe,
      composition,
      maxPixels,
    })
    return promise
  }

  export(
    source: ImageEditWorkerSource,
    options: WorkerImageEditExportOptions
  ): { requestId: string; result: Promise<WorkerImageEditExportResult> } {
    this.assertActive()
    const requestId = options.requestId ?? createRequestId('export')
    logger.info('image_edit.worker.export.start', {
      requestId,
      format: options.format,
      tileSize: options.tileSize,
    })
    const result = createPendingPromise(this.pendingExports, requestId)
    if (options.onProgress) this.exportProgress.set(requestId, options.onProgress)
    this.worker.postMessage({
      type: 'export',
      requestId,
      revision: options.revision,
      source: normalizeWorkerSource(source),
      recipe: options.recipe,
      vgpuGlowRecipe: options.vgpuGlowRecipe,
      composition: options.composition,
      renderQuality: options.renderQuality,
      format: options.format,
      quality: options.quality,
      tileSize: options.tileSize,
      halo: options.halo,
      globalScatterMaxDimension: options.globalScatterMaxDimension,
    })
    return { requestId, result }
  }

  cancel(requestId: string): void {
    if (this.destroyed) return
    logger.info('image_edit.worker.request.cancelled', { requestId })
    this.worker.postMessage({ type: 'cancel', requestId })
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.worker.postMessage({ type: 'destroy' })
    this.worker.removeEventListener('message', this.handleMessage)
    this.worker.terminate()
    const error = new Error('图片编辑 Worker 客户端已销毁')
    rejectAll(this.pendingCapabilities, error)
    rejectAll(this.pendingPreviews, error)
    rejectAll(this.pendingExports, error)
    this.pendingPreviewScopes.clear()
    this.previewRevisions.clear()
    this.exportProgress.clear()
  }

  private readonly handleMessage = (message: MessageEvent<unknown>): void => {
    if (!isImageEditWorkerEvent(message.data)) return
    const event = message.data
    switch (event.type) {
      case 'capabilities':
        logger.info('image_edit.worker.initialize.completed', {
          requestId: event.requestId,
          available: event.capabilities.available,
          adapterName: event.capabilities.adapterName,
          backend: event.capabilities.backend,
          isFallbackAdapter: event.capabilities.isFallbackAdapter,
          limits: event.capabilities.available
            ? event.capabilities.limits
            : undefined,
          initializationFailureCode: event.capabilities.initializationFailure?.code,
          initializationFailureDetail: event.capabilities.initializationFailure?.detail,
          reason: event.capabilities.reason,
        })
        settleSuccess(this.pendingCapabilities, event.requestId, event.capabilities)
        return
      case 'preview-completed':
        this.handlePreviewCompleted(event)
        return
      case 'export-progress':
        logger.debug('image_edit.worker.export.progress', {
          requestId: event.requestId,
          completedTiles: event.completedTiles,
          totalTiles: event.totalTiles,
        })
        this.exportProgress.get(event.requestId)?.(
          event.completedTiles,
          event.totalTiles
        )
        return
      case 'export-completed':
        logger.info('image_edit.worker.export.completed', {
          requestId: event.requestId,
          format: event.format,
          width: event.width,
          height: event.height,
          durationMs: event.durationMs,
          revision: event.revision,
        })
        this.exportProgress.delete(event.requestId)
        settleSuccess(this.pendingExports, event.requestId, {
          bytes: event.bytes,
          format: event.format,
          width: event.width,
          height: event.height,
          durationMs: event.durationMs,
        })
        return
      case 'cancelled':
        logger.info('image_edit.worker.request.cancelled', {
          requestId: event.requestId,
        })
        this.rejectRequest(event.requestId, new Error('图片编辑任务已取消'))
        return
      case 'error':
        logger.error('image_edit.worker.request.failed', {
          requestId: event.requestId,
          code: event.code,
          recoverable: event.recoverable,
          error: event.message,
        })
        if (event.requestId) {
          this.rejectRequest(
            event.requestId,
            new Error(`[${event.code}] ${event.message}`)
          )
        }
        return
      case 'device-lost':
        logger.warn('image_edit.worker.device.lost', {
          reason: event.reason,
          recoverable: event.recoverable,
        })
        this.rejectAllGpuRequests(new Error(`WebGPU 设备丢失：${event.reason}`))
    }
  }

  private handlePreviewCompleted(
    event: Extract<ImageEditWorkerEvent, { type: 'preview-completed' }>
  ): void {
    const previewScopeId = this.pendingPreviewScopes.get(event.requestId)
    if (!previewScopeId) {
      event.bitmap.close()
      return
    }
    if (this.previewRevisions.isStale(previewScopeId, event.revision)) {
      event.bitmap.close()
      settleFailure(
        this.pendingPreviews,
        event.requestId,
        new DOMException(`预览 revision ${event.revision} 已过期`, 'AbortError')
      )
      this.finishPreviewRequest(event.requestId)
      return
    }
    logger.debug('image_edit.worker.preview.completed', {
      requestId: event.requestId,
      revision: event.revision,
      width: event.width,
      height: event.height,
      durationMs: event.durationMs,
    })
    settleSuccess(this.pendingPreviews, event.requestId, {
      bitmap: event.bitmap,
      revision: event.revision,
      width: event.width,
      height: event.height,
      durationMs: event.durationMs,
    })
    this.finishPreviewRequest(event.requestId)
  }

  private rejectRequest(requestId: string, error: Error): void {
    this.exportProgress.delete(requestId)
    settleFailure(this.pendingCapabilities, requestId, error)
    settleFailure(this.pendingPreviews, requestId, error)
    settleFailure(this.pendingExports, requestId, error)
    this.finishPreviewRequest(requestId)
  }

  private rejectAllGpuRequests(error: Error): void {
    rejectAll(this.pendingCapabilities, error)
    rejectAll(this.pendingPreviews, error)
    rejectAll(this.pendingExports, error)
    this.pendingPreviewScopes.clear()
    this.previewRevisions.clear()
    this.exportProgress.clear()
  }

  private finishPreviewRequest(requestId: string): void {
    const previewScopeId = this.pendingPreviewScopes.get(requestId)
    if (!previewScopeId) return
    this.pendingPreviewScopes.delete(requestId)
    this.previewRevisions.complete(previewScopeId)
  }

  private assertActive(): void {
    if (this.destroyed) throw new Error('图片编辑 Worker 客户端已销毁')
  }
}

function createDefaultWorker(): WorkerLike {
  return new Worker(
    new URL('../../../core/imageEdit/worker/imageEditWorker.ts', import.meta.url),
    { type: 'module', name: 'henji-image-edit-webgpu' }
  )
}

/**
 * Worker 只能靠 fetch 读源图，而 fetch 不认 `file://` 和 `D:\...` 这类裸本地路径
 * （两者都直接抛 "Failed to fetch"）。这里是渲染层交给 Worker 的唯一收口，
 * 在此统一转换，调用方不需要、也不应该各自记得先转一次。
 */
function normalizeWorkerSource(source: ImageEditWorkerSource): ImageEditWorkerSource {
  if (source.kind !== 'url') return source
  return { ...source, url: toFetchableMediaUrl(source.url) }
}

function createRequestId(prefix: string): string {
  const suffix = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${prefix}-${suffix}`
}

function createPendingPromise<T>(
  map: Map<string, PendingRequest<T>>,
  requestId: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    map.set(requestId, { resolve, reject })
  })
}

function settleSuccess<T>(
  map: Map<string, PendingRequest<T>>,
  requestId: string,
  value: T
): void {
  const pending = map.get(requestId)
  if (!pending) return
  map.delete(requestId)
  pending.resolve(value)
}

function settleFailure<T>(
  map: Map<string, PendingRequest<T>>,
  requestId: string,
  error: Error
): void {
  const pending = map.get(requestId)
  if (!pending) return
  map.delete(requestId)
  pending.reject(error)
}

function rejectAll<T>(
  map: Map<string, PendingRequest<T>>,
  error: Error
): void {
  for (const pending of map.values()) pending.reject(error)
  map.clear()
}
