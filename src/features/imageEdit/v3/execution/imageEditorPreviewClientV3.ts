import {
  describeImageEditorV3SourcePyramid,
  prewarmImageEditorV3SourcePyramid,
  readImageEditorV3FastProxy,
} from '@/commands/imageEditorV3'
import { createLogger } from '@/core/logging'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import type { ImageEditRenderQuality } from '@/core/imageEdit/v3/renderNodeDefinition'
import type {
  ImageEditorV3FastProxy,
  ImageEditorV3PyramidDescriptor,
  ImageEditorV3PyramidPrewarmResult,
  ImageEditorV3ResourceDescriptor,
  ImageEditorV3ResourceRef,
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

type ProxyReaderV3 = (
  request: { requestId: string; resourceRef: ImageEditorV3ResourceRef; maxDimension: number },
  signal?: AbortSignal,
) => Promise<ImageEditorV3FastProxy>

type PyramidDescriptorReaderV3 = (
  request: { requestId: string; resourceRef: ImageEditorV3ResourceRef },
  signal?: AbortSignal,
) => Promise<ImageEditorV3PyramidDescriptor>

type PyramidPrewarmerV3 = (
  request: {
    requestId: string
    resourceRef: ImageEditorV3ResourceRef
    minimumMip?: number
    maximumMip?: number
    tileBudget?: number
    bitDepth?: 8 | 16 | 32
  },
  signal?: AbortSignal,
) => Promise<ImageEditorV3PyramidPrewarmResult>

interface PreviewUrlFactoryV3 {
  create(bytes: ArrayBuffer, mediaType: string): string
  revoke(url: string): void
}

export interface ImageEditorPreviewClientOptionsV3 {
  sessionId: string
  workerFactory?: ImageEditorPreviewWorkerFactoryV3
  readFastProxy?: ProxyReaderV3
  describePyramid?: PyramidDescriptorReaderV3
  prewarmPyramid?: PyramidPrewarmerV3
  readBrushTiles?: ImageEditorPreviewBrushTileReaderV3
  urlFactory?: PreviewUrlFactoryV3
  proxyCacheMaxBytes?: number
  brushCacheMaxBytes?: number
  brushTransferMaxBytes?: number
}

interface ScheduledJobV3 extends ImageEditorManagedPreviewRequestV3 {
  requestId: string
  sequence: number
  abortController: AbortController
  posted: boolean
  resolve: (result: ImageEditorManagedPreviewResultV3) => void
  reject: (error: Error) => void
}

const defaultUrlFactory: PreviewUrlFactoryV3 = {
  create: (bytes, mediaType) => URL.createObjectURL(new Blob([bytes], { type: mediaType })),
  revoke: (url) => URL.revokeObjectURL(url),
}

export const IMAGE_EDITOR_PREVIEW_PROXY_CACHE_MAX_BYTES_V3 = 128 * 1024 * 1024
export const IMAGE_EDITOR_PREVIEW_PYRAMID_PREWARM_TILE_BUDGET_V3 = 64
const logger = createLogger('image_editor_v3.preview_client')

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

function abortError(signal: AbortSignal): Error {
  const error = signal.reason instanceof Error
    ? signal.reason
    : new Error('图片预览资源读取已取消')
  if (error.name === 'Error') error.name = 'AbortError'
  return error
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError(signal)
}

async function raceWithAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  throwIfAborted(signal)
  let onAbort: (() => void) | undefined
  const cancelled = new Promise<never>((_, reject) => {
    onAbort = () => reject(abortError(signal))
    signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    return await Promise.race([operation, cancelled])
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort)
  }
}

