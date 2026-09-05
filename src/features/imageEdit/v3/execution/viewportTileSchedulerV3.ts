import {
  createImageEditorV3RequestId,
  readImageEditorV3SourceTile,
} from '@/commands/imageEditorV3'
import { readImageEditorV3SourceTiles } from '@/commands/imageEditorV3Tiles'
import { readSharedImageEditorSourcePyramidV3 } from './imageEditorSourcePyramidsV3'
import type { ImageEditSize } from '@/core/imageEdit/v3/tileGeometry'
import type {
  ImageEditorV3PyramidDescriptor,
  ImageEditorV3ResourceRef,
  ImageEditorV3SourceTile,
} from '@/platform/contracts/imageEditorV3'
import {
  ImageEditorViewportTileCacheV3,
  type ImageEditorViewportTileLeaseV3,
} from './viewportTileCacheV3'
import {
  planImageEditorViewportTilesV3,
  type ImageEditorViewportTileCandidateV3,
  type ImageEditorViewportTileRequestV3,
  type ImageEditorViewportTilePlanV3,
  type ImageEditorViewportTransformV3,
} from './viewportTilePlannerV3'
import {
  acquireImageEditorViewportDecodeSlotV3,
  assertCompatibleImageEditorViewportPyramidV3,
  awaitImageEditorViewportOperationV3,
  IMAGE_EDITOR_VIEWPORT_PROCESS_DECODE_LIMIT_V3,
  normalizeImageEditorViewportResourceRefsV3,
  resolveImageEditorViewportTileRequestsV3,
  sharedImageEditorViewportPyramidV3,
} from './viewportTileSchedulingSupportV3'
import type {
  ImageEditorViewportPyramidReaderV3,
  ImageEditorViewportSourceTileBatchReaderV3,
  ImageEditorViewportSourceTileReaderV3,
  ImageEditorViewportTileSchedulerOptionsV3,
  ScheduledViewportJobV3,
} from './viewportTileSchedulerContractsV3'

export class ImageEditorViewportSupersededErrorV3 extends Error {
  constructor() {
    super('视口瓦片请求已被更新版本取代')
    this.name = 'ImageEditorViewportSupersededErrorV3'
  }
}

export class ImageEditorViewportCancelledErrorV3 extends Error {
  constructor() {
    super('视口瓦片请求已取消')
    this.name = 'ImageEditorViewportCancelledErrorV3'
  }
}

export interface ImageEditorViewportRenderRequestV3 {
  resourceRef: ImageEditorV3ResourceRef
  /** 同一文档几何下参与合成的全部普通图片资源；首项仍由 resourceRef 决定。 */
  resourceRefs?: readonly ImageEditorV3ResourceRef[]
  revision: number
  /** 输出坐标空间尺寸。 */
  documentSize: ImageEditSize
  /** 源金字塔尺寸；裁剪/方向不会改变它。 */
  sourceSize?: ImageEditSize
  viewport: ImageEditorViewportTransformV3
  bitDepth: 8 | 16 | 32
  haloDocumentPixels?: number
  overscanViewports?: number
  forwardPrefetchViewports?: number
  previousMip?: number
  preferredMip?: number
  coverage?: 'viewport' | 'document'
  /** 让 RenderPlan 按逆向依赖为当前 mip 补充/替换实际源瓦片。 */
  resolveSourceTileRequests?: (
    candidate: ImageEditorViewportTileCandidateV3,
    descriptors: ReadonlyMap<ImageEditorV3ResourceRef, ImageEditorV3PyramidDescriptor>,
  ) => readonly ImageEditorViewportTileRequestV3[]
  /** 在读取任何源瓦片前，把合成工作集与成品预算一并纳入 mip 选择。 */
  admitCandidate?: (
    candidate: ImageEditorViewportTileCandidateV3,
    descriptors: ReadonlyMap<ImageEditorV3ResourceRef, ImageEditorV3PyramidDescriptor>,
  ) => boolean
}

