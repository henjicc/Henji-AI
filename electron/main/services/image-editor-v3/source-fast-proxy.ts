import { createMainLogger } from '../logging'
import { loadSharp } from '../image/sharp-loader'
import { throwIfImageSourceAborted } from './abortable-singleflight'
import {
  IMAGE_EDIT_TILE_SIZE,
  type FastSourceProxy,
  type ResourceId,
  type SourceImageMetadata,
  type SourcePyramidLevel,
} from './contracts'
import type { DerivedCacheAddress, DerivedDiskCache } from './derived-disk-cache'
import { sourceStorageBitDepth } from './source-metadata'
import type { ManagedSourcePyramid } from './source-pyramid'
import { runSharpOperation } from './sharp-operation'

const logger = createMainLogger('main.image_editor_v3.source_proxy')
const SOURCE_PROXY_CACHE_VERSION = 3
const MAX_FAST_PROXY_BASE_LEVEL_BYTES = 48 * 1024 * 1024

interface FastProxyPyramidSeedPlan {
  levels: readonly SourcePyramidLevel[]
  baseByteLength: number
}

export interface ReadFastSourceProxyOptions {
  resourceId: ResourceId
  sourcePath: string
  metadata: SourceImageMetadata
  maxDimension: number
  maximumInputPixels: number
  sharpLoader: typeof loadSharp
  cache: DerivedDiskCache | null
  pyramid: ManagedSourcePyramid | null
  signal?: AbortSignal
}

function safeRgbaBytes(width: number, height: number): number {
  const byteLength = width * height * 4
  return Number.isSafeInteger(byteLength) ? byteLength : Number.MAX_SAFE_INTEGER
}

/**
 * 代理尺寸附近的第一个 mip 最大边小于 2×maxDimension，因此完整 base level 仍有硬上限；
 * 它只为 8-bit SDR 建立，避免把 16-bit/HDR 权威像素偷降为 8-bit。
 */
function planFastProxyPyramidSeed(
  metadata: SourceImageMetadata,
  maxDimension: number,
): FastProxyPyramidSeedPlan | null {
  if (metadata.hdr || sourceStorageBitDepth(metadata) !== 8) return null
  const ratio = Math.max(metadata.width / maxDimension, metadata.height / maxDimension)
  const baseMip = Math.max(0, Math.floor(Math.log2(Math.max(1, ratio))))
  if (baseMip === 0) return null
  const scale = 2 ** baseMip
  let width = Math.max(1, Math.ceil(metadata.width / scale))
  let height = Math.max(1, Math.ceil(metadata.height / scale))
  const baseByteLength = safeRgbaBytes(width, height)
  if (baseByteLength > MAX_FAST_PROXY_BASE_LEVEL_BYTES) return null
  const levels: SourcePyramidLevel[] = []
  for (let mip = baseMip; mip <= 30; mip += 1) {
    levels.push({
      mip,
      width,
      height,
      columns: Math.ceil(width / IMAGE_EDIT_TILE_SIZE),
      rows: Math.ceil(height / IMAGE_EDIT_TILE_SIZE),
    })
    if (width === 1 && height === 1) break
    width = Math.max(1, Math.ceil(width / 2))
    height = Math.max(1, Math.ceil(height / 2))
  }
  return { levels, baseByteLength }
}

async function readCachedProxy(
  sharp: Awaited<ReturnType<typeof loadSharp>>,
  cache: DerivedDiskCache,
  address: DerivedCacheAddress,
  resourceId: ResourceId,
  signal?: AbortSignal,
): Promise<FastSourceProxy | null> {
  try {
    const cached = await cache.get(address)
    throwIfImageSourceAborted(signal)
    if (!cached) return null
    const pipeline = sharp(cached, { failOn: 'warning' })
    const metadata = await runSharpOperation(pipeline, signal, () => pipeline.metadata())
    if (metadata.width && metadata.height) {
      return { resourceId, width: metadata.width, height: metadata.height, format: 'webp', bytes: cached }
    }
  } catch {
    throwIfImageSourceAborted(signal)
  }
  await cache.invalidate(address).catch(() => undefined)
  return null
}

