import {
  createImageEditorV3RequestId,
  describeImageEditorV3SourcePyramid,
  readImageEditorV3SourceTile,
} from '@/commands/imageEditorV3'
import { createTileRegion, type ImageEditSize } from '@/core/imageEdit/v3/tileGeometry'
import type {
  ImageEditorV3PyramidDescriptor,
  ImageEditorV3ResourceRef,
  ImageEditorV3SourceTile,
} from '@/platform/contracts/imageEditorV3'
import {
  ImageEditorViewportTileCacheV3,
  type ImageEditorViewportTileCacheOptionsV3,
  type ImageEditorViewportTileLeaseV3,
  type ImageEditorViewportTileReadReservationV3,
} from './viewportTileCacheV3'
import {
  imageEditorViewportTileCacheKeyV3,
  planImageEditorViewportTilesV3,
  type ImageEditorViewportTileCandidateV3,
  type ImageEditorViewportTileRequestV3,
  type ImageEditorViewportTilePlanV3,
  type ImageEditorViewportTransformV3,
} from './viewportTilePlannerV3'

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
  documentSize: ImageEditSize
  viewport: ImageEditorViewportTransformV3
  bitDepth: 8 | 16 | 32
  haloDocumentPixels?: number
  /** 让 RenderPlan 按逆向依赖为当前 mip 补充/替换实际源瓦片。 */
  resolveSourceTileRequests?: (
    candidate: ImageEditorViewportTileCandidateV3,
  ) => readonly ImageEditorViewportTileRequestV3[]
}

export interface ImageEditorViewportFrameV3 {
  sequence: number
  revision: number
  plan: ImageEditorViewportTilePlanV3
  /** 缓存借出的只读像素；不得修改或 transfer，使用结束必须 release。 */
  tiles: readonly ImageEditorV3SourceTile[]
  /** 多图层/蒙版按资源分组后的同 mip 瓦片；每组顺序与 plan.tiles 一致。 */
  resourceTiles: ReadonlyMap<ImageEditorV3ResourceRef, readonly ImageEditorV3SourceTile[]>
  release(): void
}

type PyramidReaderV3 = (
  request: { requestId: string; resourceRef: ImageEditorV3ResourceRef },
  signal?: AbortSignal,
) => Promise<ImageEditorV3PyramidDescriptor>

type SourceTileReaderV3 = (
  request: {
    requestId: string
    resourceRef: ImageEditorV3ResourceRef
    mip: number
    tileX: number
    tileY: number
    halo: number
    bitDepth: 8 | 16 | 32
  },
  signal?: AbortSignal,
) => Promise<ImageEditorV3SourceTile>

export interface ImageEditorViewportTileSchedulerOptionsV3 {
  sessionId: string
  describePyramid?: PyramidReaderV3
  readSourceTile?: SourceTileReaderV3
  cache?: ImageEditorViewportTileCacheV3
  cacheOptions?: ImageEditorViewportTileCacheOptionsV3
}

