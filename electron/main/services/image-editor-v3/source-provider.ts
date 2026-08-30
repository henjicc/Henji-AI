import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { loadSharp } from '../image/sharp-loader'
import {
  AbortableSingleflight,
  imageSourceAbortError,
  throwIfImageSourceAborted,
} from './abortable-singleflight'
import {
  IMAGE_EDIT_TILE_SIZE,
  type FastSourceProxy,
  type ResourceId,
  type SourceImageMetadata,
  type SourceProvider,
  type SourcePyramidDescriptor,
  type SourcePyramidPrewarmRequest,
  type SourcePyramidPrewarmResult,
  type SourceTile,
  type SourceTileRequest,
} from './contracts'
import { DerivedDiskCache, type DerivedCacheAddress } from './derived-disk-cache'
import type { ContentAddressedResourceStore } from './resource-store'
import {
  cloneSourceMetadata,
  readNclxCicp,
  sourceBitsPerSample,
  sourceStorageBitDepth,
} from './source-metadata'
import { ManagedSourcePyramid, type SourcePyramidTileLayout } from './source-pyramid'

const MAX_MIP_LEVEL = 30
const MAX_TILE_HALO = 2048
/** 覆盖 200MP 目标并给极端长宽比留余量，同时拒绝无界解压。 */
export const IMAGE_EDIT_MAX_SOURCE_PIXELS = 1_000_000_000
export const IMAGE_EDIT_METADATA_CACHE_LIMIT = 256
const SOURCE_PROXY_CACHE_VERSION = 1

export interface SharpSourceProviderOptions {
  metadataCacheLimit?: number
  sharpLoader?: typeof loadSharp
  /** null 仅供故障隔离和精确测试；默认使用资源库同级的 8GiB 派生缓存。 */
  derivedCache?: DerivedDiskCache | null
}

