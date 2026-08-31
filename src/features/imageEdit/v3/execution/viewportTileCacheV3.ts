import {
  IMAGE_EDIT_DEFAULT_CPU_CACHE_TARGET_BYTES,
  ImageEditResourceBudget,
  type ImageEditMemoryLease,
} from '@/core/imageEdit/v3/resourceBudget'
import { createLogger } from '@/core/logging'
import type { ImageEditorV3SourceTile } from '@/platform/contracts/imageEditorV3'
import {
  imageEditorViewportTileCacheKeyV3,
  type ImageEditorViewportTileRequestV3,
} from './viewportTilePlannerV3'

const logger = createLogger('features.image_edit_v3.viewport_tile_cache')

interface ViewportTileCacheEntryV3 {
  tile: ImageEditorV3SourceTile
  bytes: number
  budgetLease: ImageEditMemoryLease
  leases: number
  touchedAt: number
  evictWhenReleased: boolean
}

export interface ImageEditorViewportTileLeaseV3 {
  readonly tile: ImageEditorV3SourceTile
  readonly bytes: number
  release(): void
}

export interface ImageEditorViewportTileReadReservationV3 {
  readonly bytes: number
  commit(tile: ImageEditorV3SourceTile): ImageEditorViewportTileLeaseV3 | null
  release(): void
}

export interface ImageEditorViewportTileAdmissionV3 {
  admitted: boolean
  missingBytes: number
  protectedBytes: number
  evictableBytes: number
  availableBytes: number
}

export interface ImageEditorViewportTileCacheSnapshotV3 {
  maxBytes: number
  usedBytes: number
  entryCount: number
  leasedEntryCount: number
  leasedBytes: number
  disposed: boolean
}

export interface ImageEditorViewportTileCacheOptionsV3 {
  maxBytes?: number
  resourceBudget?: ImageEditResourceBudget
  onDisposeTile?: (tile: ImageEditorV3SourceTile) => void
}

