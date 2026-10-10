import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { assertImageEditorV3SourceColor } from './source-ingest/release-source-capabilities'
import { decodeTransferFunctionV3, encodeTransferFunctionV3, linearWorkingSpaceMatrixV3 } from '../../../../src/core/imaging/colorManagement/rgb'
import { standardRgbProfile } from './export/standard-profiles'
import { loadSharp } from '../image/sharp-loader'
import { AbortableSingleflight, throwIfImageSourceAborted } from './abortable-singleflight'
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
import { DerivedDiskCache } from './derived-disk-cache'
import type { ContentAddressedResourceStore } from './resource-store'
import { readFastSourceProxy } from './source-fast-proxy'
import {
  cloneSourceMetadata,
  readNclxCicp,
  sourceBitsPerSample,
  sourceStorageBitDepth,
} from './source-metadata'
import {
  mapOrientedSourceRectToEncoded,
  normalizeSourceExifOrientation,
  orientedSourceDimensions,
} from './source-orientation'
import { ManagedSourcePyramid, type SourcePyramidTileLayout } from './source-pyramid'
import { runSharpOperation } from './sharp-operation'
import { SourceDecodeStripeCache } from './source-decode-stripes'
import { createMainLogger } from '../logging'

const logger = createMainLogger('main.image_editor_v3.source_provider')

const MAX_MIP_LEVEL = 30
const MAX_TILE_HALO = 2048
const MAX_SOURCE_ICC_PROFILE_BYTES = 16 * 1024 * 1024
/** 覆盖 200MP 目标并给极端长宽比留余量，同时拒绝无界解压。 */
export const IMAGE_EDIT_MAX_SOURCE_PIXELS = 1_000_000_000
export const IMAGE_EDIT_METADATA_CACHE_LIMIT = 256

