import type { JsonObject, JsonValue } from '../../types/runtime'

export function requireSingleUpscaleImage(params: JsonObject, label: string): string {
  const uploaded = cleanImages(params.uploadedFilePaths)
  const images = uploaded.length > 0 ? uploaded : cleanImages(params.images)
  if (images.length !== 1) {
    throw new Error(`${label}必须且只能提供 1 张源图`)
  }
  return images[0]
}

export function readUpscaleOutputMegapixels(params: JsonObject): number | null {
  const megapixels = Number(params.__upscaleOutputMegapixels)
  return Number.isFinite(megapixels) && megapixels > 0 ? megapixels : null
}

export function pricePerStartedMegapixels(
  params: JsonObject,
  megapixelsPerTier: number,
  pricePerTier: number,
): number {
  const megapixels = readUpscaleOutputMegapixels(params)
  if (megapixels === null) return Number.NaN
  return Math.ceil(megapixels / megapixelsPerTier) * pricePerTier
}

function cleanImages(value: JsonValue): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
}