function normalizeBytes(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} 必须是非负整数`)
  return value
}

function validateRequest(request: ImageEditorViewportTileRequestV3): number {
  const bytesPerSample = request.bitDepth / 8
  const expected = request.width * request.height * 4 * bytesPerSample
  if (
    request.key !== imageEditorViewportTileCacheKeyV3(request)
    || !Number.isSafeInteger(request.mip)
    || request.mip < 0
    || request.mip > 30
    || !Number.isSafeInteger(request.tileX)
    || request.tileX < 0
    || !Number.isSafeInteger(request.tileY)
    || request.tileY < 0
    || !Number.isSafeInteger(request.halo)
    || request.halo < 0
    || ![8, 16, 32].includes(request.bitDepth)
    || !Number.isSafeInteger(request.width)
    || request.width <= 0
    || !Number.isSafeInteger(request.height)
    || request.height <= 0
    || !Number.isSafeInteger(request.originX)
    || request.originX < 0
    || !Number.isSafeInteger(request.originY)
    || request.originY < 0
    || !Number.isSafeInteger(expected)
    || request.estimatedBytes !== expected
  ) {
    throw new Error('视口瓦片计划与缓存键或几何不一致')
  }
  return expected
}

function validateTile(
  request: ImageEditorViewportTileRequestV3,
  tile: ImageEditorV3SourceTile,
): number {
  const expectedBytes = validateRequest(request)
  const bytesPerSample = request.bitDepth / 8
  const float = request.bitDepth === 32
  if (
    tile.resourceRef !== request.resourceRef
    || tile.mip !== request.mip
    || tile.tileX !== request.tileX
    || tile.tileY !== request.tileY
    || tile.halo !== request.halo
    || tile.bitDepth !== request.bitDepth
    || tile.width !== request.width
    || tile.height !== request.height
    || tile.originX !== request.originX
    || tile.originY !== request.originY
    || tile.channels !== 4
    || tile.rowStride !== request.width * 4 * bytesPerSample
    || tile.sampleFormat !== (float ? 'float' : 'uint')
    || tile.numericRange !== (float ? 'scene-linear' : request.bitDepth === 16 ? 'unorm16' : 'unorm8')
    || tile.byteOrder !== 'little-endian'
    || tile.colorSpace !== (float ? 'scrgb' : 'srgb')
    || tile.transferFunction !== (float ? 'linear' : 'srgb')
    || tile.alphaMode !== 'straight'
    || tile.orientationApplied !== true
    || !(tile.pixels instanceof ArrayBuffer)
    || tile.pixels.byteLength !== expectedBytes
  ) {
    throw new Error('主进程返回的视口瓦片与计划几何或编码不一致')
  }
  return expectedBytes
}

/** 仅持有 CPU ArrayBuffer；每个条目同时受本地 LRU 上限和全局资源账本约束。 */
export class ImageEditorViewportTileCacheV3 {
  private readonly entries = new Map<string, ViewportTileCacheEntryV3>()
  private readonly maxBytes: number
  private readonly budget: ImageEditResourceBudget
  private readonly onDisposeTile?: (tile: ImageEditorV3SourceTile) => void
  private sequence = 0
  private usedBytes = 0
  private disposed = false
  private readonly inFlightReleases = new Set<() => void>()

  constructor(options: ImageEditorViewportTileCacheOptionsV3 = {}) {
    this.maxBytes = normalizeBytes(
      options.maxBytes ?? IMAGE_EDIT_DEFAULT_CPU_CACHE_TARGET_BYTES,
      'CPU 瓦片缓存上限',
    )
    this.budget = options.resourceBudget ?? new ImageEditResourceBudget()
    this.onDisposeTile = options.onDisposeTile
  }

  has(key: string): boolean {
    const entry = this.entries.get(key)
    return Boolean(entry && !entry.evictWhenReleased)
  }

  lease(request: ImageEditorViewportTileRequestV3): ImageEditorViewportTileLeaseV3 | null {
    if (this.disposed) return null
    validateRequest(request)
    const entry = this.entries.get(request.key)
    if (!entry || entry.evictWhenReleased) return null
    validateTile(request, entry.tile)
    entry.leases += 1
    entry.touchedAt = ++this.sequence
    let released = false
    return {
      tile: entry.tile,
      bytes: entry.bytes,
      release: () => {
        if (released) return
        released = true
        entry.leases -= 1
        if (entry.leases === 0 && entry.evictWhenReleased) this.removeEntry(request.key, entry)
      },
    }
  }

  admission(requests: readonly ImageEditorViewportTileRequestV3[]): ImageEditorViewportTileAdmissionV3 {
    const keys = new Set(requests.map((request) => request.key))
    if (keys.size !== requests.length) throw new Error('视口瓦片计划包含重复缓存键')
    let missingBytes = 0
    let protectedBytes = 0
    let evictableBytes = 0
    for (const request of requests) {
      validateRequest(request)
      const entry = this.entries.get(request.key)
      if (entry && !entry.evictWhenReleased) protectedBytes += entry.bytes
      else missingBytes += request.estimatedBytes
      if (!Number.isSafeInteger(protectedBytes) || !Number.isSafeInteger(missingBytes)) {
        throw new Error('视口瓦片 admission 字节数超出安全整数范围')
      }
    }
    for (const [key, entry] of this.entries) {
      if (entry.leases > 0 || entry.evictWhenReleased || keys.has(key)) continue
      evictableBytes += entry.bytes
    }
    const existingNonEvictable = this.usedBytes - evictableBytes
    const tierAvailable = Math.max(0, this.maxBytes - existingNonEvictable)
    const globalAvailable = Math.min(
      Number.MAX_SAFE_INTEGER,
      this.budget.admission('cpu-cache', 0).availableBytes + evictableBytes,
    )
    const availableBytes = Math.min(tierAvailable, globalAvailable)
    return {
      admitted: !this.disposed && missingBytes <= availableBytes,
      missingBytes,
      protectedBytes,
      evictableBytes,
      availableBytes,
    }
  }

  reserveInFlight(
    request: ImageEditorViewportTileRequestV3,
  ): ImageEditorViewportTileReadReservationV3 | null {
    if (this.disposed) return null
    const bytes = validateRequest(request)
    if (bytes > this.maxBytes) return null
    while (!this.budget.admission('in-flight', bytes).admitted) {
      const candidate = this.oldestEvictable()
      if (!candidate) return null
      this.removeEntry(candidate[0], candidate[1])
    }
    const budgetLease = this.budget.acquire('in-flight', bytes)
    if (!budgetLease) return null
    let active = true
    const release = (): void => {
      if (!active) return
      active = false
      this.inFlightReleases.delete(release)
      budgetLease.release()
    }
    this.inFlightReleases.add(release)
    return {
      bytes,
      commit: (tile) => {
        if (!active || this.disposed) {
          release()
          return null
        }
        try {
          validateTile(request, tile)
        } catch (error) {
          release()
          throw error
        }
        release()
        return this.insertAndLease(request, tile)
      },
      release,
    }
  }

  insertAndLease(
    request: ImageEditorViewportTileRequestV3,
    tile: ImageEditorV3SourceTile,
  ): ImageEditorViewportTileLeaseV3 | null {
    if (this.disposed) return null
    const bytes = validateTile(request, tile)
    const existingLease = this.lease(request)
    if (existingLease) return existingLease
    if (bytes > this.maxBytes) return null
    const existing = this.entries.get(request.key)
    if (existing) return null
    if (!this.makeRoom(bytes)) return null
    const budgetLease = this.budget.acquire('cpu-cache', bytes)
    if (!budgetLease) return null
    const entry: ViewportTileCacheEntryV3 = {
      tile,
      bytes,
      budgetLease,
      leases: 0,
      touchedAt: ++this.sequence,
      evictWhenReleased: false,
    }
    this.entries.set(request.key, entry)
    this.usedBytes += bytes
    return this.lease(request)
  }

  delete(key: string): void {
    const entry = this.entries.get(key)
    if (!entry) return
    if (entry.leases > 0) {
      entry.evictWhenReleased = true
      return
    }
    this.removeEntry(key, entry)
  }

  clear(): void {
    for (const key of this.entries.keys()) this.delete(key)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const release of [...this.inFlightReleases]) release()
    this.clear()
  }

  snapshot(): ImageEditorViewportTileCacheSnapshotV3 {
    let leasedEntryCount = 0
    let leasedBytes = 0
    for (const entry of this.entries.values()) {
      if (entry.leases === 0) continue
      leasedEntryCount += 1
      leasedBytes += entry.bytes
    }
    return {
      maxBytes: this.maxBytes,
      usedBytes: this.usedBytes,
      entryCount: this.entries.size,
      leasedEntryCount,
      leasedBytes,
      disposed: this.disposed,
    }
  }

  private makeRoom(bytes: number): boolean {
    while (
      this.usedBytes > this.maxBytes - bytes
      || !this.budget.admission('cpu-cache', bytes).admitted
    ) {
      const candidate = this.oldestEvictable()
      if (!candidate) return false
      this.removeEntry(candidate[0], candidate[1])
    }
    return true
  }

  private oldestEvictable(): [string, ViewportTileCacheEntryV3] | null {
    let candidate: [string, ViewportTileCacheEntryV3] | null = null
    for (const pair of this.entries) {
      const entry = pair[1]
      if (entry.leases > 0 || entry.evictWhenReleased) continue
      if (!candidate || entry.touchedAt < candidate[1].touchedAt) candidate = pair
    }
    return candidate
  }

  private removeEntry(key: string, entry: ViewportTileCacheEntryV3): void {
    if (this.entries.get(key) !== entry) return
    this.entries.delete(key)
    this.usedBytes -= entry.bytes
    entry.budgetLease.release()
    try {
      this.onDisposeTile?.(entry.tile)
    } catch (error) {
      try {
        logger.warn('视口瓦片释放回调失败，缓存与资源账本已继续清理', {
          event: 'image_editor_v3.viewport_tile_cache.dispose_callback.failed',
          context: { key, message: error instanceof Error ? error.message : String(error) },
        })
      } catch {
        // 清理回调和日志都不得中断其余缓存条目的资源归还。
      }
    }
  }
}
