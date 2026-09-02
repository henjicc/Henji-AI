import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import { createLogger } from '@/core/logging'
import {
  IMAGE_EDIT_RENDER_PRIORITY,
  ImageEditTaskCancelledError,
  ImageEditTaskSupersededError,
  type ImageEditRenderPurpose,
  type ImageEditRenderScheduler,
  type ImageEditRenderTaskKind,
} from '@/core/imageEdit/v3/renderScheduler'
import {
  type ImageEditMemoryLease,
  type ImageEditResourceBudget,
} from '@/core/imageEdit/v3/resourceBudget'
import type { ImageEditRenderQuality } from '@/core/imageEdit/v3/renderNodeDefinition'
import {
  IMAGE_EDITOR_V3_PACKAGE_THUMBNAIL_MAX_BYTES,
  type ImageEditorV3ResourceDescriptor,
} from '@/platform/contracts/imageEditorV3'
import {
  ImageEditorPreviewBrushTileLoaderV3,
  type ImageEditorPreviewBrushTileReaderV3,
} from './previewBrushTileLoaderV3'
import {
  collectImageEditorPreviewResourceRequestsV3,
  type ImageEditorPreviewBrushResourceRequestV3,
  type ImageEditorPreviewProxyResourceRequestV3,
} from './previewDocumentV3'
import {
  acquireImageEditorResourceLeaseV3,
} from './imageEditorResourcePressureV3'
import {
  ImageEditorPreviewResultOwnerV3,
  type ImageEditorManagedPreviewResultV3,
  type ImageEditorPreviewUrlFactoryV3,
} from './imageEditorPreviewResultLeaseV3'
import {
  acquireImageEditorSessionResourceBudgetV3,
  type ImageEditorSessionResourceBudgetLeaseV3,
} from './imageEditorSessionResourceBudgetV3'
import { getImageEditorGlobalRenderSchedulerV3 } from './imageEditorGlobalRenderSchedulerV3'
import { ImageEditorWorkerCompletionV3 } from './imageEditorWorkerCompletionV3'
import {
  estimateImageEditorPreviewMemoryV3,
  imageEditorPreviewBrushTransferBytesV3,
  imageEditorPreviewOutputBytesV3,
} from './imageEditorPreviewMemoryV3'
import {
  ImageEditorPreviewResourceLoaderV3,
  type ImageEditorPreviewProxyReaderV3,
  type ImageEditorPreviewPyramidDescriptorReaderV3,
  type ImageEditorPreviewPyramidPrewarmerV3,
} from './imageEditorPreviewResourcesV3'
import type {
  ImageEditorPreviewWorkerEventV3,
  ImageEditorPreviewWorkerFactoryV3,
  ImageEditorPreviewWorkerPortV3,
  ImageEditorPreviewWorkerRequestV3,
} from './previewProtocolV3'

const logger = createLogger('image_editor_v3.preview_effect')

export class ImageEditorPreviewSupersededErrorV3 extends Error {
  constructor() {
    super('图片预览已被更新版本取代')
    this.name = 'ImageEditorPreviewSupersededErrorV3'
  }
}

export class ImageEditorPreviewDisposedErrorV3 extends Error {
  constructor() {
    super('图片预览会话已经释放')
    this.name = 'ImageEditorPreviewDisposedErrorV3'
  }
}

export type { ImageEditorManagedPreviewResultV3 } from './imageEditorPreviewResultLeaseV3'

export interface ImageEditorManagedPreviewRequestV3 {
  document: ImageEditDocumentV3
  quality: ImageEditRenderQuality
  maxDimension: number
  resourceDescriptors: readonly ImageEditorV3ResourceDescriptor[]
}