/** 每个编辑会话独占一个实例：一个 running、一个 latest-pending，绝不形成 FIFO。 */
export class ImageEditorPreviewClientV3 {
  private worker: ImageEditorPreviewWorkerPortV3 | null = null
  private running: ScheduledJobV3 | null = null
  private pending: ScheduledJobV3 | null = null
  private sequence = 0
  private prewarmSequence = 0
  private latestSequence = 0
  private disposed = false
  private readonly proxyCache = new Map<string, ImageEditorV3FastProxy>()
  private proxyCacheBytes = 0
  private readonly proxyCacheMaxBytes: number
  private readonly brushTileLoader: ImageEditorPreviewBrushTileLoaderV3
  private readonly resultLeases = new Set<() => void>()
  private readonly workerFactory: ImageEditorPreviewWorkerFactoryV3
  private readonly proxyReader: ProxyReaderV3
  private readonly pyramidDescriptorReader: PyramidDescriptorReaderV3
  private readonly pyramidPrewarmer: PyramidPrewarmerV3
  private readonly urlFactory: PreviewUrlFactoryV3
  private readonly pyramidPrewarms = new Map<string, AbortController>()
  private readonly startedPyramidPrewarms = new Set<string>()

  constructor(private readonly options: ImageEditorPreviewClientOptionsV3) {
    this.workerFactory = options.workerFactory ?? createDefaultWorker
    this.proxyReader = options.readFastProxy ?? readImageEditorV3FastProxy
    this.pyramidDescriptorReader = options.describePyramid ?? describeImageEditorV3SourcePyramid
    this.pyramidPrewarmer = options.prewarmPyramid ?? prewarmImageEditorV3SourcePyramid
    this.brushTileLoader = new ImageEditorPreviewBrushTileLoaderV3({
      reader: options.readBrushTiles,
      cacheMaxBytes: options.brushCacheMaxBytes,
      transferMaxBytes: options.brushTransferMaxBytes,
    })
    this.urlFactory = options.urlFactory ?? defaultUrlFactory
    this.proxyCacheMaxBytes = options.proxyCacheMaxBytes
      ?? IMAGE_EDITOR_PREVIEW_PROXY_CACHE_MAX_BYTES_V3
    if (!Number.isSafeInteger(this.proxyCacheMaxBytes) || this.proxyCacheMaxBytes < 0) {
      throw new Error('图片预览代理缓存上限必须是非负整数')
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
    this.pending?.reject(error)
    this.running = null
    this.pending = null
    if (this.worker) {
      this.worker.postMessage({ type: 'dispose' })
      this.worker.terminate()
      this.worker = null
    }
    for (const release of [...this.resultLeases]) release()
    for (const controller of this.pyramidPrewarms.values()) controller.abort()
    this.pyramidPrewarms.clear()
    this.startedPyramidPrewarms.clear()
    this.clearProxyCache()
    this.brushTileLoader.dispose()
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
    const worker = this.ensureWorker()
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
    for (const request of proxyRequests) {
      this.startPyramidPrewarm(
        request.resourceId as ImageEditorV3ResourceRef,
        typeof job.document.color.bitDepth === 'number' ? job.document.color.bitDepth : 32,
      )
    }
    const [proxies, brushTiles] = await Promise.all([
      this.loadProxyResources(proxyRequests, job),
      this.brushTileLoader.load(brushRequests, job.document, job.abortController.signal),
    ])
    if (job.abortController.signal.aborted || job.sequence !== this.latestSequence) {
      throw new ImageEditorPreviewSupersededErrorV3()
    }
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

  private async loadProxyResources(
    requests: readonly ImageEditorPreviewProxyResourceRequestV3[],
    job: ScheduledJobV3,
  ): Promise<Array<{
      resourceId: string
      width: number
      height: number
      mediaType: 'image/webp'
      bytes: ArrayBuffer
    }>> {
    return Promise.all(requests.map(async (request) => {
      const key = `${request.resourceId}:${request.maxDimension}`
      let proxy = this.proxyCache.get(key)
      if (proxy) {
        this.proxyCache.delete(key)
        this.proxyCache.set(key, proxy)
      }
      if (!proxy) {
        proxy = await raceWithAbort(this.proxyReader({
          requestId: `${job.requestId}:resource:${request.resourceId.slice(7, 19)}`,
          resourceRef: request.resourceId as ImageEditorV3ResourceRef,
          maxDimension: request.maxDimension,
        }, job.abortController.signal), job.abortController.signal)
        this.insertProxyCache(key, proxy)
      }
      return {
        resourceId: request.resourceId,
        width: proxy.width,
        height: proxy.height,
        mediaType: proxy.mediaType,
        bytes: proxy.bytes.slice(0),
      }
    }))
  }

  private ensureWorker(): ImageEditorPreviewWorkerPortV3 {
    if (this.worker) return this.worker
    const worker = this.workerFactory()
    worker.onmessage = (event) => this.handleWorkerEvent(event.data)
    worker.onerror = (event) => this.handleWorkerFailure(event.message || '图片预览 Worker 异常')
    this.worker = worker
    return worker
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
      job.resolve(event.type === 'rendered-bitmap'
        ? this.leaseBitmap(event.bitmap, event.width, event.height, event.diagnostics)
        : this.leaseBlob(event))
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
  ): ImageEditorManagedPreviewResultV3 {
    const release = this.createLease(() => bitmap.close())
    return { kind: 'bitmap', bitmap, width, height, diagnostics, release }
  }

  private leaseBlob(event: ImageEditorPreviewBlobEventV3): ImageEditorManagedPreviewResultV3 {
    const url = this.urlFactory.create(event.bytes, event.mediaType)
    const release = this.createLease(() => this.urlFactory.revoke(url))
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

  private insertProxyCache(key: string, proxy: ImageEditorV3FastProxy): void {
    this.proxyCache.set(key, proxy)
    this.proxyCacheBytes += proxy.bytes.byteLength
    while (this.proxyCacheBytes > this.proxyCacheMaxBytes && this.proxyCache.size > 0) {
      const oldestKey = this.proxyCache.keys().next().value as string | undefined
      if (!oldestKey) break
      const oldest = this.proxyCache.get(oldestKey)
      this.proxyCache.delete(oldestKey)
      this.proxyCacheBytes -= oldest?.bytes.byteLength ?? 0
    }
  }

  private clearProxyCache(): void {
    this.proxyCache.clear()
    this.proxyCacheBytes = 0
  }

  private startPyramidPrewarm(
    resourceRef: ImageEditorV3ResourceRef,
    bitDepth: 8 | 16 | 32,
  ): void {
    if (this.startedPyramidPrewarms.has(resourceRef)) return
    const controller = new AbortController()
    this.startedPyramidPrewarms.add(resourceRef)
    this.pyramidPrewarms.set(resourceRef, controller)
    const requestPrefix = `${this.options.sessionId}:pyramid:${++this.prewarmSequence}`
    void this.pyramidDescriptorReader({
      requestId: `${requestPrefix}:pyramid-describe`,
      resourceRef,
    }, controller.signal).then((descriptor) => {
      const firstCoarse = descriptor.levels.find((level) => Math.max(level.width, level.height) <= 2_048)
        ?? descriptor.levels.at(-1)
      const last = descriptor.levels.at(-1)
      if (!firstCoarse || !last || controller.signal.aborted) return undefined
      return this.pyramidPrewarmer({
        requestId: `${requestPrefix}:pyramid-prewarm`,
        resourceRef,
        minimumMip: firstCoarse.mip,
        maximumMip: last.mip,
        tileBudget: IMAGE_EDITOR_PREVIEW_PYRAMID_PREWARM_TILE_BUDGET_V3,
        bitDepth,
      }, controller.signal)
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return
      logger.warn('图片源金字塔后台预热失败，继续按需读取', {
        event: 'image_editor_v3.preview.pyramid_prewarm.failed',
        context: {
          resourceRef,
          message: error instanceof Error ? error.message : String(error),
        },
      })
    }).finally(() => {
      if (this.pyramidPrewarms.get(resourceRef) === controller) {
        this.pyramidPrewarms.delete(resourceRef)
      }
    })
  }
}