async function hasSeedChain(
  pyramid: ManagedSourcePyramid,
  resourceId: ResourceId,
  plan: FastProxyPyramidSeedPlan,
): Promise<boolean> {
  for (const level of plan.levels) {
    if (!(await pyramid.hasCompleteLevel(resourceId, level, 8))) return false
  }
  return true
}

async function resizeRawLevel(
  sharp: Awaited<ReturnType<typeof loadSharp>>,
  pixels: Buffer,
  source: SourcePyramidLevel,
  target: SourcePyramidLevel,
  signal?: AbortSignal,
): Promise<Buffer> {
  const pipeline = sharp(pixels, {
    raw: { width: source.width, height: source.height, channels: 4 },
    failOn: 'warning',
  }).resize({
    width: target.width,
    height: target.height,
    fit: 'fill',
    kernel: 'lanczos3',
  }).raw({ depth: 'uchar' })
  return runSharpOperation(pipeline, signal, () => pipeline.toBuffer())
}

async function decodeRawBaseLevelFromSource(
  options: ReadFastSourceProxyOptions,
  sharp: Awaited<ReturnType<typeof loadSharp>>,
  level: SourcePyramidLevel,
): Promise<Buffer> {
  const pipeline = sharp(options.sourcePath, {
    limitInputPixels: options.maximumInputPixels,
    sequentialRead: true,
    failOn: 'warning',
  }).autoOrient().resize({
    width: level.width,
    height: level.height,
    fit: 'fill',
    kernel: 'lanczos3',
    fastShrinkOnLoad: true,
  }).toColourspace('srgb').ensureAlpha().raw({ depth: 'uchar' })
  const { data, info } = await runSharpOperation(
    pipeline,
    options.signal,
    () => pipeline.toBuffer({ resolveWithObject: true }),
  )
  if (info.width !== level.width
    || info.height !== level.height
    || info.channels !== 4
    || data.byteLength !== level.width * level.height * 4) {
    throw new Error('Sharp returned an incompatible proxy pyramid base level')
  }
  return data
}

async function generateSeedChain(
  options: ReadFastSourceProxyOptions,
  sharp: Awaited<ReturnType<typeof loadSharp>>,
  plan: FastProxyPyramidSeedPlan,
  seedComplete: boolean,
): Promise<Buffer> {
  const base = plan.levels[0]
  const basePixels = seedComplete
    ? await options.pyramid!.readBoundedRawLevel({
        resourceId: options.resourceId,
        level: base,
        bitDepth: 8,
        maximumBytes: MAX_FAST_PROXY_BASE_LEVEL_BYTES,
        signal: options.signal,
      })
    : await decodeRawBaseLevelFromSource(options, sharp, base)
  if (basePixels.byteLength !== plan.baseByteLength) {
    throw new Error('Sharp returned an incompatible proxy pyramid base level')
  }
  if (seedComplete) return basePixels
  let currentPixels = basePixels
  let publishedTiles = 0
  for (let index = 0; index < plan.levels.length; index += 1) {
    throwIfImageSourceAborted(options.signal)
    const level = plan.levels[index]
    publishedTiles += await options.pyramid!.seedRawLevel({
      resourceId: options.resourceId,
      level,
      bitDepth: 8,
      rowStride: level.width * 4,
      pixels: currentPixels,
      signal: options.signal,
    })
    const next = plan.levels[index + 1]
    if (next) currentPixels = await resizeRawLevel(sharp, currentPixels, level, next, options.signal)
  }
  logger.debug('快速代理同步建立粗粒度瓦片金字塔', {
    event: 'image_editor_v3.source_proxy.pyramid_seed.completed',
    context: {
      resourceId: options.resourceId,
      baseMip: base.mip,
      baseByteLength: plan.baseByteLength,
      levels: plan.levels.length,
      publishedTiles,
    },
  })
  return basePixels
}