export interface SharpSourceProviderOptions {
  metadataCacheLimit?: number
  sharpLoader?: typeof loadSharp
  /** null 仅供故障隔离和精确测试；默认使用资源库同级的 8GiB 派生缓存。 */
  derivedCache?: DerivedDiskCache | null
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid ${name}: ${value}`)
  return value
}

function normalizeRawLittleEndian(data: Buffer, bitDepth: 8 | 16 | 32): Buffer {
  if (os.endianness() === 'LE' || bitDepth === 8) return data
  return bitDepth === 16 ? data.swap16() : data.swap32()
}

/** 标准 P3 沿已验证的共享 D65 数学转到 scRGB；保留超白、负值与 Alpha。 */
function decodeStandardRgb(bytes: Buffer, space: 'srgb' | 'display-p3', bitDepth: 8 | 16 | 32 = 32): Buffer {
  const raw = normalizeRawLittleEndian(bytes, 16), matrix = linearWorkingSpaceMatrixV3(space, 'srgb');
  const bytesPerSample = bitDepth / 8;
  const output = Buffer.allocUnsafe(raw.length / 2 * bytesPerSample);
  const write = (value: number, index: number) => {
    if (bitDepth === 32) output.writeFloatLE(value, index * bytesPerSample);
    else {
      const maximum = bitDepth === 8 ? 255 : 65535;
      const integer = Math.round(Math.min(1, Math.max(0, value)) * maximum);
      if (bitDepth === 8) output.writeUInt8(integer, index);
      else output.writeUInt16LE(integer, index * 2);
    }
  };
  for (let offset = 0; offset < raw.length; offset += 8) {
    const r = decodeTransferFunctionV3(raw.readUInt16LE(offset) / 65535, 'srgb');
    const g = decodeTransferFunctionV3(raw.readUInt16LE(offset + 2) / 65535, 'srgb');
    const b = decodeTransferFunctionV3(raw.readUInt16LE(offset + 4) / 65535, 'srgb');
    for (let channel = 0; channel < 3; channel++) {
      const linear = matrix[channel * 3] * r + matrix[channel * 3 + 1] * g + matrix[channel * 3 + 2] * b;
      write(bitDepth === 32 ? linear : encodeTransferFunctionV3(linear, 'srgb'), offset / 2 + channel);
    }
    write(raw.readUInt16LE(offset + 6) / 65535, offset / 2 + 3);
  }
  return output;
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
    bitDepth: request.bitDepth ?? (metadata.colorSpace === 'display-p3' ? 32 : sourceStorageBitDepth(metadata)),
  }
}

/**
 * Sharp 始终直接接收受管资源路径：metadata 只读文件头，proxy/tile 在源边界应用 EXIF
 * 方向并由 libvips 按需解码；不经过 fs.readFile，也不会在 JS 堆里构造完整原图 RGBA 表面。
 */
export class SharpSourceProvider implements SourceProvider {
  private readonly metadataCache = new Map<ResourceId, SourceImageMetadata>()
  private readonly metadataFlights = new AbortableSingleflight<SourceImageMetadata>()
  private readonly proxyFlights = new AbortableSingleflight<FastSourceProxy>()
  private standardSrgbProfileResourceId: ResourceId | null = null;
  private readonly metadataCacheLimit: number
  private readonly sharpLoader: typeof loadSharp
  private readonly derivedCache: DerivedDiskCache | null
  private readonly pyramid: ManagedSourcePyramid | null
  private readonly decodeStripes = new SourceDecodeStripeCache()

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
      assertImageEditorV3SourceColor(metadata)
      return pyramid.prewarm({
        ...request,
        bitDepth: request.bitDepth ?? (metadata.colorSpace === 'display-p3' ? 32 : sourceStorageBitDepth(metadata)),
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
      assertImageEditorV3SourceColor(metadata)
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
    const metadata = await this.readMetadataWithinLease(resourceId, signal);
    assertImageEditorV3SourceColor(metadata);
    return readFastSourceProxy({
      resourceId,
      sourcePath: this.resources.getFilesystemPath(resourceId),
      metadata,
      maxDimension,
      maximumInputPixels: IMAGE_EDIT_MAX_SOURCE_PIXELS,
      sharpLoader: this.sharpLoader,
      cache: this.derivedCache,
      pyramid: this.pyramid,
      signal,
    })
  }

  async readTile(request: SourceTileRequest): Promise<SourceTile> {
    return this.withResourceLease(request.resourceId, request.signal, async () => {
      const sourceMetadata = await this.readMetadataWithinLease(request.resourceId, request.signal);
      assertImageEditorV3SourceColor(sourceMetadata);
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
    assertImageEditorV3SourceColor(metadata)
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
    const encodedRegion = mapOrientedSourceRectToEncoded({
      left: sourceLeft,
      top: sourceTop,
      width: sourceRight - sourceLeft,
      height: sourceBottom - sourceTop,
    }, {
      width: metadata.encodedWidth,
      height: metadata.encodedHeight,
    }, metadata.orientation)
    const bitDepth = request.bitDepth ?? (metadata.colorSpace === 'display-p3' ? 32 : sourceStorageBitDepth(metadata))

    // mip0 的横向相邻块共享一次原生全宽条带解码，避免 PNG/JPEG 从文件头重复扫描。
    // 只保留两个有界条带，不建立完整 RGBA 表面；HDR 与缩放继续走原区域契约。
    if (mip === 0 && halo === 0 && (bitDepth !== 32 || metadata.colorSpace === 'display-p3')
      && metadata.width > IMAGE_EDIT_TILE_SIZE && metadata.height > IMAGE_EDIT_TILE_SIZE) {
      const stripeStride = metadata.width * 4 * (bitDepth / 8)
      const stripe = await this.decodeStripes.read(
        `${request.resourceId}:${tileY}:${bitDepth}`,
        stripeStride * outputHeight,
        async (signal) => {
          const started = performance.now()
          const context = { resourceId: request.resourceId, tileY, bitDepth, bytes: stripeStride * outputHeight }
          logger.debug('开始解码图片源条带', { event: 'image_editor_v3.source.stripe.start', context })
          try {
            const sharp = await this.sharpLoader()
            const encoded = mapOrientedSourceRectToEncoded({ left: 0, top: originY,
              width: metadata.width, height: outputHeight },
            { width: metadata.encodedWidth, height: metadata.encodedHeight }, metadata.orientation)
            let pipeline = sharp(this.resources.getFilesystemPath(request.resourceId), {
              limitInputPixels: IMAGE_EDIT_MAX_SOURCE_PIXELS, sequentialRead: false, failOn: 'warning',
            }).extract(encoded).autoOrient().toColourspace(bitDepth === 16 ? 'rgb16' : 'srgb')
              .ensureAlpha().raw({ depth: bitDepth === 16 ? 'ushort' : 'uchar' })
            const standardP3 = metadata.colorSpace === 'display-p3';
            const standardSrgb = metadata.iccProfileResourceId === this.standardSrgbProfileResourceId;
            if (standardP3 || standardSrgb) pipeline = pipeline.keepIccProfile().toColourspace(standardP3 || bitDepth !== 8 ? 'rgb16' : 'srgb').raw({ depth: standardP3 || bitDepth !== 8 ? 'ushort' : 'uchar' });
            else if (metadata.hasIccProfile) pipeline = pipeline.withIccProfile('srgb', { attach: false });
            const decoded = await runSharpOperation(pipeline, signal, () => pipeline.toBuffer());
            const pixels = standardP3 ? decodeStandardRgb(decoded, 'display-p3', bitDepth) : normalizeRawLittleEndian(decoded, bitDepth);
            logger.debug('完成解码图片源条带', { event: 'image_editor_v3.source.stripe.completed',
              context: { ...context, elapsedMs: performance.now() - started } })
            return pixels
          } catch (error) {
            logger.debug('图片源条带解码未完成', { event: signal.aborted
              ? 'image_editor_v3.source.stripe.cancelled' : 'image_editor_v3.source.stripe.failed', context, error })
            throw error
          }
        },
        request.signal,
      )
      if (stripe) {
        throwIfImageSourceAborted(request.signal)
        const rowStride = outputWidth * 4 * (bitDepth / 8)
        const pixels = Buffer.allocUnsafe(rowStride * outputHeight)
        for (let row = 0; row < outputHeight; row += 1) {
          const start = row * stripeStride + originX * 4 * (bitDepth / 8)
          stripe.copy(pixels, row * rowStride, start, start + rowStride)
        }
        return { resourceId: request.resourceId, mip, tileX, tileY, halo,
          width: outputWidth, height: outputHeight, channels: 4, bitDepth,
          sampleFormat: bitDepth === 32 ? 'float' : 'uint', numericRange: bitDepth === 32 ? 'scene-linear' : bitDepth === 16 ? 'unorm16' : 'unorm8',
          byteOrder: 'little-endian', rowStride, colorSpace: bitDepth === 32 ? 'scrgb' : 'srgb', transferFunction: bitDepth === 32 ? 'linear' : 'srgb',
          alphaMode: 'straight', orientationApplied: true, originX, originY, pixels }
      }
    }

    const sharp = await this.sharpLoader()
    let pipeline = sharp(this.resources.getFilesystemPath(request.resourceId), {
      limitInputPixels: IMAGE_EDIT_MAX_SOURCE_PIXELS,
      sequentialRead: false,
      failOn: 'warning',
    }).extract({
      left: encodedRegion.left,
      top: encodedRegion.top,
      width: encodedRegion.width,
      height: encodedRegion.height,
    }).autoOrient()
    if (sourceRight - sourceLeft !== outputWidth || sourceBottom - sourceTop !== outputHeight) {
      pipeline = pipeline.resize(outputWidth, outputHeight, { fit: 'fill', kernel: 'lanczos3' })
    }
    const standardP3 = metadata.colorSpace === 'display-p3';
    const standardSrgb = metadata.iccProfileResourceId === this.standardSrgbProfileResourceId;
    const integerIccFloat = !standardP3 && metadata.hasIccProfile && bitDepth === 32;
    if (standardP3 || standardSrgb) pipeline = pipeline.keepIccProfile().toColourspace(standardP3 || bitDepth !== 8 ? 'rgb16' : 'srgb');
    else if (bitDepth === 16 || integerIccFloat) pipeline = pipeline.toColourspace('rgb16')
    else if (bitDepth === 32) pipeline = pipeline.toColourspace('scrgb')
    else pipeline = pipeline.toColourspace('srgb')
    if (!standardP3 && !standardSrgb && metadata.hasIccProfile) pipeline = pipeline.withIccProfile('srgb', { attach: false });
    const rawDepth = standardP3 || integerIccFloat ? 'ushort' : bitDepth === 8 ? 'uchar' : bitDepth === 16 ? 'ushort' : 'float'
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
      orientationApplied: true,
      originX,
      originY,
      pixels: standardP3 || integerIccFloat ? decodeStandardRgb(data, standardP3 ? 'display-p3' : 'srgb', bitDepth) : normalizeRawLittleEndian(data, bitDepth),
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
      failOn: 'warning',
    })
    const metadata = await runSharpOperation(pipeline, signal, () => pipeline.metadata())
    if (!metadata.width || !metadata.height) throw new Error(`Image dimensions unavailable: ${resourceId}`)
    if (metadata.width * metadata.height > IMAGE_EDIT_MAX_SOURCE_PIXELS) {
      throw new Error(`Image exceeds ${IMAGE_EDIT_MAX_SOURCE_PIXELS} pixel safety limit: ${resourceId}`)
    }
    const bitsPerSample = sourceBitsPerSample(metadata)
    const orientation = normalizeSourceExifOrientation(metadata.orientation)
    const orientedDimensions = orientedSourceDimensions({
      width: metadata.width,
      height: metadata.height,
    }, orientation)
    if (
      metadata.autoOrient.width !== orientedDimensions.width
      || metadata.autoOrient.height !== orientedDimensions.height
    ) {
      throw new Error(`Sharp returned inconsistent auto-oriented dimensions: ${resourceId}`)
    }
    const cicp = await readNclxCicp(
      this.resources.getFilesystemPath(resourceId),
      metadata.format,
      signal,
    )
    if ((metadata.icc?.byteLength ?? 0) > MAX_SOURCE_ICC_PROFILE_BYTES) {
      throw new Error(`Source ICC profile exceeds ${MAX_SOURCE_ICC_PROFILE_BYTES} bytes`)
    }
    const iccProfile = metadata.icc?.byteLength
      ? await this.resources.putBuffer(metadata.icc, {
        mediaType: 'application/vnd.iccprofile',
        signal,
      })
      : null
    if (iccProfile && metadata.icc?.equals(await standardRgbProfile('srgb'))) this.standardSrgbProfileResourceId = iccProfile.id;
    return {
      resourceId,
      width: orientedDimensions.width,
      height: orientedDimensions.height,
      encodedWidth: metadata.width,
      encodedHeight: metadata.height,
      format: metadata.format,
      channels: metadata.channels,
      depth: metadata.depth,
      bitsPerSample,
      colorSpace: metadata.icc?.equals(await standardRgbProfile('display-p3')) ? 'display-p3' : metadata.space,
      orientation,
      orientationApplied: true,
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