interface ScheduledViewportJobV3 {
  request: ImageEditorViewportRenderRequestV3
  sequence: number
  controller: AbortController
  resolve: (frame: ImageEditorViewportFrameV3) => void
  reject: (error: Error) => void
  tileLeases: Map<string, ImageEditorViewportTileLeaseV3>
  readReservations: Map<string, ImageEditorViewportTileReadReservationV3>
  preparedFrame: ImageEditorViewportFrameV3 | null
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function validateRevision(revision: number): void {
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('视口 revision 必须是非负整数')
}

function normalizeResourceRefs(request: ImageEditorViewportRenderRequestV3): ImageEditorV3ResourceRef[] {
  const refs = [request.resourceRef, ...(request.resourceRefs ?? [])]
  const unique = [...new Set(refs)]
  if (unique.some((resourceRef) => !/^sha256:[a-f0-9]{64}$/.test(resourceRef))) {
    throw new Error('视口图片资源引用无效')
  }
  return unique
}

function assertCompatiblePyramid(
  primary: ImageEditorV3PyramidDescriptor,
  candidate: ImageEditorV3PyramidDescriptor,
): void {
  if (
    candidate.tileSize !== primary.tileSize
    || candidate.levels.length !== primary.levels.length
    || candidate.levels.some((level, index) => {
      const expected = primary.levels[index]
      return !expected
        || level.mip !== expected.mip
        || level.width !== expected.width
        || level.height !== expected.height
        || level.columns !== expected.columns
        || level.rows !== expected.rows
    })
  ) throw new Error('参与视口合成的图片资源金字塔几何不一致')
}

function expandTileRequests(
  requests: readonly ImageEditorViewportTileRequestV3[],
  resourceRefs: readonly ImageEditorV3ResourceRef[],
): ImageEditorViewportTileRequestV3[] {
  return resourceRefs.flatMap((resourceRef) => requests.map((request) => ({
    ...request,
    resourceRef,
    key: imageEditorViewportTileCacheKeyV3({ ...request, resourceRef }),
  })))
}

function resolvedTileRequests(
  request: ImageEditorViewportRenderRequestV3,
  candidate: Parameters<NonNullable<ImageEditorViewportRenderRequestV3['resolveSourceTileRequests']>>[0],
  resourceRefs: readonly ImageEditorV3ResourceRef[],
): ImageEditorViewportTileRequestV3[] {
  const resolved = request.resolveSourceTileRequests?.(candidate)
    ?? expandTileRequests(candidate.tiles, resourceRefs)
  const byKey = new Map<string, ImageEditorViewportTileRequestV3>()
  for (const tile of resolved) {
    let expectedRegion
    try {
      expectedRegion = createTileRegion(
        request.documentSize,
        { mip: tile.mip, x: tile.tileX, y: tile.tileY },
        tile.halo,
      )
    } catch {
      throw new Error('视口 RenderPlan 返回了越界源瓦片请求')
    }
    const expectedBytes = expectedRegion.sourceRect.width * expectedRegion.sourceRect.height
      * 4 * (tile.bitDepth / 8)
    if (!resourceRefs.includes(tile.resourceRef)
      || tile.mip !== candidate.mip
      || tile.bitDepth !== request.bitDepth
      || tile.key !== imageEditorViewportTileCacheKeyV3(tile)
      || tile.originX !== expectedRegion.sourceRect.x
      || tile.originY !== expectedRegion.sourceRect.y
      || tile.width !== expectedRegion.sourceRect.width
      || tile.height !== expectedRegion.sourceRect.height
      || tile.estimatedBytes !== expectedBytes
      || !Number.isSafeInteger(expectedBytes)) {
      throw new Error('视口 RenderPlan 返回了无效源瓦片请求')
    }
    byKey.set(tile.key, tile)
  }
  return [...byKey.values()]
}

function abortedJobError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new ImageEditorViewportSupersededErrorV3()
}

/** AbortSignal 必须能结束本地等待，即使底层 IPC/测试 reader 不合作。 */
function awaitWithAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortedJobError(signal))
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const finish = (complete: () => void): void => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      complete()
    }
    const onAbort = (): void => finish(() => reject(abortedJobError(signal)))
    signal.addEventListener('abort', onAbort, { once: true })
    operation.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    )
  })
}

/**
 * 会话级视口调度器。只允许一个 running 和一个 latest-pending；取消粒度是单个
 * describe/readTile 调用；即使底层调用不响应 abort，旧 job 也会立即归还本地资源并让位。
 */
export class ImageEditorViewportTileSchedulerV3 {
  private readonly descriptorReader: PyramidReaderV3
  private readonly tileReader: SourceTileReaderV3
  private readonly cache: ImageEditorViewportTileCacheV3
  private readonly descriptorCache = new Map<ImageEditorV3ResourceRef, ImageEditorV3PyramidDescriptor>()
  private readonly frameReleases = new Set<() => void>()
  private running: ScheduledViewportJobV3 | null = null
  private pending: ScheduledViewportJobV3 | null = null
  private sequence = 0
  private latestSequence = 0
  private disposed = false

