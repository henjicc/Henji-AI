import {
  describeImageEditorV3SourcePyramid,
  prewarmImageEditorV3SourcePyramid,
  readImageEditorV3FastProxy,
} from '@/commands/imageEditorV3'
import { createLogger } from '@/core/logging'
import type {
  ImageEditMemoryLease,
  ImageEditResourceBudget,
} from '@/core/imageEdit/v3/resourceBudget'
import type {
  ImageEditorV3FastProxy,
  ImageEditorV3PyramidDescriptor,
  ImageEditorV3PyramidPrewarmResult,
  ImageEditorV3ResourceRef,
} from '@/platform/contracts/imageEditorV3'
import { acquireImageEditorResourceLeaseV3 } from './imageEditorResourcePressureV3'
import type { ImageEditorPreviewProxyResourceRequestV3 } from './previewDocumentV3'

export type ImageEditorPreviewProxyReaderV3 = (
  request: { requestId: string; resourceRef: ImageEditorV3ResourceRef; maxDimension: number },
  signal?: AbortSignal,
) => Promise<ImageEditorV3FastProxy>

export type ImageEditorPreviewPyramidDescriptorReaderV3 = (
  request: { requestId: string; resourceRef: ImageEditorV3ResourceRef },
  signal?: AbortSignal,
) => Promise<ImageEditorV3PyramidDescriptor>

