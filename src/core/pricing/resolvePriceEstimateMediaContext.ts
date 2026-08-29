import {
  resolvePricingMediaContext,
  type JsonObject,
  type PricingImageMetadata,
  type PricingMediaMetadataReaders,
  type PricingVideoMetadata,
  type RuntimePricingMediaContextRequirement,
} from '@henjicc/ai-sdk'

import { readImageInfo } from '@/commands/image'
import { readVideoInfo } from '@/commands/video'

export interface ResolvedPriceEstimateMediaContext {
  params: DynamicValueMap
  complete: boolean
  missingTargets: string[]
}

const imageMetadataCache = new Map<string, Promise<PricingImageMetadata>>()
const videoMetadataCache = new Map<string, Promise<PricingVideoMetadata>>()
const MEDIA_METADATA_CACHE_LIMIT = 128

function cachedRead<T>(
  cache: Map<string, Promise<T>>,
  source: string,
  reader: (value: string) => Promise<T>,
): Promise<T> {
  const cached = cache.get(source)
  if (cached) {
    cache.delete(source)
    cache.set(source, cached)
    return cached
  }
  const pending = reader(source).catch((error) => {
    cache.delete(source)
    throw error
  })
  cache.set(source, pending)
  while (cache.size > MEDIA_METADATA_CACHE_LIMIT) {
    const oldestSource = cache.keys().next().value
    if (oldestSource === undefined) break
    cache.delete(oldestSource)
  }
  return pending
}

const DEFAULT_READERS: PricingMediaMetadataReaders = {
  image: (source) => cachedRead(imageMetadataCache, source, readImageInfo),
  video: (source) => cachedRead(videoMetadataCache, source, readVideoInfo),
}

/**
 * 根据 SDK 的 pricing.mediaContext 声明补齐价格计算参数。
 * 文件读取属于宿主能力；SDK 仅携带可移植的需求描述与 calculator。
 */
export async function resolvePriceEstimateMediaContext(
  requirements: RuntimePricingMediaContextRequirement[] | undefined,
  params: DynamicValueMap,
  readers: PricingMediaMetadataReaders = DEFAULT_READERS,
): Promise<ResolvedPriceEstimateMediaContext> {
  const resolved = await resolvePricingMediaContext(requirements, params as JsonObject, readers)
  return { ...resolved, params: resolved.params as DynamicValueMap }
}

export type {
  PricingImageMetadata,
  PricingMediaMetadataReaders,
  PricingVideoMetadata,
}