  constructor(private readonly options: ImageEditorViewportTileSchedulerOptionsV3) {
    if (!options.sessionId.trim()) throw new Error('视口瓦片会话 ID 不能为空')
    if (options.cache && options.cacheOptions) throw new Error('不能同时传入 cache 与 cacheOptions')
    this.descriptorReader = options.describePyramid ?? describeImageEditorV3SourcePyramid
    this.tileReader = options.readSourceTile ?? readImageEditorV3SourceTile
    this.cache = options.cache ?? new ImageEditorViewportTileCacheV3(options.cacheOptions)
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
    this.cache.dispose()
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
    const resourceRefs = normalizeResourceRefs(job.request)
    const descriptors = await Promise.all(resourceRefs.map((resourceRef) => (
      this.readDescriptor(resourceRef, job)
    )))
    this.assertCurrent(job)
    const descriptor = descriptors[0]
    if (!descriptor) throw new Error('视口图片资源缺少金字塔描述')
    for (const candidate of descriptors.slice(1)) assertCompatiblePyramid(descriptor, candidate)
    const plan = planImageEditorViewportTilesV3({
      resourceRef: job.request.resourceRef,
      documentSize: job.request.documentSize,
      pyramid: descriptor,
      viewport: job.request.viewport,
      bitDepth: job.request.bitDepth,
      haloDocumentPixels: job.request.haloDocumentPixels,
      admit: (candidate) => this.cache.admission(
        resolvedTileRequests(job.request, candidate, resourceRefs),
      ).admitted,
    })
    const tileRequests = resolvedTileRequests(job.request, plan, resourceRefs)
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
      for (const tileRequest of tileRequests) {
        if (job.tileLeases.has(tileRequest.key)) continue
        this.assertCurrent(job)
        const tile = await awaitWithAbort(this.tileReader({
          requestId: createImageEditorV3RequestId(
            'viewport-tile',
          ),
          resourceRef: tileRequest.resourceRef,
          mip: tileRequest.mip,
          tileX: tileRequest.tileX,
          tileY: tileRequest.tileY,
          halo: tileRequest.halo,
          bitDepth: tileRequest.bitDepth,
        }, job.controller.signal), job.controller.signal)
        this.assertCurrent(job)
        const reservation = job.readReservations.get(tileRequest.key)
        if (!reservation) throw new Error('视口瓦片缺少 in-flight 资源预留')
        let lease: ImageEditorViewportTileLeaseV3 | null
        try {
          lease = reservation.commit(tile)
        } finally {
          job.readReservations.delete(tileRequest.key)
        }
        if (!lease) throw new Error('视口瓦片在读取后未通过 CPU 缓存 admission')
        job.tileLeases.set(tileRequest.key, lease)
      }
      this.assertCurrent(job)
      return this.createFrame(job, plan, resourceRefs, tileRequests)
    } catch (error) {
      this.releaseJobResources(job)
      throw error
    }
  }

  private async readDescriptor(
    resourceRef: ImageEditorV3ResourceRef,
    job: ScheduledViewportJobV3,
  ): Promise<ImageEditorV3PyramidDescriptor> {
    const cached = this.descriptorCache.get(resourceRef)
    if (cached) return cached
    const descriptor = await awaitWithAbort(this.descriptorReader({
      requestId: createImageEditorV3RequestId('viewport-pyramid'),
      resourceRef,
    }, job.controller.signal), job.controller.signal)
    this.assertCurrent(job)
    this.descriptorCache.set(resourceRef, descriptor)
    return descriptor
  }

  private createFrame(
    job: ScheduledViewportJobV3,
    plan: ImageEditorViewportTilePlanV3,
    resourceRefs: readonly ImageEditorV3ResourceRef[],
    tileRequests: readonly ImageEditorViewportTileRequestV3[],
  ): ImageEditorViewportFrameV3 {
    if (job.readReservations.size !== 0) throw new Error('视口帧仍持有未提交的读取预算')
    const leases = new Map(job.tileLeases)
    const allTiles = tileRequests.map((request) => {
      const lease = leases.get(request.key)
      if (!lease) throw new Error('视口帧缺少已规划瓦片')
      return lease.tile
    })
    const resourceTiles = new Map<ImageEditorV3ResourceRef, readonly ImageEditorV3SourceTile[]>()
    for (const resourceRef of resourceRefs) {
      resourceTiles.set(resourceRef, allTiles.filter((tile) => tile.resourceRef === resourceRef))
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
