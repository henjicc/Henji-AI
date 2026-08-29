import type { RuntimePricingMediaContextRequirement } from '../types/model'
import type { JsonObject, JsonValue } from '../types/runtime'

export interface PricingImageMetadata {
  width: number
  height: number
  fileSizeBytes: number
}

export interface PricingVideoMetadata {
  width: number
  height: number
  durationSeconds: number
}

export interface PricingMediaMetadataReaders {
  image: (source: string) => Promise<PricingImageMetadata>
  video: (source: string) => Promise<PricingVideoMetadata>
}

export interface ResolvedPricingMediaContext {
  params: JsonObject
  complete: boolean
  missingTargets: string[]
}

const MEDIA_SOURCE_KEYS = {
  image: ['uploadedFilePaths', 'images', 'uploadedImages'],
  video: ['uploadedVideoFilePaths', 'videos', 'uploadedVideos'],
} as const

function cachedRead<T>(
  cache: Map<string, Promise<T>>,
  source: string,
  reader: (value: string) => Promise<T>,
): Promise<T> {
  const cached = cache.get(source)
  if (cached) return cached
  const pending = reader(source).catch((error) => {
    cache.delete(source)
    throw error
  })
  cache.set(source, pending)
  return pending
}

function cleanSources(value: JsonValue | undefined): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => (
    typeof item === 'string' && item.trim().length > 0
  ))
}

export function resolvePricingMediaSources(
  mediaType: 'image' | 'video',
  params: JsonObject,
): string[] {
  for (const key of MEDIA_SOURCE_KEYS[mediaType]) {
    const sources = cleanSources(params[key])
    if (sources.length > 0) return sources
  }
  return []
}

function readMetric(
  requirement: RuntimePricingMediaContextRequirement,
  metadata: PricingImageMetadata | PricingVideoMetadata,
): number | null {
  if (requirement.metric === 'megapixels') {
    return metadata.width > 0 && metadata.height > 0
      ? metadata.width * metadata.height / 1_000_000
      : null
  }
  const value = metadata[requirement.metric as keyof typeof metadata]
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function applyMultiplier(
  value: number,
  requirement: RuntimePricingMediaContextRequirement,
  params: JsonObject,
): number | null {
  const multiplier = requirement.multiplier
  if (!multiplier) return value
  const rawFactor = multiplier.kind === 'fixed'
    ? multiplier.value
    : Number(params[multiplier.paramId] ?? multiplier.fallback)
  const factor = Number.isFinite(rawFactor) && rawFactor > 0
    ? rawFactor
    : multiplier.kind === 'parameter' ? multiplier.fallback : Number.NaN
  if (!Number.isFinite(factor) || factor <= 0) return null
  return value * factor ** (multiplier.exponent ?? 1)
}

async function resolveRequirement(
  requirement: RuntimePricingMediaContextRequirement,
  params: JsonObject,
  readers: PricingMediaMetadataReaders,
): Promise<number | null> {
  const existing = Number(params[requirement.targetParam])
  if (Number.isFinite(existing) && existing > 0) return existing

  const sources = resolvePricingMediaSources(requirement.mediaType, params)
  const selected = requirement.aggregation === 'sum' ? sources : sources.slice(0, 1)
  if (selected.length === 0) return null

  const values = await Promise.all(selected.map(async (source) => {
    try {
      const metadata = requirement.mediaType === 'image'
        ? await readers.image(source)
        : await readers.video(source)
      return readMetric(requirement, metadata)
    } catch {
      return null
    }
  }))
  if (values.some((value) => value === null)) return null
  const numericValues = values as number[]
  const aggregated = requirement.aggregation === 'sum'
    ? numericValues.reduce((total, metric) => total + metric, 0)
    : numericValues[0]
  return applyMultiplier(aggregated, requirement, params)
}

/**
 * 用宿主提供的媒体探针补齐 calculator 所需指标。函数不依赖 DOM、Node 或 Electron，
 * Web、桌面和插件宿主可以共用同一套来源优先级、聚合与倍率换算。
 */
export async function resolvePricingMediaContext(
  requirements: RuntimePricingMediaContextRequirement[] | undefined,
  params: JsonObject,
  readers: PricingMediaMetadataReaders,
): Promise<ResolvedPricingMediaContext> {
  if (!requirements || requirements.length === 0) {
    return { params, complete: true, missingTargets: [] }
  }

  const imageReads = new Map<string, Promise<PricingImageMetadata>>()
  const videoReads = new Map<string, Promise<PricingVideoMetadata>>()
  const memoizedReaders: PricingMediaMetadataReaders = {
    image: (source) => cachedRead(imageReads, source, readers.image),
    video: (source) => cachedRead(videoReads, source, readers.video),
  }
  const resolvedValues = await Promise.all(
    requirements.map((requirement) => resolveRequirement(requirement, params, memoizedReaders)),
  )
  const next = { ...params }
  const missingTargets: string[] = []
  requirements.forEach((requirement, index) => {
    const value = resolvedValues[index]
    if (value === null || !Number.isFinite(value) || value <= 0) {
      delete next[requirement.targetParam]
      missingTargets.push(requirement.targetParam)
      return
    }
    next[requirement.targetParam] = value
  })

  return {
    params: next,
    complete: missingTargets.length === 0,
    missingTargets,
  }
}