export interface ImageEditorPreviewClientOptionsV3 {
  sessionId: string
  workerFactory?: ImageEditorPreviewWorkerFactoryV3
  readFastProxy?: ImageEditorPreviewProxyReaderV3
  describePyramid?: ImageEditorPreviewPyramidDescriptorReaderV3
  prewarmPyramid?: ImageEditorPreviewPyramidPrewarmerV3
  readBrushTiles?: ImageEditorPreviewBrushTileReaderV3
  urlFactory?: ImageEditorPreviewUrlFactoryV3
  proxyCacheMaxBytes?: number
  brushCacheMaxBytes?: number
  brushTransferMaxBytes?: number
  resourceBudget?: ImageEditResourceBudget
  resourceBudgetConsumerId?: string
  renderScheduler?: ImageEditRenderScheduler
  /** 同一编辑会话内相互独立的画面流，例如 display 与 thumbnail。 */
  coalescingKey?: string
  taskKind?: ImageEditRenderTaskKind
  purpose?: ImageEditRenderPurpose
  priority?: number
  /** display 负责预热；thumbnail 等派生流应关闭，避免重复占用主进程额度。 */
  pyramidPrewarmEnabled?: boolean
}

interface ScheduledJobV3 extends ImageEditorManagedPreviewRequestV3 {
  requestId: string
  sequence: number
  abortController: AbortController
  inputLeases: ImageEditMemoryLease[]
  transferLease: ImageEditMemoryLease | null
  workingLease: ImageEditMemoryLease | null
  outputLease: ImageEditMemoryLease | null
  posted: boolean
  renderTaskId: string
  workerCompletion: ImageEditorWorkerCompletionV3<ImageEditorPreviewWorkerEventV3>
  resolve: (result: ImageEditorManagedPreviewResultV3) => void
  reject: (error: Error) => void
}

let previewClientSequence = 0

export {
  IMAGE_EDITOR_PREVIEW_PROXY_CACHE_MAX_BYTES_V3,
  IMAGE_EDITOR_PREVIEW_PYRAMID_PREWARM_TILE_BUDGET_V3,
} from './imageEditorPreviewResourcesV3'

function createDefaultWorker(): ImageEditorPreviewWorkerPortV3 {
  if (typeof Worker === 'undefined') throw new Error('当前环境不支持图片预览 Worker')
  return new Worker(new URL('./imageEditorPreview.worker.ts', import.meta.url), {
    type: 'module',
    name: 'image-editor-v3-preview',
  })
}