export interface ImageEditorViewportFrameV3 {
  sequence: number
  revision: number
  plan: ImageEditorViewportTilePlanV3
  /** 缓存借出的只读像素；不得修改或 transfer，使用结束必须 release。 */
  tiles: readonly ImageEditorV3SourceTile[]
  /** 多图层/蒙版按资源分组后的同 mip 瓦片；每组顺序与 plan.tiles 一致。 */
  resourceTiles: ReadonlyMap<ImageEditorV3ResourceRef, readonly ImageEditorV3SourceTile[]>
  /** 各图片资源在 mip 0 的独立像素几何。 */
  resourceSizes: ReadonlyMap<ImageEditorV3ResourceRef, ImageEditSize>
  release(): void
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function validateRevision(revision: number): void {
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('视口 revision 必须是非负整数')
}

function abortedJobError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new ImageEditorViewportSupersededErrorV3()
}

/**
 * 会话级视口调度器。只允许一个 running 和一个 latest-pending；取消粒度是单个
 * describe/readTile 调用；即使底层调用不响应 abort，旧 job 也会立即归还本地资源并让位。
 */
export class ImageEditorViewportTileSchedulerV3 {
  private readonly descriptorReader: ImageEditorViewportPyramidReaderV3
  private readonly tileReader: ImageEditorViewportSourceTileReaderV3
  private readonly tileBatchReader: ImageEditorViewportSourceTileBatchReaderV3 | null
  private readonly cache: ImageEditorViewportTileCacheV3
  private readonly disposeCache: boolean
  private readonly descriptorCache = new Map<ImageEditorV3ResourceRef, ImageEditorV3PyramidDescriptor>()
  private readonly frameReleases = new Set<() => void>()
  private running: ScheduledViewportJobV3 | null = null
  private pending: ScheduledViewportJobV3 | null = null
  private sequence = 0
  private latestSequence = 0
  private disposed = false
  private readonly decodeConcurrency: number

  constructor(private readonly options: ImageEditorViewportTileSchedulerOptionsV3) {
    if (!options.sessionId.trim()) throw new Error('视口瓦片会话 ID 不能为空')
    if (options.cache && options.cacheOptions) throw new Error('不能同时传入 cache 与 cacheOptions')
    if (!options.cache && options.disposeCache === false) {
      throw new Error('只有外部 cache 才能关闭调度器自动释放')
    }
    this.descriptorReader = options.describePyramid ?? readSharedImageEditorSourcePyramidV3
    this.tileReader = options.readSourceTile ?? readImageEditorV3SourceTile
    this.tileBatchReader = options.readSourceTiles
      ?? (options.readSourceTile ? null : readImageEditorV3SourceTiles)
    this.disposeCache = options.disposeCache ?? true
    this.cache = options.cache ?? new ImageEditorViewportTileCacheV3(options.cacheOptions)
    this.decodeConcurrency = options.decodeConcurrency ?? 4
    if (!Number.isSafeInteger(this.decodeConcurrency)
      || this.decodeConcurrency < 1
      || this.decodeConcurrency > IMAGE_EDITOR_VIEWPORT_PROCESS_DECODE_LIMIT_V3) {
      throw new Error('视口瓦片会话解码并发必须是 1～8 的整数')
    }
  }

  render(request: ImageEditorViewportRenderRequestV3): Promise<ImageEditorViewportFrameV3> {
    if (this.disposed) return Promise.reject(new Error('视口瓦片会话已经释放'))
    validateRevision(request.revision)
    const sequence = ++this.sequence
    this.latestSequence = sequence
    return new Promise((resolve, reject) => {
      const job: ScheduledViewportJobV3 = {
        request,
        sequence,
        controller: new AbortController(),
        resolve,
        reject,
        tileLeases: new Map(),
        readReservations: new Map(),
        preparedFrame: null,
      }
      if (!this.running) {
        this.start(job)
        return
      }
      if (this.pending) {
        this.abortJob(this.pending, new ImageEditorViewportSupersededErrorV3())
      }
      this.pending = job
      this.abortJob(this.running, new ImageEditorViewportSupersededErrorV3())
    })
  }

