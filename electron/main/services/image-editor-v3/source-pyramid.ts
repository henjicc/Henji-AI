import { createMainLogger } from '../logging'
import { AbortableSingleflight, throwIfImageSourceAborted } from './abortable-singleflight'
import {
  IMAGE_EDIT_TILE_SIZE,
  type SourcePyramidDescriptor,
  type SourcePyramidLevel,
  type SourcePyramidPrewarmRequest,
  type SourcePyramidPrewarmResult,
  type SourceTile,
  type SourceTileRequest,
} from './contracts'
import {
  type DerivedCacheAddress,
  type DerivedDiskCache,
} from './derived-disk-cache'

const SOURCE_PYRAMID_CACHE_VERSION = 3
const DEFAULT_PREWARM_TILE_BUDGET = 4_096
const MAX_PREWARM_TILE_BUDGET = 100_000
const logger = createMainLogger('main.image_editor_v3.source_pyramid')

export interface SourcePyramidTileLayout {
  width: number
  height: number
  originX: number
  originY: number
  bitDepth: 8 | 16 | 32
}

export type SourcePyramidTileDecoder = (
  request: SourceTileRequest,
  signal: AbortSignal,
) => Promise<SourceTile>

export interface SourcePyramidRawLevelSeed {
  resourceId: SourceTileRequest['resourceId']
  level: SourcePyramidLevel
  bitDepth: 8 | 16 | 32
  rowStride: number
  pixels: Uint8Array
  signal?: AbortSignal
}

export interface SourcePyramidRawLevelRead {
  resourceId: SourceTileRequest['resourceId']
  level: SourcePyramidLevel
  bitDepth: 8 | 16 | 32
  maximumBytes: number
  signal?: AbortSignal
}

function bytesPerSample(bitDepth: 8 | 16 | 32): number {
  return bitDepth / 8
}

function expectedPixelBytes(layout: SourcePyramidTileLayout): number {
  return layout.width * layout.height * 4 * bytesPerSample(layout.bitDepth)
}

function validateLayout(layout: SourcePyramidTileLayout): void {
  if (
    !Number.isSafeInteger(layout.width)
    || layout.width < 1
    || layout.width > IMAGE_EDIT_TILE_SIZE
    || !Number.isSafeInteger(layout.height)
    || layout.height < 1
    || layout.height > IMAGE_EDIT_TILE_SIZE
    || !Number.isSafeInteger(layout.originX)
    || layout.originX < 0
    || !Number.isSafeInteger(layout.originY)
    || layout.originY < 0
  ) {
    throw new Error('Invalid source pyramid tile layout')
  }
}

export function sourcePyramidCacheAddress(
  request: Pick<SourceTileRequest, 'resourceId' | 'mip' | 'tileX' | 'tileY'>,
  layout: SourcePyramidTileLayout,
): DerivedCacheAddress {
  return {
    kind: 'pyramid',
    key: [
      `v${SOURCE_PYRAMID_CACHE_VERSION}`,
      request.resourceId,
      request.mip,
      request.tileX,
      request.tileY,
      layout.width,
      layout.height,
      layout.originX,
      layout.originY,
      `rgba${layout.bitDepth}`,
      'normalized-source-orientation',
    ].join(':'),
  }
}

function createTile(
  request: Pick<SourceTileRequest, 'resourceId' | 'mip' | 'tileX' | 'tileY'>,
  layout: SourcePyramidTileLayout,
  pixels: Buffer,
): SourceTile {
  const bitDepth = layout.bitDepth
  return {
    resourceId: request.resourceId,
    mip: request.mip,
    tileX: request.tileX,
    tileY: request.tileY,
    halo: 0,
    width: layout.width,
    height: layout.height,
    channels: 4,
    bitDepth,
    sampleFormat: bitDepth === 32 ? 'float' : 'uint',
    numericRange: bitDepth === 32 ? 'scene-linear' : bitDepth === 16 ? 'unorm16' : 'unorm8',
    byteOrder: 'little-endian',
    rowStride: layout.width * 4 * bytesPerSample(bitDepth),
    colorSpace: bitDepth === 32 ? 'scrgb' : 'srgb',
    transferFunction: bitDepth === 32 ? 'linear' : 'srgb',
    alphaMode: 'straight',
    orientationApplied: true,
    originX: layout.originX,
    originY: layout.originY,
    pixels,
  }
}

