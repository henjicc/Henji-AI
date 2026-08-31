import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import {
  type ImageEditMemoryLease,
  type ImageEditResourceBudget,
} from '@/core/imageEdit/v3/resourceBudget'
import type { ImageEditRenderQuality } from '@/core/imageEdit/v3/renderNodeDefinition'
import type { ImageEditorV3ResourceDescriptor } from '@/platform/contracts/imageEditorV3'
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
  acquireImageEditorSessionResourceBudgetV3,
  type ImageEditorSessionResourceBudgetLeaseV3,
} from './imageEditorSessionResourceBudgetV3'
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
  ImageEditorPreviewBlobEventV3,
  ImageEditorPreviewWorkerEventV3,
  ImageEditorPreviewWorkerFactoryV3,
  ImageEditorPreviewWorkerPortV3,
} from './previewProtocolV3'

export class ImageEditorPreviewSupersededErrorV3 extends Error {
  constructor() {
    super('图片预览已被更新版本取代')
    this.name = 'ImageEditorPreviewSupersededErrorV3'
  }
}

export type ImageEditorManagedPreviewResultV3 =
  | {
      kind: 'bitmap'
      bitmap: ImageBitmap
      width: number
      height: number
      diagnostics: string[]
      release: () => void
    }
  | {
      kind: 'url'
      url: string
      width: number
      height: number
      diagnostics: string[]
      release: () => void
    }

export interface ImageEditorManagedPreviewRequestV3 {
  document: ImageEditDocumentV3
  quality: ImageEditRenderQuality
  maxDimension: number
  resourceDescriptors: readonly ImageEditorV3ResourceDescriptor[]
}

interface PreviewUrlFactoryV3 {
  create(bytes: ArrayBuffer, mediaType: string): string
  revoke(url: string): void
}

export interface ImageEditorPreviewClientOptionsV3 {
  sessionId: string
  workerFactory?: ImageEditorPreviewWorkerFactoryV3
  readFastProxy?: ImageEditorPreviewProxyReaderV3
  describePyramid?: ImageEditorPreviewPyramidDescriptorReaderV3
  prewarmPyramid?: ImageEditorPreviewPyramidPrewarmerV3
  readBrushTiles?: ImageEditorPreviewBrushTileReaderV3
  urlFactory?: PreviewUrlFactoryV3
  proxyCacheMaxBytes?: number
  brushCacheMaxBytes?: number
  brushTransferMaxBytes?: number
  resourceBudget?: ImageEditResourceBudget
  resourceBudgetConsumerId?: string
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
  resolve: (result: ImageEditorManagedPreviewResultV3) => void
  reject: (error: Error) => void
}