  cancel(): void {
    if (this.disposed) return
    this.latestSequence = ++this.sequence
    const error = new ImageEditorViewportCancelledErrorV3()
    if (this.running) this.abortJob(this.running, error)
    if (this.pending) this.abortJob(this.pending, error)
    this.pending = null
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    const error = new Error('视口瓦片会话已经释放')
    if (this.running) this.abortJob(this.running, error)
    if (this.pending) this.abortJob(this.pending, error)
    this.running = null
    this.pending = null
    for (const release of [...this.frameReleases]) release()
    this.descriptorCache.clear()
    if (this.disposeCache) this.cache.dispose()
  }

  cacheSnapshot(): ReturnType<ImageEditorViewportTileCacheV3['snapshot']> {
    return this.cache.snapshot()
  }

  private start(job: ScheduledViewportJobV3): void {
    this.running = job
    void this.renderJob(job).then((frame) => {
      this.assertCurrent(job)
      if (job.preparedFrame !== frame) throw new ImageEditorViewportSupersededErrorV3()
      job.preparedFrame = null
      job.resolve(frame)
    }).catch((error: unknown) => {
      this.releaseJobResources(job)
      const normalized = job.sequence === this.latestSequence && !job.controller.signal.aborted
        ? toError(error)
        : new ImageEditorViewportSupersededErrorV3()
      job.reject(normalized)
    }).finally(() => this.finish(job))
  }

  private async renderJob(job: ScheduledViewportJobV3): Promise<ImageEditorViewportFrameV3> {
    const resourceRefs = normalizeImageEditorViewportResourceRefsV3(job.request)
    const descriptors = await Promise.all(resourceRefs.map((resourceRef) => (
      this.readDescriptor(resourceRef, job)
    )))
    this.assertCurrent(job)
    const primaryDescriptor = descriptors[0]
    if (!primaryDescriptor) throw new Error('视口图片资源缺少金字塔描述')
    for (const candidate of descriptors.slice(1)) {
      assertCompatibleImageEditorViewportPyramidV3(primaryDescriptor, candidate)
    }
    const descriptorMap = new Map(resourceRefs.map((resourceRef, index) => [
      resourceRef,
      descriptors[index] as ImageEditorV3PyramidDescriptor,
    ]))
    const descriptor = sharedImageEditorViewportPyramidV3(primaryDescriptor, descriptors.slice(1))
    const plan = planImageEditorViewportTilesV3({
      resourceRef: job.request.resourceRef,
      documentSize: job.request.documentSize,
      sourceSize: job.request.sourceSize,
      pyramid: descriptor,
      viewport: job.request.viewport,
      bitDepth: job.request.bitDepth,
      haloDocumentPixels: job.request.haloDocumentPixels,
      overscanViewports: job.request.overscanViewports,
      forwardPrefetchViewports: job.request.forwardPrefetchViewports,
      previousMip: job.request.previousMip,
      preferredMip: job.request.preferredMip,
      coverage: job.request.coverage,
      admit: (candidate) => (
        this.cache.admission(
          resolveImageEditorViewportTileRequestsV3(
            job.request, candidate, resourceRefs, descriptorMap,
          ),
        ).admitted
        && (job.request.admitCandidate?.(candidate, descriptorMap) ?? true)
      ),
    })
    const tileRequests = resolveImageEditorViewportTileRequestsV3(
      job.request, plan, resourceRefs, descriptorMap,
    )
    try {
      // 先锁住全部命中项，后续 miss 插入触发 LRU 时不会逐出本帧仍需使用的瓦片。
      for (const tileRequest of tileRequests) {
        const lease = this.cache.lease(tileRequest)
        if (lease) job.tileLeases.set(tileRequest.key, lease)
      }
      // 在第一次异步读取前一次性预留全部 miss；随后逐片从 in-flight 同步转换为 cpu-cache。
      for (const tileRequest of tileRequests) {
        if (job.tileLeases.has(tileRequest.key)) continue
        const reservation = this.cache.reserveInFlight(tileRequest)
        if (!reservation) throw new Error('视口瓦片读取前未通过 in-flight 资源预算')
        job.readReservations.set(tileRequest.key, reservation)
      }
      const misses = tileRequests.filter((tileRequest) => !job.tileLeases.has(tileRequest.key))
      await this.loadMisses(job, misses)
      this.assertCurrent(job)
      return this.createFrame(job, plan, resourceRefs, tileRequests, descriptorMap)
    } catch (error) {
      this.releaseJobResources(job)
      throw error
    }
  }