async function encodeProxyFromRaw(
  options: ReadFastSourceProxyOptions,
  sharp: Awaited<ReturnType<typeof loadSharp>>,
  pixels: Buffer,
  level: SourcePyramidLevel,
) {
  const pipeline = sharp(pixels, {
    raw: { width: level.width, height: level.height, channels: 4 },
    failOn: 'warning',
  }).resize({
    width: options.maxDimension,
    height: options.maxDimension,
    fit: 'inside',
    withoutEnlargement: true,
  }).webp({ quality: 82, effort: 2 })
  return runSharpOperation(pipeline, options.signal, () => pipeline.toBuffer({ resolveWithObject: true }))
}

async function encodeProxyFromSource(
  options: ReadFastSourceProxyOptions,
  sharp: Awaited<ReturnType<typeof loadSharp>>,
) {
  const pipeline = sharp(options.sourcePath, {
    limitInputPixels: options.maximumInputPixels,
    sequentialRead: true,
    failOn: 'warning',
  }).autoOrient().resize({
    width: options.maxDimension,
    height: options.maxDimension,
    fit: 'inside',
    withoutEnlargement: true,
    fastShrinkOnLoad: true,
  }).toColourspace('srgb').webp({ quality: 82, effort: 2 })
  return runSharpOperation(pipeline, options.signal, () => pipeline.toBuffer({ resolveWithObject: true }))
}

export async function readFastSourceProxy(
  options: ReadFastSourceProxyOptions,
): Promise<FastSourceProxy> {
  const sharp = await options.sharpLoader()
  throwIfImageSourceAborted(options.signal)
  const address: DerivedCacheAddress = {
    kind: 'proxy',
    key: `v${SOURCE_PROXY_CACHE_VERSION}:${options.resourceId}:${options.maxDimension}:webp82-sdr`,
  }
  const cached = options.cache
    ? await readCachedProxy(sharp, options.cache, address, options.resourceId, options.signal)
    : null
  const seedPlan = options.cache && options.pyramid
    ? planFastProxyPyramidSeed(options.metadata, options.maxDimension)
    : null
  let basePixels: Buffer | null = null
  let seedComplete = false
  if (seedPlan) {
    try {
      seedComplete = await hasSeedChain(options.pyramid!, options.resourceId, seedPlan)
    } catch (error) {
      logger.warn('检查快速代理粗粒度瓦片缓存失败，将尝试重新建立', {
        event: 'image_editor_v3.source_proxy.pyramid_seed_check.failed',
        context: { resourceId: options.resourceId },
        error,
      })
    }
  }
  if (seedPlan && (!seedComplete || !cached)) {
    try {
      basePixels = await generateSeedChain(options, sharp, seedPlan, seedComplete)
    } catch (error) {
      throwIfImageSourceAborted(options.signal)
      logger.warn('快速代理建立粗粒度瓦片失败，回退为按需源解码', {
        event: 'image_editor_v3.source_proxy.pyramid_seed.failed',
        context: { resourceId: options.resourceId },
        error,
      })
    }
  }
  if (cached) return cached
  const encoded = basePixels && seedPlan
    ? await encodeProxyFromRaw(options, sharp, basePixels, seedPlan.levels[0])
    : await encodeProxyFromSource(options, sharp)
  throwIfImageSourceAborted(options.signal)
  if (options.cache && encoded.data.byteLength <= options.cache.maxEntryBytes) {
    await options.cache.put(address, encoded.data).catch(() => undefined)
  }
  return {
    resourceId: options.resourceId,
    width: encoded.info.width,
    height: encoded.info.height,
    format: 'webp',
    bytes: encoded.data,
  }
}