function validateDecodedTile(
  tile: SourceTile,
  request: SourceTileRequest,
  layout: SourcePyramidTileLayout,
): void {
  if (
    tile.resourceId !== request.resourceId
    || tile.mip !== request.mip
    || tile.tileX !== request.tileX
    || tile.tileY !== request.tileY
    || tile.halo !== 0
    || tile.width !== layout.width
    || tile.height !== layout.height
    || tile.originX !== layout.originX
    || tile.originY !== layout.originY
    || tile.bitDepth !== layout.bitDepth
    || tile.channels !== 4
    || tile.rowStride !== layout.width * 4 * bytesPerSample(layout.bitDepth)
    || tile.alphaMode !== 'straight'
    || tile.orientationApplied !== true
    || tile.pixels.byteLength !== expectedPixelBytes(layout)
  ) {
    throw new Error('Source pyramid decoder returned an incompatible tile')
  }
}

function tileLayout(
  level: SourcePyramidDescriptor['levels'][number],
  tileX: number,
  tileY: number,
  bitDepth: 8 | 16 | 32,
): SourcePyramidTileLayout {
  const originX = tileX * IMAGE_EDIT_TILE_SIZE
  const originY = tileY * IMAGE_EDIT_TILE_SIZE
  return {
    width: Math.min(IMAGE_EDIT_TILE_SIZE, level.width - originX),
    height: Math.min(IMAGE_EDIT_TILE_SIZE, level.height - originY),
    originX,
    originY,
    bitDepth,
  }
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

/**
 * 受管源金字塔只缓存标准无 halo 瓦片。每个条目独立原子发布，缓存失败会降级为直接瓦片，
 * 不会为任何 mip 建立完整 RGBA 表面。
 */
export class ManagedSourcePyramid {
  private readonly flights = new AbortableSingleflight<SourceTile>()

  constructor(
    private readonly cache: DerivedDiskCache,
    private readonly decodeTile: SourcePyramidTileDecoder,
  ) {}

  async readTile(request: SourceTileRequest, layout: SourcePyramidTileLayout): Promise<SourceTile> {
    if ((request.halo ?? 0) !== 0) throw new Error('Source pyramid cache only accepts zero-halo tiles')
    validateLayout(layout)
    const address = sourcePyramidCacheAddress(request, layout)
    return this.flights.run(address.key, (signal) => (
      this.loadOrCreateTile({ ...request, halo: 0, bitDepth: layout.bitDepth }, layout, address, signal)
    ), request.signal)
  }

  async hasCompleteLevel(
    resourceId: SourceTileRequest['resourceId'],
    level: SourcePyramidLevel,
    bitDepth: 8 | 16 | 32,
  ): Promise<boolean> {
    for (let tileY = 0; tileY < level.rows; tileY += 1) {
      for (let tileX = 0; tileX < level.columns; tileX += 1) {
        const layout = tileLayout(level, tileX, tileY, bitDepth)
        const address = sourcePyramidCacheAddress({ resourceId, mip: level.mip, tileX, tileY }, layout)
        const lease = await this.cache.acquireFileLease(address)
        if (!lease) return false
        const valid = lease.byteLength === expectedPixelBytes(layout)
        await lease.release()
        if (!valid) {
          await this.cache.invalidate(address)
          return false
        }
      }
    }
    return true
  }

  /**
   * 逐个源瓦片拼出一个有严格字节上限的代理 mip。这样极端长宽比图片不会因一次
   * 全宽 libvips resize 保留接近完整源图的中间扫描线，同时每个已解码瓦片仍会发布到缓存。
   */
  async readBoundedRawLevel(read: SourcePyramidRawLevelRead): Promise<Buffer> {
    const { level, bitDepth } = read
    const rowStride = level.width * 4 * bytesPerSample(bitDepth)
    const byteLength = rowStride * level.height
    if (
      !Number.isSafeInteger(read.maximumBytes)
      || read.maximumBytes < 1
      || !Number.isSafeInteger(byteLength)
      || byteLength > read.maximumBytes
      || level.columns !== Math.ceil(level.width / IMAGE_EDIT_TILE_SIZE)
      || level.rows !== Math.ceil(level.height / IMAGE_EDIT_TILE_SIZE)
    ) throw new Error('Source pyramid raw level exceeds its bounded allocation')
    const pixels = Buffer.allocUnsafe(byteLength)
    for (let tileY = 0; tileY < level.rows; tileY += 1) {
      for (let tileX = 0; tileX < level.columns; tileX += 1) {
        throwIfImageSourceAborted(read.signal)
        const layout = tileLayout(level, tileX, tileY, bitDepth)
        const tile = await this.readTile({
          resourceId: read.resourceId,
          mip: level.mip,
          tileX,
          tileY,
          bitDepth,
          signal: read.signal,
        }, layout)
        for (let row = 0; row < layout.height; row += 1) {
          const sourceStart = row * tile.rowStride
          const targetStart = (layout.originY + row) * rowStride
            + layout.originX * 4 * bytesPerSample(bitDepth)
          pixels.set(
            tile.pixels.subarray(sourceStart, sourceStart + tile.rowStride),
            targetStart,
          )
        }
        await yieldToEventLoop()
      }
    }
    return pixels
  }

  /** 将一次有界下采样得到的完整 mip 拆成权威 512 缓存瓦片，后续视口不再重解原图。 */
  async seedRawLevel(seed: SourcePyramidRawLevelSeed): Promise<number> {
    const { level, bitDepth } = seed
    const channelBytes = bytesPerSample(bitDepth)
    const packedRowBytes = level.width * 4 * channelBytes
    if (
      seed.rowStride < packedRowBytes
      || seed.pixels.byteLength < seed.rowStride * level.height
      || level.columns !== Math.ceil(level.width / IMAGE_EDIT_TILE_SIZE)
      || level.rows !== Math.ceil(level.height / IMAGE_EDIT_TILE_SIZE)
    ) throw new Error('Invalid source pyramid raw level seed')
    let publishedTiles = 0
    for (let tileY = 0; tileY < level.rows; tileY += 1) {
      for (let tileX = 0; tileX < level.columns; tileX += 1) {
        throwIfImageSourceAborted(seed.signal)
        const layout = tileLayout(level, tileX, tileY, bitDepth)
        const request = { resourceId: seed.resourceId, mip: level.mip, tileX, tileY }
        const address = sourcePyramidCacheAddress(request, layout)
        const cached = await this.cache.acquireFileLease(address)
        if (cached?.byteLength === expectedPixelBytes(layout)) {
          await cached.release()
          publishedTiles += 1
          continue
        }
        await cached?.release()
        if (cached) await this.cache.invalidate(address)
        const tileRowBytes = layout.width * 4 * channelBytes
        const pixels = Buffer.allocUnsafe(tileRowBytes * layout.height)
        for (let row = 0; row < layout.height; row += 1) {
          const sourceStart = (layout.originY + row) * seed.rowStride
            + layout.originX * 4 * channelBytes
          pixels.set(seed.pixels.subarray(sourceStart, sourceStart + tileRowBytes), row * tileRowBytes)
        }
        try {
          await this.cache.put(address, pixels)
          publishedTiles += 1
        } catch (error) {
          throwIfImageSourceAborted(seed.signal)
          logger.warn('发布图片源金字塔种子瓦片失败，保留按需解码降级', {
            event: 'image_editor_v3.source_pyramid.seed_write.failed',
            context: { resourceId: seed.resourceId, mip: level.mip, tileX, tileY },
            error,
          })
        }
      }
    }
    return publishedTiles
  }

  async prewarm(
    request: SourcePyramidPrewarmRequest & { bitDepth: 8 | 16 | 32 },
    descriptor: SourcePyramidDescriptor,
  ): Promise<SourcePyramidPrewarmResult> {
    const minimumMip = request.minimumMip ?? 0
    const maximumMip = request.maximumMip ?? descriptor.levels.at(-1)?.mip ?? 0
    const tileBudget = request.tileBudget ?? DEFAULT_PREWARM_TILE_BUDGET
    if (
      !Number.isSafeInteger(minimumMip)
      || !Number.isSafeInteger(maximumMip)
      || minimumMip < 0
      || maximumMip < minimumMip
      || !Number.isSafeInteger(tileBudget)
      || tileBudget < 1
      || tileBudget > MAX_PREWARM_TILE_BUDGET
    ) {
      throw new Error('Invalid source pyramid prewarm range')
    }
    const levels = descriptor.levels
      .filter((level) => level.mip >= minimumMip && level.mip <= maximumMip)
      .sort((left, right) => right.mip - left.mip)
    const availableTiles = levels.reduce((sum, level) => sum + level.columns * level.rows, 0)
    const plannedTiles = Math.min(availableTiles, tileBudget)
    let completedTiles = 0
    throwIfImageSourceAborted(request.signal)
    logger.info('开始预热图片源瓦片金字塔', {
      event: 'image_editor_v3.source_pyramid.prewarm.start',
      context: { resourceId: request.resourceId, plannedTiles, bitDepth: request.bitDepth },
    })
    try {
      for (const level of levels) {
        for (let tileY = 0; tileY < level.rows; tileY += 1) {
          for (let tileX = 0; tileX < level.columns; tileX += 1) {
            if (completedTiles >= plannedTiles) break
            throwIfImageSourceAborted(request.signal)
            await this.readTile({
              resourceId: request.resourceId,
              mip: level.mip,
              tileX,
              tileY,
              halo: 0,
              bitDepth: request.bitDepth,
              signal: request.signal,
            }, tileLayout(level, tileX, tileY, request.bitDepth))
            completedTiles += 1
            await yieldToEventLoop()
          }
          if (completedTiles >= plannedTiles) break
        }
        if (completedTiles >= plannedTiles) break
      }
      throwIfImageSourceAborted(request.signal)
      const result = { plannedTiles, completedTiles, truncated: plannedTiles < availableTiles }
      logger.info('完成图片源瓦片金字塔预热', {
        event: 'image_editor_v3.source_pyramid.prewarm.completed',
        context: { resourceId: request.resourceId, ...result },
      })
      return result
    } catch (error) {
      const context = { resourceId: request.resourceId, plannedTiles, completedTiles }
      if (request.signal?.aborted) {
        logger.debug('取消图片源瓦片金字塔预热', {
          event: 'image_editor_v3.source_pyramid.prewarm.cancelled', context,
        })
      } else {
        logger.warn('图片源瓦片金字塔预热失败', {
          event: 'image_editor_v3.source_pyramid.prewarm.failed', context, error,
        })
      }
      throw error
    }
  }

  private async loadOrCreateTile(
    request: SourceTileRequest,
    layout: SourcePyramidTileLayout,
    address: DerivedCacheAddress,
    signal: AbortSignal,
  ): Promise<SourceTile> {
    throwIfImageSourceAborted(signal)
    try {
      const cached = await this.cache.get(address)
      throwIfImageSourceAborted(signal)
      if (cached?.byteLength === expectedPixelBytes(layout)) return createTile(request, layout, cached)
      if (cached) await this.cache.invalidate(address)
    } catch (error) {
      throwIfImageSourceAborted(signal)
      logger.warn('读取图片源金字塔缓存失败，改用源文件解码', {
        event: 'image_editor_v3.source_pyramid.cache_read.failed',
        context: { resourceId: request.resourceId, mip: request.mip, tileX: request.tileX, tileY: request.tileY },
        error,
      })
    }
    const tile = await this.decodeTile({ ...request, signal }, signal)
    validateDecodedTile(tile, request, layout)
    throwIfImageSourceAborted(signal)
    if (tile.pixels.byteLength <= this.cache.maxEntryBytes) {
      try {
        await this.cache.put(address, tile.pixels)
      } catch (error) {
        logger.warn('发布图片源金字塔缓存失败，保留当前解码结果', {
          event: 'image_editor_v3.source_pyramid.cache_write.failed',
          context: { resourceId: request.resourceId, mip: request.mip, tileX: request.tileX, tileY: request.tileY },
          error,
        })
      }
    }
    throwIfImageSourceAborted(signal)
    return tile
  }
}