  private async loadMisses(
    job: ScheduledViewportJobV3,
    misses: readonly ImageEditorViewportTileRequestV3[],
  ): Promise<void> {
    if (this.tileBatchReader) {
      await this.loadMissesInBatches(job, misses)
      return
    }
    await this.loadMissesIndividually(job, misses)
  }

  private async loadMissesInBatches(
    job: ScheduledViewportJobV3,
    misses: readonly ImageEditorViewportTileRequestV3[],
  ): Promise<void> {
    const batchSize = 16
    for (let offset = 0; offset < misses.length; offset += batchSize) {
      this.assertCurrent(job)
      const requests = misses.slice(offset, offset + batchSize)
      const received = new Set<number>()
      const response = await awaitImageEditorViewportOperationV3(this.tileBatchReader!({
        requestId: createImageEditorV3RequestId('viewport-tiles'),
        tiles: requests.map((request, priority) => ({
          resourceRef: request.resourceRef,
          mip: request.mip,
          tileX: request.tileX,
          tileY: request.tileY,
          halo: request.halo,
          bitDepth: request.bitDepth,
          priority,
        })),
        onTile: ({ index, tile }) => {
          this.assertCurrent(job)
          if (!Number.isSafeInteger(index)
            || index < 0
            || index >= requests.length
            || received.has(index)) {
            throw new Error('视口批量瓦片流包含非法或重复序号')
          }
          const request = requests[index]
          if (!request) throw new Error('视口批量瓦片流包含额外结果')
          received.add(index)
          this.commitLoadedTile(job, request, tile)
        },
      }, job.controller.signal), job.controller.signal, () => abortedJobError(job.controller.signal))
      this.assertCurrent(job)
      if (response.tiles.length !== requests.length) {
        throw new Error('视口批量瓦片响应数量与请求不一致')
      }
      for (const [index, tile] of response.tiles.entries()) {
        if (received.has(index)) continue
        const request = requests[index]
        if (!request) throw new Error('视口批量瓦片响应包含额外结果')
        this.commitLoadedTile(job, request, tile)
      }
    }
  }

  private async loadMissesIndividually(
    job: ScheduledViewportJobV3,
    misses: readonly ImageEditorViewportTileRequestV3[],
  ): Promise<void> {
    let cursor = 0
    const worker = async (): Promise<void> => {
      while (cursor < misses.length) {
        const tileRequest = misses[cursor]
        cursor += 1
        if (!tileRequest) return
        this.assertCurrent(job)
        const releaseGate = await acquireImageEditorViewportDecodeSlotV3(
          job.controller.signal,
          () => abortedJobError(job.controller.signal),
        )
        try {
          const tile = await awaitImageEditorViewportOperationV3(this.tileReader({
            requestId: createImageEditorV3RequestId('viewport-tile'),
            resourceRef: tileRequest.resourceRef,
            mip: tileRequest.mip,
            tileX: tileRequest.tileX,
            tileY: tileRequest.tileY,
            halo: tileRequest.halo,
            bitDepth: tileRequest.bitDepth,
          }, job.controller.signal), job.controller.signal, () => abortedJobError(job.controller.signal))
          this.assertCurrent(job)
          this.commitLoadedTile(job, tileRequest, tile)
        } finally {
          releaseGate()
        }
      }
    }
    await Promise.all(Array.from(
      { length: Math.min(this.decodeConcurrency, misses.length) },
      () => worker(),
    ))
  }