function createRequestId(sessionId: string, flowKey: string, sequence: number): string {
  return `${sessionId}:${flowKey}:preview:${sequence}`
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

function normalizePreviewError(error: unknown): Error {
  return error instanceof ImageEditTaskSupersededError
    || error instanceof ImageEditTaskCancelledError
    ? new ImageEditorPreviewSupersededErrorV3()
    : toError(error)
}

/** 每个编辑会话独占一个实例：一个 running、一个 latest-pending，绝不形成 FIFO。 */
export class ImageEditorPreviewClientV3 {
  private worker: ImageEditorPreviewWorkerPortV3 | null = null
  private running: ScheduledJobV3 | null = null
  private pending: ScheduledJobV3 | null = null
  private sequence = 0
  private latestSequence = 0
  private disposed = false
  private readonly brushTileLoader: ImageEditorPreviewBrushTileLoaderV3
  private readonly resourceLoader: ImageEditorPreviewResourceLoaderV3
  private readonly workerFactory: ImageEditorPreviewWorkerFactoryV3
  private readonly resultOwner: ImageEditorPreviewResultOwnerV3
  private readonly budget: ImageEditResourceBudget
  private readonly renderScheduler: ImageEditRenderScheduler
  private readonly sessionBudgetLease: ImageEditorSessionResourceBudgetLeaseV3 | null

  constructor(private readonly options: ImageEditorPreviewClientOptionsV3) {
    if (!options.sessionId.trim()) throw new Error('图片预览会话 ID 不能为空')
    this.workerFactory = options.workerFactory ?? createDefaultWorker
    this.renderScheduler = options.renderScheduler ?? getImageEditorGlobalRenderSchedulerV3()
    this.brushTileLoader = new ImageEditorPreviewBrushTileLoaderV3({
      reader: options.readBrushTiles,
      cacheMaxBytes: options.brushCacheMaxBytes,
      transferMaxBytes: options.brushTransferMaxBytes,
    })
    this.sessionBudgetLease = options.resourceBudget
      ? null
      : acquireImageEditorSessionResourceBudgetV3(options.sessionId, {
          consumerId: options.resourceBudgetConsumerId
            ?? `managed-preview:${++previewClientSequence}`,
        })
    this.budget = options.resourceBudget ?? this.sessionBudgetLease!.budget
    this.resultOwner = new ImageEditorPreviewResultOwnerV3(this.budget, options.urlFactory)
    try {
      this.resourceLoader = new ImageEditorPreviewResourceLoaderV3({
        sessionId: options.sessionId,
        budget: this.budget,
        proxyReader: options.readFastProxy,
        pyramidDescriptorReader: options.describePyramid,
        pyramidPrewarmer: options.prewarmPyramid,
        proxyCacheMaxBytes: options.proxyCacheMaxBytes,
        requestIdScope: options.coalescingKey ?? 'display',
        pyramidPrewarmEnabled: options.pyramidPrewarmEnabled,
      })
    } catch (error) {
      this.sessionBudgetLease?.release()
      throw error
    }
  }

  render(request: ImageEditorManagedPreviewRequestV3): Promise<ImageEditorManagedPreviewResultV3> {
    if (this.disposed) return Promise.reject(new ImageEditorPreviewDisposedErrorV3())
    const sequence = ++this.sequence
    this.latestSequence = sequence
    return new Promise((resolve, reject) => {
      const requestId = createRequestId(
        this.options.sessionId,
        this.options.coalescingKey ?? 'display',
        sequence,
      )
      const job: ScheduledJobV3 = {
        ...request,
        requestId,
        sequence,
        abortController: new AbortController(),
        inputLeases: [],
        transferLease: null,
        workingLease: null,
        outputLease: null,
        posted: false,
        renderTaskId: `${requestId}:worker-frame`,
        workerCompletion: new ImageEditorWorkerCompletionV3(),
        resolve,
        reject,
      }
      if (!this.running) {
        this.start(job)
        return
      }
      this.replacePending(job)
      this.running.abortController.abort()
      this.renderScheduler.cancelTask(this.running.renderTaskId)
    })
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    const error = new ImageEditorPreviewDisposedErrorV3()
    this.running?.abortController.abort()
    if (this.running) this.renderScheduler.cancelTask(this.running.renderTaskId)
    this.running?.reject(error)
    if (this.running) this.releaseJobResources(this.running)
    this.pending?.reject(error)
    this.running = null
    this.pending = null
    if (this.worker) {
      this.worker.postMessage({ type: 'dispose' })
      this.worker.terminate()
      this.worker = null
    }
    this.resultOwner.dispose()
    this.resourceLoader.dispose()
    this.brushTileLoader.dispose()
    this.sessionBudgetLease?.release()
  }

  private replacePending(job: ScheduledJobV3): void {
    this.pending?.reject(new ImageEditorPreviewSupersededErrorV3())
    this.pending = job
  }

  private start(job: ScheduledJobV3): void {
    this.running = job
    void this.prepareAndPost(job).catch((error: unknown) => {
      if (this.running !== job) return
      job.abortController.abort(error)
      const normalized = job.sequence === this.latestSequence
        ? normalizePreviewError(error)
        : new ImageEditorPreviewSupersededErrorV3()
      job.reject(normalized)
      this.finish(job)
    })
  }

  private async prepareAndPost(job: ScheduledJobV3): Promise<void> {
    const memory = estimateImageEditorPreviewMemoryV3(job.document, job.maxDimension)
    job.outputLease = acquireImageEditorResourceLeaseV3(
      this.budget,
      'managed-preview',
      'gpu',
      memory.outputBytes,
      'lower-mip',
    )
    job.workingLease = acquireImageEditorResourceLeaseV3(
      this.budget,
      'managed-preview',
      'in-flight',
      memory.workingBytes,
      'lower-mip',
    )
    const requests = collectImageEditorPreviewResourceRequestsV3(
      job.document,
      job.maxDimension,
      job.resourceDescriptors,
    )
    const proxyRequests = requests.filter(
      (request): request is ImageEditorPreviewProxyResourceRequestV3 => request.kind === 'image-proxy',
    )
    const brushRequests = requests.filter(
      (request): request is ImageEditorPreviewBrushResourceRequestV3 => request.kind === 'brush-tile',
    )
    const loaded = await this.resourceLoader.load(
      proxyRequests,
      job.requestId,
      typeof job.document.color.bitDepth === 'number' ? job.document.color.bitDepth : 32,
      job.abortController.signal,
    )
    job.inputLeases.push(...loaded.transientLeases)
    const sourceProxies = loaded.proxies
    this.assertActive(job)
    const transferBytes = sourceProxies.reduce(
      (total, proxy) => total + proxy.bytes.byteLength,
      imageEditorPreviewBrushTransferBytesV3(brushRequests),
    )
    if (!Number.isSafeInteger(transferBytes)) {
      throw new Error('图片预览 Worker 传输字节数超出安全整数范围')
    }
    job.transferLease = acquireImageEditorResourceLeaseV3(
      this.budget,
      'managed-preview',
      'transfer',
      transferBytes,
      'lower-mip',
    )
    const [proxies, brushTiles] = await Promise.all([
      Promise.resolve(sourceProxies.map((proxy) => ({
        resourceId: proxy.resourceRef,
        width: proxy.width,
        height: proxy.height,
        mediaType: proxy.mediaType,
        bytes: proxy.bytes.slice(0),
      }))),
      this.brushTileLoader.load(brushRequests, job.document, job.abortController.signal),
    ])
    this.assertActive(job)
    const event = await this.renderScheduler.schedule<ImageEditorPreviewWorkerEventV3>({
      id: job.renderTaskId,
      sessionId: this.options.sessionId,
      coalescingKey: this.options.coalescingKey ?? 'display',
      revision: job.document.revision,
      kind: this.options.taskKind ?? 'preview',
      purpose: this.options.purpose ?? 'display',
      lane: 'gpu',
      priority: this.options.priority ?? (job.quality === 'draft'
        ? IMAGE_EDIT_RENDER_PRIORITY.interactionDraft
        : IMAGE_EDIT_RENDER_PRIORITY.viewportStable),
      run: ({ signal }) => this.postWorkerAndWait(job, {
        type: 'render',
        requestId: job.requestId,
        sequence: job.sequence,
        sessionId: this.options.sessionId,
        document: job.document,
        quality: job.quality,
        maxDimension: job.maxDimension,
        proxies,
        brushTiles,
      }, [
        ...proxies.map((proxy) => proxy.bytes),
        ...brushTiles.map((tile) => tile.bytes),
      ], signal),
    })
    this.assertActive(job)
    this.completeWorkerEvent(job, event)
  }

  private postWorkerAndWait(
    job: ScheduledJobV3,
    request: Extract<ImageEditorPreviewWorkerRequestV3, { type: 'render' }>,
    transfer: Transferable[],
    schedulerSignal: AbortSignal,
  ): Promise<ImageEditorPreviewWorkerEventV3> {
    return job.workerCompletion.wait({
      signals: [schedulerSignal, job.abortController.signal],
      onAbort: () => {
        if (job.posted) this.terminateWorkerForSupersededJob(job)
      },
      fallbackAbortError: () => new ImageEditorPreviewSupersededErrorV3(),
      start: () => {
        const worker = this.ensureWorker()
        job.posted = true
        worker.postMessage(request, transfer)
      },
    })
  }

  private ensureWorker(): ImageEditorPreviewWorkerPortV3 {
    if (this.worker) return this.worker
    const worker = this.workerFactory()
    worker.onmessage = (event) => this.handleWorkerEvent(event.data)
    worker.onerror = (event) => this.handleWorkerFailure(event.message || '图片预览 Worker 异常')
    this.worker = worker
    return worker
  }

  /**
   * CPU 模糊等同步内核无法在 Worker 消息循环里处理中途 cancel。继续复用该 Worker
   * 会让最新滑杆值排在旧帧后面；终止专属 Worker 才是真正的抢占。
   */
  private terminateWorkerForSupersededJob(job: ScheduledJobV3): void {
    if (this.running !== job || !job.posted || !this.worker) return
    this.worker.terminate()
    this.worker = null
    job.posted = false
  }

  private assertActive(job: ScheduledJobV3): void {
    if (
      this.disposed
      || this.running !== job
      || job.abortController.signal.aborted
      || job.sequence !== this.latestSequence
    ) throw new ImageEditorPreviewSupersededErrorV3()
  }

  private handleWorkerEvent(event: ImageEditorPreviewWorkerEventV3): void {
    const job = this.running
    if (!job || event.requestId !== job.requestId) {
      this.releaseEventPayload(event)
      return
    }
    if (!job.workerCompletion.resolve(event)) {
      this.releaseEventPayload(event)
    }
  }

  private completeWorkerEvent(job: ScheduledJobV3, event: ImageEditorPreviewWorkerEventV3): void {
    if (event.sequence !== job.sequence) {
      this.releaseEventPayload(event)
      throw new ImageEditorPreviewSupersededErrorV3()
    }
    if (event.type === 'failed') {
      throw event.code === 'aborted' || job.sequence !== this.latestSequence
        ? new ImageEditorPreviewSupersededErrorV3()
        : new Error(event.message)
    }
    if (job.sequence !== this.latestSequence) {
      this.releaseEventPayload(event)
      throw new ImageEditorPreviewSupersededErrorV3()
    }
    if (event.execution
      && event.execution.fastBlurVgpuPasses + event.execution.fastBlurCpuPasses > 0) {
      logger.debug('图片编辑模糊预览完成', {
        event: 'image_editor_v3.fast_blur.preview.completed',
        requestId: event.requestId,
        context: {
          backend: event.execution.fastBlurVgpuPasses > 0 ? 'vgpu' : 'cpu',
          vgpuPasses: event.execution.fastBlurVgpuPasses,
          cpuPasses: event.execution.fastBlurCpuPasses,
          fallbackReasons: event.execution.fastBlurFallbackReasons,
        },
      })
    }
    try {
      if (event.thumbnail && (!(event.thumbnail.bytes instanceof ArrayBuffer)
        || event.thumbnail.mediaType !== 'image/png'
        || !Number.isSafeInteger(event.thumbnail.width)
        || !Number.isSafeInteger(event.thumbnail.height)
        || event.thumbnail.width < 1
        || event.thumbnail.height < 1
        || event.thumbnail.width > 512
        || event.thumbnail.height > 512
        || event.thumbnail.bytes.byteLength < 1
        || event.thumbnail.bytes.byteLength > IMAGE_EDITOR_V3_PACKAGE_THUMBNAIL_MAX_BYTES)) {
        throw new Error('图片预览 Worker 返回了无效或过大的包缩略图')
      }
      const reservedOutput = job.outputLease
      if (!reservedOutput) throw new Error('图片预览成品缺少预留资源')
      const actualOutputBytes = imageEditorPreviewOutputBytesV3(event.width, event.height)
      if (actualOutputBytes > reservedOutput.bytes) {
        throw new Error('图片预览 Worker 返回的成品超过预留资源')
      }
      job.outputLease = null
      job.resolve(event.type === 'rendered-bitmap'
        ? this.resultOwner.leaseBitmap(
            event.bitmap,
            event.width,
            event.height,
            event.diagnostics,
            event.thumbnail,
            reservedOutput,
          )
        : this.resultOwner.leaseBlob(event, reservedOutput))
    } catch (error) {
      this.releaseEventPayload(event)
      throw error
    }
    this.finish(job)
  }

  private handleWorkerFailure(message: string): void {
    const job = this.running
    this.worker?.terminate()
    this.worker = null
    if (!job) return
    job.workerCompletion.reject(new Error(message))
  }

  private finish(job: ScheduledJobV3): void {
    if (this.running !== job) return
    this.releaseJobResources(job)
    this.running = null
    const next = this.pending
    this.pending = null
    if (next && !this.disposed) this.start(next)
  }

  private releaseEventPayload(event: ImageEditorPreviewWorkerEventV3): void {
    if (event.type === 'rendered-bitmap') event.bitmap.close()
  }

  private releaseJobResources(job: ScheduledJobV3): void {
    for (const lease of job.inputLeases.splice(0)) lease.release()
    job.transferLease?.release()
    job.transferLease = null
    job.workingLease?.release()
    job.workingLease = null
    job.outputLease?.release()
    job.outputLease = null
  }

}