const defaultUrlFactory: PreviewUrlFactoryV3 = {
  create: (bytes, mediaType) => URL.createObjectURL(new Blob([bytes], { type: mediaType })),
  revoke: (url) => URL.revokeObjectURL(url),
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

function createRequestId(sessionId: string, sequence: number): string {
  return `${sessionId}:preview:${sequence}`
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
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
  private readonly resultLeases = new Set<() => void>()
  private readonly workerFactory: ImageEditorPreviewWorkerFactoryV3
  private readonly urlFactory: PreviewUrlFactoryV3
  private readonly budget: ImageEditResourceBudget
  private readonly sessionBudgetLease: ImageEditorSessionResourceBudgetLeaseV3 | null

  constructor(private readonly options: ImageEditorPreviewClientOptionsV3) {
    if (!options.sessionId.trim()) throw new Error('图片预览会话 ID 不能为空')
    this.workerFactory = options.workerFactory ?? createDefaultWorker
    this.brushTileLoader = new ImageEditorPreviewBrushTileLoaderV3({
      reader: options.readBrushTiles,
      cacheMaxBytes: options.brushCacheMaxBytes,
      transferMaxBytes: options.brushTransferMaxBytes,
    })
    this.urlFactory = options.urlFactory ?? defaultUrlFactory
    this.sessionBudgetLease = options.resourceBudget
      ? null
      : acquireImageEditorSessionResourceBudgetV3(options.sessionId, {
          consumerId: options.resourceBudgetConsumerId
            ?? `managed-preview:${++previewClientSequence}`,
        })
    this.budget = options.resourceBudget ?? this.sessionBudgetLease!.budget
    try {
      this.resourceLoader = new ImageEditorPreviewResourceLoaderV3({
        sessionId: options.sessionId,
        budget: this.budget,
        proxyReader: options.readFastProxy,
        pyramidDescriptorReader: options.describePyramid,
        pyramidPrewarmer: options.prewarmPyramid,
        proxyCacheMaxBytes: options.proxyCacheMaxBytes,
      })
    } catch (error) {
      this.sessionBudgetLease?.release()
      throw error
    }
  }

  render(request: ImageEditorManagedPreviewRequestV3): Promise<ImageEditorManagedPreviewResultV3> {
    if (this.disposed) return Promise.reject(new Error('图片预览会话已经释放'))
    const sequence = ++this.sequence
    this.latestSequence = sequence
    return new Promise((resolve, reject) => {
      const job: ScheduledJobV3 = {
        ...request,
        requestId: createRequestId(this.options.sessionId, sequence),
        sequence,
        abortController: new AbortController(),
        inputLeases: [],
        transferLease: null,
        workingLease: null,
        outputLease: null,
        posted: false,
        resolve,
        reject,
      }
      if (!this.running) {
        this.start(job)
        return
      }
      this.replacePending(job)
      this.running.abortController.abort()
      if (this.running.posted) {
        this.worker?.postMessage({ type: 'cancel', requestId: this.running.requestId })
      }
    })
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    const error = new Error('图片预览会话已经释放')
    this.running?.abortController.abort()
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
    for (const release of [...this.resultLeases]) release()
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
        ? toError(error)
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
    const worker = this.ensureWorker()
    job.posted = true
    worker.postMessage({
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
    ])
  }

  private ensureWorker(): ImageEditorPreviewWorkerPortV3 {
    if (this.worker) return this.worker
    const worker = this.workerFactory()
    worker.onmessage = (event) => this.handleWorkerEvent(event.data)
    worker.onerror = (event) => this.handleWorkerFailure(event.message || '图片预览 Worker 异常')
    this.worker = worker
    return worker
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
    if (event.sequence !== job.sequence) {
      this.releaseEventPayload(event)
      job.reject(new ImageEditorPreviewSupersededErrorV3())
      this.finish(job)
      return
    }
    if (event.type === 'failed') {
      const error = event.code === 'aborted' || job.sequence !== this.latestSequence
        ? new ImageEditorPreviewSupersededErrorV3()
        : new Error(event.message)
      job.reject(error)
      this.finish(job)
      return
    }
    if (job.sequence !== this.latestSequence) {
      this.releaseEventPayload(event)
      job.reject(new ImageEditorPreviewSupersededErrorV3())
      this.finish(job)
      return
    }
    try {
      const reservedOutput = job.outputLease
      if (!reservedOutput) throw new Error('图片预览成品缺少预留资源')
      const actualOutputBytes = imageEditorPreviewOutputBytesV3(event.width, event.height)
      if (actualOutputBytes > reservedOutput.bytes) {
        throw new Error('图片预览 Worker 返回的成品超过预留资源')
      }
      job.outputLease = null
      job.resolve(event.type === 'rendered-bitmap'
        ? this.leaseBitmap(event.bitmap, event.width, event.height, event.diagnostics, reservedOutput)
        : this.leaseBlob(event, reservedOutput))
    } catch (error) {
      this.releaseEventPayload(event)
      job.reject(toError(error))
    }
    this.finish(job)
  }

  private handleWorkerFailure(message: string): void {
    const job = this.running
    this.worker?.terminate()
    this.worker = null
    if (!job) return
    job.reject(new Error(message))
    this.finish(job)
  }

  private finish(job: ScheduledJobV3): void {
    if (this.running !== job) return
    this.releaseJobResources(job)
    this.running = null
    const next = this.pending
    this.pending = null
    if (next && !this.disposed) this.start(next)
  }

  private leaseBitmap(
    bitmap: ImageBitmap,
    width: number,
    height: number,
    diagnostics: string[],
    outputLease: ImageEditMemoryLease,
  ): ImageEditorManagedPreviewResultV3 {
    const release = this.createLease(() => {
      bitmap.close()
      outputLease.release()
    })
    return { kind: 'bitmap', bitmap, width, height, diagnostics, release }
  }

  private leaseBlob(
    event: ImageEditorPreviewBlobEventV3,
    outputLease: ImageEditMemoryLease,
  ): ImageEditorManagedPreviewResultV3 {
    let blobLease: ImageEditMemoryLease | null = null
    let url: string
    try {
      blobLease = acquireImageEditorResourceLeaseV3(
        this.budget,
        'managed-preview',
        'cpu-cache',
        event.bytes.byteLength,
        'lower-mip',
      )
      url = this.urlFactory.create(event.bytes, event.mediaType)
    } catch (error) {
      blobLease?.release()
      outputLease.release()
      throw error
    }
    const release = this.createLease(() => {
      this.urlFactory.revoke(url)
      blobLease.release()
      outputLease.release()
    })
    return { kind: 'url', url, width: event.width, height: event.height, diagnostics: event.diagnostics, release }
  }

  private createLease(dispose: () => void): () => void {
    let released = false
    const release = (): void => {
      if (released) return
      released = true
      this.resultLeases.delete(release)
      dispose()
    }
    this.resultLeases.add(release)
    return release
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