  private commitLoadedTile(
    job: ScheduledViewportJobV3,
    request: ImageEditorViewportTileRequestV3,
    tile: ImageEditorV3SourceTile,
  ): void {
    const reservation = job.readReservations.get(request.key)
    if (!reservation) throw new Error('视口瓦片缺少 in-flight 资源预留')
    let lease: ImageEditorViewportTileLeaseV3 | null
    try {
      lease = reservation.commit(tile)
    } finally {
      job.readReservations.delete(request.key)
    }
    if (!lease) throw new Error('视口瓦片在读取后未通过 CPU 缓存 admission')
    job.tileLeases.set(request.key, lease)
  }

  private async readDescriptor(
    resourceRef: ImageEditorV3ResourceRef,
    job: ScheduledViewportJobV3,
  ): Promise<ImageEditorV3PyramidDescriptor> {
    const cached = this.descriptorCache.get(resourceRef)
    if (cached) return cached
    const descriptor = await awaitImageEditorViewportOperationV3(this.descriptorReader({
      requestId: createImageEditorV3RequestId('viewport-pyramid'),
      resourceRef,
    }, job.controller.signal), job.controller.signal, () => abortedJobError(job.controller.signal))
    this.assertCurrent(job)
    this.descriptorCache.set(resourceRef, descriptor)
    return descriptor
  }

  private createFrame(
    job: ScheduledViewportJobV3,
    plan: ImageEditorViewportTilePlanV3,
    resourceRefs: readonly ImageEditorV3ResourceRef[],
    tileRequests: readonly ImageEditorViewportTileRequestV3[],
    descriptors: ReadonlyMap<ImageEditorV3ResourceRef, ImageEditorV3PyramidDescriptor>,
  ): ImageEditorViewportFrameV3 {
    if (job.readReservations.size !== 0) throw new Error('视口帧仍持有未提交的读取预算')
    const leases = new Map(job.tileLeases)
    const allTiles = tileRequests.map((request) => {
      const lease = leases.get(request.key)
      if (!lease) throw new Error('视口帧缺少已规划瓦片')
      return lease.tile
    })
    const resourceTiles = new Map<ImageEditorV3ResourceRef, readonly ImageEditorV3SourceTile[]>()
    const resourceSizes = new Map<ImageEditorV3ResourceRef, ImageEditSize>()
    for (const resourceRef of resourceRefs) {
      resourceTiles.set(resourceRef, allTiles.filter((tile) => tile.resourceRef === resourceRef))
      const level = descriptors.get(resourceRef)?.levels.find(({ mip }) => mip === 0)
      if (!level) throw new Error('视口图片资源缺少 mip 0 几何')
      resourceSizes.set(resourceRef, { width: level.width, height: level.height })
    }
    const tiles = resourceTiles.get(job.request.resourceRef) ?? []
    job.tileLeases.clear()
    let released = false
    const release = (): void => {
      if (released) return
      released = true
      this.frameReleases.delete(release)
      for (const lease of leases.values()) lease.release()
    }
    this.frameReleases.add(release)
    const frame: ImageEditorViewportFrameV3 = {
      sequence: job.sequence,
      revision: job.request.revision,
      plan,
      tiles,
      resourceTiles,
      resourceSizes,
      release,
    }
    job.preparedFrame = frame
    return frame
  }

  private abortJob(job: ScheduledViewportJobV3, error: Error): void {
    job.controller.abort(error)
    this.releaseJobResources(job)
    job.reject(error)
  }

  private releaseJobResources(job: ScheduledViewportJobV3): void {
    const reservations = [...job.readReservations.values()]
    const leases = [...job.tileLeases.values()]
    const preparedFrame = job.preparedFrame
    job.readReservations.clear()
    job.tileLeases.clear()
    job.preparedFrame = null
    for (const reservation of reservations) reservation.release()
    for (const lease of leases) lease.release()
    preparedFrame?.release()
  }

  private assertCurrent(job: ScheduledViewportJobV3): void {
    if (
      this.disposed
      || job.controller.signal.aborted
      || job.sequence !== this.latestSequence
      || this.running !== job
    ) {
      throw new ImageEditorViewportSupersededErrorV3()
    }
  }

  private finish(job: ScheduledViewportJobV3): void {
    if (this.running !== job) return
    this.running = null
    const next = this.pending
    this.pending = null
    if (next && !this.disposed) this.start(next)
  }
}