interface DestroyableSharpPipeline {
  destroy(error?: Error): unknown
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid ${name}: ${value}`)
  return value
}

function normalizeRawLittleEndian(data: Buffer, bitDepth: 8 | 16 | 32): Buffer {
  if (os.endianness() === 'LE' || bitDepth === 8) return data
  return bitDepth === 16 ? data.swap16() : data.swap32()
}

async function runSharpOperation<T>(
  pipeline: DestroyableSharpPipeline,
  signal: AbortSignal | undefined,
  operation: () => Promise<T>,
): Promise<T> {
  if (signal?.aborted) {
    pipeline.destroy()
    throw imageSourceAbortError()
  }
  const onAbort = (): void => {
    pipeline.destroy(imageSourceAbortError())
  }
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    return await operation()
  } catch (error) {
    if (signal?.aborted) throw imageSourceAbortError()
    throw error
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }
}

function describeMetadataPyramid(metadata: SourceImageMetadata): SourcePyramidDescriptor {
  const levels: SourcePyramidDescriptor['levels'] = []
  for (let mip = 0; mip <= MAX_MIP_LEVEL; mip += 1) {
    const scale = 2 ** mip
    const width = Math.max(1, Math.ceil(metadata.width / scale))
    const height = Math.max(1, Math.ceil(metadata.height / scale))
    levels.push({
      mip,
      width,
      height,
      columns: Math.ceil(width / IMAGE_EDIT_TILE_SIZE),
      rows: Math.ceil(height / IMAGE_EDIT_TILE_SIZE),
    })
    if (width === 1 && height === 1) break
  }
  return { tileSize: IMAGE_EDIT_TILE_SIZE, levels }
}

function standardTileLayout(
  request: SourceTileRequest,
  metadata: SourceImageMetadata,
): SourcePyramidTileLayout {
  const mip = positiveInteger(request.mip, 'mip level')
  if (mip > MAX_MIP_LEVEL) throw new Error(`Mip level exceeds ${MAX_MIP_LEVEL}`)
  const tileX = positiveInteger(request.tileX, 'tile x')
  const tileY = positiveInteger(request.tileY, 'tile y')
  const scale = 2 ** mip
  const levelWidth = Math.max(1, Math.ceil(metadata.width / scale))
  const levelHeight = Math.max(1, Math.ceil(metadata.height / scale))
  const originX = tileX * IMAGE_EDIT_TILE_SIZE
  const originY = tileY * IMAGE_EDIT_TILE_SIZE
  if (originX >= levelWidth || originY >= levelHeight) {
    throw new Error(`Tile outside source pyramid: mip=${mip}, x=${tileX}, y=${tileY}`)
  }
  return {
    width: Math.min(IMAGE_EDIT_TILE_SIZE, levelWidth - originX),
    height: Math.min(IMAGE_EDIT_TILE_SIZE, levelHeight - originY),
    originX,
    originY,
    bitDepth: request.bitDepth ?? (metadata.hdr ? 32 : sourceStorageBitDepth(metadata)),
  }
}

/**
 * Sharp 始终直接接收受管资源路径：metadata 只读文件头，proxy/tile 由 libvips 按需解码；
 * 不经过 fs.readFile，也不会在 JS 堆里构造完整原图 RGBA 表面。
 */
export class SharpSourceProvider implements SourceProvider {
  private readonly metadataCache = new Map<ResourceId, SourceImageMetadata>()
  private readonly metadataFlights = new AbortableSingleflight<SourceImageMetadata>()
  private readonly proxyFlights = new AbortableSingleflight<FastSourceProxy>()
  private readonly metadataCacheLimit: number
  private readonly sharpLoader: typeof loadSharp
  private readonly derivedCache: DerivedDiskCache | null
  private readonly pyramid: ManagedSourcePyramid | null

  constructor(
    private readonly resources: ContentAddressedResourceStore,
    options: SharpSourceProviderOptions = {},
  ) {
    this.metadataCacheLimit = options.metadataCacheLimit ?? IMAGE_EDIT_METADATA_CACHE_LIMIT
    if (!Number.isSafeInteger(this.metadataCacheLimit) || this.metadataCacheLimit < 1) {
      throw new Error('Metadata cache limit must be a positive integer')
    }
    this.sharpLoader = options.sharpLoader ?? loadSharp
    this.derivedCache = options.derivedCache === undefined
      ? new DerivedDiskCache(path.resolve(this.resources.rootDir, '..', 'derived-cache'))
      : options.derivedCache
    this.pyramid = this.derivedCache
      ? new ManagedSourcePyramid(this.derivedCache, (request, signal) => (
        this.decodeTileWithinLease({ ...request, signal })
      ))
      : null
  }

  async readMetadata(resourceId: ResourceId, signal?: AbortSignal): Promise<SourceImageMetadata> {
    return this.withResourceLease(resourceId, signal, () => this.readMetadataWithinLease(resourceId, signal))
  }

  async describePyramid(resourceId: ResourceId, signal?: AbortSignal): Promise<SourcePyramidDescriptor> {
    const metadata = await this.readMetadata(resourceId, signal)
    return describeMetadataPyramid(metadata)
  }

  async prewarmPyramid(request: SourcePyramidPrewarmRequest): Promise<SourcePyramidPrewarmResult> {
    const pyramid = this.pyramid
    if (!pyramid) throw new Error('Source pyramid cache is disabled')
    return this.withResourceLease(request.resourceId, request.signal, async () => {
      const metadata = await this.readMetadataWithinLease(request.resourceId, request.signal)
      return pyramid.prewarm({
        ...request,
        bitDepth: request.bitDepth ?? (metadata.hdr ? 32 : sourceStorageBitDepth(metadata)),
      }, describeMetadataPyramid(metadata))
    })
  }

  async readFastProxy(
    resourceId: ResourceId,
    maxDimension: number,
    signal?: AbortSignal,
  ): Promise<FastSourceProxy> {
    if (!Number.isSafeInteger(maxDimension) || maxDimension < 32 || maxDimension > 16_384) {
      throw new Error(`Invalid source proxy dimension: ${maxDimension}`)
    }
    return this.withResourceLease(resourceId, signal, async () => {
      const metadata = await this.readMetadataWithinLease(resourceId, signal)
      if (metadata.hdr) {
        throw new Error('HDR source requires the Float32 tile preview path; SDR proxy conversion is disabled')
      }
      return this.proxyFlights.run(
        `${resourceId}:${maxDimension}`,
        (sharedSignal) => this.readFastProxyWithinLease(resourceId, maxDimension, sharedSignal),
        signal,
      )
    })
  }

  private async readFastProxyWithinLease(
    resourceId: ResourceId,
    maxDimension: number,
    signal: AbortSignal,
  ): Promise<FastSourceProxy> {
    const sharp = await this.sharpLoader()
    const address: DerivedCacheAddress = {
      kind: 'proxy',
      key: `v${SOURCE_PROXY_CACHE_VERSION}:${resourceId}:${maxDimension}:webp82-sdr`,
    }
    if (this.derivedCache) {
      try {
        const cached = await this.derivedCache.get(address)
        throwIfImageSourceAborted(signal)
        if (cached) {
          const metadataPipeline = sharp(cached, { failOn: 'error' })
          const metadata = await runSharpOperation(metadataPipeline, signal, () => metadataPipeline.metadata())
          if (metadata.width && metadata.height) {
            return { resourceId, width: metadata.width, height: metadata.height, format: 'webp', bytes: cached }
          }
          await this.derivedCache.invalidate(address)
        }
      } catch {
        throwIfImageSourceAborted(signal)
        await this.derivedCache.invalidate(address).catch(() => undefined)
      }
    }
    const pipeline = sharp(this.resources.getFilesystemPath(resourceId), {
      limitInputPixels: IMAGE_EDIT_MAX_SOURCE_PIXELS,
      sequentialRead: true,
      failOn: 'error',
    })
      .resize({
        width: maxDimension,
        height: maxDimension,
        fit: 'inside',
        withoutEnlargement: true,
        fastShrinkOnLoad: true,
      })
      .toColourspace('srgb')
      .webp({ quality: 82, effort: 2 })
    const { data, info } = await runSharpOperation(
      pipeline,
      signal,
      () => pipeline.toBuffer({ resolveWithObject: true }),
    )
    throwIfImageSourceAborted(signal)
    if (this.derivedCache && data.byteLength <= this.derivedCache.maxEntryBytes) {
      await this.derivedCache.put(address, data).catch(() => undefined)
    }
    return { resourceId, width: info.width, height: info.height, format: 'webp', bytes: data }
  }

  async readTile(request: SourceTileRequest): Promise<SourceTile> {
    return this.withResourceLease(request.resourceId, request.signal, async () => {
      if ((request.halo ?? 0) === 0 && this.pyramid) {
        const metadata = await this.readMetadataWithinLease(request.resourceId, request.signal)
        return this.pyramid.readTile(request, standardTileLayout(request, metadata))
      }
      return this.decodeTileWithinLease(request)
    })
  }

  async openOriginal(resourceId: ResourceId, signal?: AbortSignal): Promise<fs.ReadStream> {
    throwIfImageSourceAborted(signal)
    const lease = await this.resources.acquireLease([resourceId])
    try {
      throwIfImageSourceAborted(signal)
      const stream = fs.createReadStream(this.resources.getFilesystemPath(resourceId), { signal })
      let released = false
      const release = (): void => {
        if (released) return
        released = true
        void lease.release().catch(() => undefined)
      }
      stream.once('close', release)
      stream.once('error', release)
      return stream
    } catch (error) {
      await lease.release()
      throw error
    }
  }

  private async decodeTileWithinLease(request: SourceTileRequest): Promise<SourceTile> {
    const mip = positiveInteger(request.mip, 'mip level')
    if (mip > MAX_MIP_LEVEL) throw new Error(`Mip level exceeds ${MAX_MIP_LEVEL}`)
    const tileX = positiveInteger(request.tileX, 'tile x')
    const tileY = positiveInteger(request.tileY, 'tile y')
    const halo = positiveInteger(request.halo ?? 0, 'tile halo')
    if (halo > MAX_TILE_HALO) throw new Error(`Tile halo exceeds ${MAX_TILE_HALO}`)
    throwIfImageSourceAborted(request.signal)

    const metadata = await this.readMetadataWithinLease(request.resourceId, request.signal)
    const scale = 2 ** mip
    const levelWidth = Math.max(1, Math.ceil(metadata.width / scale))
    const levelHeight = Math.max(1, Math.ceil(metadata.height / scale))
    const tileOriginX = tileX * IMAGE_EDIT_TILE_SIZE
    const tileOriginY = tileY * IMAGE_EDIT_TILE_SIZE
    if (tileOriginX >= levelWidth || tileOriginY >= levelHeight) {
      throw new Error(`Tile outside source pyramid: mip=${mip}, x=${tileX}, y=${tileY}`)
    }

    const originX = Math.max(0, tileOriginX - halo)
    const originY = Math.max(0, tileOriginY - halo)
    const outputRight = Math.min(levelWidth, tileOriginX + IMAGE_EDIT_TILE_SIZE + halo)
    const outputBottom = Math.min(levelHeight, tileOriginY + IMAGE_EDIT_TILE_SIZE + halo)
    const outputWidth = outputRight - originX
    const outputHeight = outputBottom - originY
    const sourceLeft = Math.floor(originX * scale)
    const sourceTop = Math.floor(originY * scale)
    const sourceRight = Math.min(metadata.width, Math.ceil(outputRight * scale))
    const sourceBottom = Math.min(metadata.height, Math.ceil(outputBottom * scale))
    const bitDepth = request.bitDepth ?? (metadata.hdr ? 32 : sourceStorageBitDepth(metadata))
    if (metadata.hdr && bitDepth !== 32) {
      throw new Error('HDR source tiles require Float32 scRGB decoding; encoded integer fallback is disabled')
    }

    const sharp = await this.sharpLoader()
    let pipeline = sharp(this.resources.getFilesystemPath(request.resourceId), {
      limitInputPixels: IMAGE_EDIT_MAX_SOURCE_PIXELS,
      sequentialRead: false,
      failOn: 'error',
    }).extract({
      left: sourceLeft,
      top: sourceTop,
      width: sourceRight - sourceLeft,
      height: sourceBottom - sourceTop,
    })
    if (sourceRight - sourceLeft !== outputWidth || sourceBottom - sourceTop !== outputHeight) {
      pipeline = pipeline.resize(outputWidth, outputHeight, { fit: 'fill', kernel: 'lanczos3' })
    }
    if (bitDepth === 16) pipeline = pipeline.toColourspace('rgb16')
    else if (bitDepth === 32) pipeline = pipeline.toColourspace('scrgb')
    else pipeline = pipeline.toColourspace('srgb')
    const rawDepth = bitDepth === 8 ? 'uchar' : bitDepth === 16 ? 'ushort' : 'float'
    pipeline = pipeline.ensureAlpha().raw({ depth: rawDepth })
    const { data, info } = await runSharpOperation(
      pipeline,
      request.signal,
      () => pipeline.toBuffer({ resolveWithObject: true }),
    )
    throwIfImageSourceAborted(request.signal)
    return {
      resourceId: request.resourceId,
      mip,
      tileX,
      tileY,
      halo,
      width: info.width,
      height: info.height,
      channels: 4,
      bitDepth,
      sampleFormat: bitDepth === 32 ? 'float' : 'uint',
      numericRange: bitDepth === 32 ? 'scene-linear' : bitDepth === 16 ? 'unorm16' : 'unorm8',
      byteOrder: 'little-endian',
      rowStride: info.width * 4 * (bitDepth / 8),
      colorSpace: bitDepth === 32 ? 'scrgb' : 'srgb',
      transferFunction: bitDepth === 32 ? 'linear' : 'srgb',
      alphaMode: 'straight',
      orientationApplied: false,
      originX,
      originY,
      pixels: normalizeRawLittleEndian(data, bitDepth),
    }
  }

  private async readMetadataWithinLease(
    resourceId: ResourceId,
    signal?: AbortSignal,
  ): Promise<SourceImageMetadata> {
    throwIfImageSourceAborted(signal)
    const cached = this.metadataCache.get(resourceId)
    if (cached) {
      this.metadataCache.delete(resourceId)
      this.metadataCache.set(resourceId, cached)
      return cloneSourceMetadata(cached)
    }
    const metadata = await this.metadataFlights.run(resourceId, (sharedSignal) => (
      this.readMetadataUncached(resourceId, sharedSignal)
    ), signal)
    this.metadataCache.delete(resourceId)
    this.metadataCache.set(resourceId, metadata)
    while (this.metadataCache.size > this.metadataCacheLimit) {
      const oldest = this.metadataCache.keys().next().value as ResourceId | undefined
      if (!oldest) break
      this.metadataCache.delete(oldest)
    }
    return cloneSourceMetadata(metadata)
  }

  private async readMetadataUncached(
    resourceId: ResourceId,
    signal?: AbortSignal,
  ): Promise<SourceImageMetadata> {
    const sharp = await this.sharpLoader()
    const pipeline = sharp(this.resources.getFilesystemPath(resourceId), {
      limitInputPixels: IMAGE_EDIT_MAX_SOURCE_PIXELS,
      sequentialRead: true,
      failOn: 'error',
    })
    const metadata = await runSharpOperation(pipeline, signal, () => pipeline.metadata())
    if (!metadata.width || !metadata.height) throw new Error(`Image dimensions unavailable: ${resourceId}`)
    if (metadata.width * metadata.height > IMAGE_EDIT_MAX_SOURCE_PIXELS) {
      throw new Error(`Image exceeds ${IMAGE_EDIT_MAX_SOURCE_PIXELS} pixel safety limit: ${resourceId}`)
    }
    const bitsPerSample = sourceBitsPerSample(metadata)
    const cicp = await readNclxCicp(
      this.resources.getFilesystemPath(resourceId),
      metadata.format,
      signal,
    )
    const iccProfile = metadata.icc?.byteLength
      ? await this.resources.putBuffer(metadata.icc, {
        mediaType: 'application/vnd.iccprofile',
        signal,
      })
      : null
    return {
      resourceId,
      width: metadata.width,
      height: metadata.height,
      format: metadata.format,
      channels: metadata.channels,
      depth: metadata.depth,
      bitsPerSample,
      colorSpace: metadata.space,
      orientation: metadata.orientation,
      density: metadata.density,
      pages: metadata.pages,
      hasAlpha: metadata.hasAlpha ?? false,
      hasIccProfile: Boolean(metadata.icc?.byteLength),
      ...(iccProfile ? { iccProfileResourceId: iccProfile.id } : {}),
      cicp,
      hdr: cicp?.transferCharacteristics === 16
        || cicp?.transferCharacteristics === 18
        || metadata.space === 'scrgb'
        || metadata.depth === 'float'
        || metadata.depth === 'double',
    }
  }

  private async withResourceLease<T>(
    resourceId: ResourceId,
    signal: AbortSignal | undefined,
    operation: () => Promise<T>,
  ): Promise<T> {
    throwIfImageSourceAborted(signal)
    const lease = await this.resources.acquireLease([resourceId])
    try {
      throwIfImageSourceAborted(signal)
      const result = await operation()
      throwIfImageSourceAborted(signal)
      return result
    } finally {
      await lease.release()
    }
  }
}