export type ImageEditorPreviewPyramidPrewarmerV3 = (
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

interface CachedPreviewProxyV3 {
  proxy: ImageEditorV3FastProxy
  lease: ImageEditMemoryLease
}

interface InFlightPreviewProxyV3 {
  controller: AbortController
  promise: Promise<{ proxy: ImageEditorV3FastProxy; cached: boolean }>
}

function assertValidPreviewProxyV3(
  proxy: ImageEditorV3FastProxy,
  resourceId: string,
): void {
  if (!proxy || typeof proxy !== 'object') {
    throw new Error(`图片预览代理返回值无效：${resourceId}`)
  }
  if (!(proxy.bytes instanceof ArrayBuffer)) {
    const fields = Object.keys(proxy as unknown as Record<string, unknown>).sort().join(',')
    throw new Error(`图片预览代理缺少 ArrayBuffer 字节：${resourceId}（字段：${fields || '无'}）`)
  }
  if (proxy.bytes.byteLength < 1) {
    throw new Error(`图片预览代理字节为空：${resourceId}`)
  }
}

export interface ImageEditorPreviewResourceLoaderOptionsV3 {
  sessionId: string
  budget: ImageEditResourceBudget
  proxyReader?: ImageEditorPreviewProxyReaderV3
  pyramidDescriptorReader?: ImageEditorPreviewPyramidDescriptorReaderV3
  pyramidPrewarmer?: ImageEditorPreviewPyramidPrewarmerV3
  proxyCacheMaxBytes?: number
  /** 同一 session 下区分 display、thumbnail 等资源请求，避免 IPC requestId 冲突。 */
  requestIdScope?: string
  pyramidPrewarmEnabled?: boolean
}

export interface ImageEditorLoadedProxyResourcesV3 {
  proxies: ImageEditorV3FastProxy[]
  transientLeases: ImageEditMemoryLease[]
}

export const IMAGE_EDITOR_PREVIEW_PROXY_CACHE_MAX_BYTES_V3 = 128 * 1024 * 1024
export const IMAGE_EDITOR_PREVIEW_PYRAMID_PREWARM_TILE_BUDGET_V3 = 64

const logger = createLogger('image_editor_v3.preview_client')

function abortError(signal: AbortSignal): Error {
  const error = signal.reason instanceof Error
    ? signal.reason
    : new Error('图片预览资源读取已取消')
  if (error.name === 'Error') error.name = 'AbortError'
  return error
}

async function raceWithAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw abortError(signal)
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

/** 会话内代理 LRU 与后台金字塔预热；代理字节始终持有全局 cpu-cache lease。 */
export class ImageEditorPreviewResourceLoaderV3 {
  private readonly proxyCache = new Map<string, CachedPreviewProxyV3>()
  private readonly proxyLoads = new Map<string, InFlightPreviewProxyV3>()
  private readonly proxyReader: ImageEditorPreviewProxyReaderV3
  private readonly pyramidDescriptorReader: ImageEditorPreviewPyramidDescriptorReaderV3
  private readonly pyramidPrewarmer: ImageEditorPreviewPyramidPrewarmerV3
  private readonly proxyCacheMaxBytes: number
  private readonly pyramidPrewarms = new Map<string, AbortController>()
  private readonly startedPyramidPrewarms = new Set<string>()
  private proxyCacheBytes = 0
  private prewarmSequence = 0
  private disposed = false

  constructor(private readonly options: ImageEditorPreviewResourceLoaderOptionsV3) {
    this.proxyReader = options.proxyReader ?? readImageEditorV3FastProxy
    this.pyramidDescriptorReader = options.pyramidDescriptorReader
      ?? describeImageEditorV3SourcePyramid
    this.pyramidPrewarmer = options.pyramidPrewarmer ?? prewarmImageEditorV3SourcePyramid
    this.proxyCacheMaxBytes = options.proxyCacheMaxBytes
      ?? IMAGE_EDITOR_PREVIEW_PROXY_CACHE_MAX_BYTES_V3
    if (!Number.isSafeInteger(this.proxyCacheMaxBytes) || this.proxyCacheMaxBytes < 0) {
      throw new Error('图片预览代理缓存上限必须是非负整数')
    }
  }

  async load(
    requests: readonly ImageEditorPreviewProxyResourceRequestV3[],
    requestId: string,
    bitDepth: 8 | 16 | 32,
    signal: AbortSignal,
  ): Promise<ImageEditorLoadedProxyResourcesV3> {
    if (this.disposed) throw new Error('图片预览资源加载器已经释放')
    if (this.options.pyramidPrewarmEnabled !== false) {
      for (const request of requests) {
        this.startPyramidPrewarm(request.resourceId as ImageEditorV3ResourceRef, bitDepth)
      }
    }
    const transientLeases: ImageEditMemoryLease[] = []
    try {
      const proxies = await Promise.all(requests.map(async (request) => {
        const key = `${request.resourceId}:${request.maxDimension}`
        const cached = this.proxyCache.get(key)
        if (cached) {
          this.proxyCache.delete(key)
          this.proxyCache.set(key, cached)
          return cached.proxy
        }
        const loaded = await raceWithAbort(this.loadProxy(
          key,
          request,
          `${requestId}:resource:${request.resourceId.slice(7, 19)}`,
        ), signal)
        const proxy = loaded.proxy
        if (this.disposed || signal.aborted) throw abortError(signal)
        if (!loaded.cached) {
          transientLeases.push(acquireImageEditorResourceLeaseV3(
            this.options.budget,
            'managed-preview',
            'in-flight',
            proxy.bytes.byteLength,
            'lower-mip',
          ))
        }
        return proxy
      }))
      return { proxies, transientLeases }
    } catch (error) {
      for (const lease of transientLeases) lease.release()
      throw error
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const load of this.proxyLoads.values()) load.controller.abort()
    this.proxyLoads.clear()
    for (const controller of this.pyramidPrewarms.values()) controller.abort()
    this.pyramidPrewarms.clear()
    this.startedPyramidPrewarms.clear()
    for (const key of [...this.proxyCache.keys()]) this.removeProxyCacheEntry(key)
  }

  private insertProxyCache(key: string, proxy: ImageEditorV3FastProxy): boolean {
    if (this.disposed) return false
    const bytes = proxy.bytes.byteLength
    if (bytes > this.proxyCacheMaxBytes) return false
    this.removeProxyCacheEntry(key)
    while (
      this.proxyCacheBytes + bytes > this.proxyCacheMaxBytes
      || !this.options.budget.admission('cpu-cache', bytes).admitted
    ) {
      const oldestKey = this.proxyCache.keys().next().value as string | undefined
      if (!oldestKey) return false
      this.removeProxyCacheEntry(oldestKey)
    }
    const lease = this.options.budget.acquire('cpu-cache', bytes)
    if (!lease) return false
    this.proxyCache.set(key, { proxy, lease })
    this.proxyCacheBytes += bytes
    return true
  }

  private loadProxy(
    key: string,
    request: ImageEditorPreviewProxyResourceRequestV3,
    requestId: string,
  ): Promise<{ proxy: ImageEditorV3FastProxy; cached: boolean }> {
    const existing = this.proxyLoads.get(key)
    if (existing) return existing.promise
    const controller = new AbortController()
    const promise = this.proxyReader({
      requestId,
      resourceRef: request.resourceId as ImageEditorV3ResourceRef,
      maxDimension: request.maxDimension,
    }, controller.signal).then((proxy) => {
      if (this.disposed || controller.signal.aborted) throw abortError(controller.signal)
      assertValidPreviewProxyV3(proxy, request.resourceId)
      return { proxy, cached: this.insertProxyCache(key, proxy) }
    }).finally(() => {
      if (this.proxyLoads.get(key)?.promise === promise) this.proxyLoads.delete(key)
    })
    const record: InFlightPreviewProxyV3 = { controller, promise }
    this.proxyLoads.set(key, record)
    return promise
  }

  private removeProxyCacheEntry(key: string): void {
    const entry = this.proxyCache.get(key)
    if (!entry) return
    this.proxyCache.delete(key)
    this.proxyCacheBytes -= entry.proxy.bytes.byteLength
    entry.lease.release()
  }

  private startPyramidPrewarm(
    resourceRef: ImageEditorV3ResourceRef,
    bitDepth: 8 | 16 | 32,
  ): void {
    if (this.startedPyramidPrewarms.has(resourceRef)) return
    const controller = new AbortController()
    this.startedPyramidPrewarms.add(resourceRef)
    this.pyramidPrewarms.set(resourceRef, controller)
    const prefix = `${this.options.sessionId}:${this.options.requestIdScope ?? 'display'}:pyramid:${++this.prewarmSequence}`
    void this.pyramidDescriptorReader({
      requestId: `${prefix}:pyramid-describe`,
      resourceRef,
    }, controller.signal).then((descriptor) => {
      const firstCoarse = descriptor.levels.find((level) => Math.max(level.width, level.height) <= 2_048)
        ?? descriptor.levels.at(-1)
      const last = descriptor.levels.at(-1)
      if (!firstCoarse || !last || controller.signal.aborted) return undefined
      return this.pyramidPrewarmer({
        requestId: `${prefix}:pyramid-prewarm`,
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
