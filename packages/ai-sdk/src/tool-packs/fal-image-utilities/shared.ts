import type { JsonObject, JsonValue } from '../../types/runtime'

export const FAL_IMAGE_APP_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4'] as const
export const FAL_IMAGE_APP_RATIO_OPTIONS = ['smart', ...FAL_IMAGE_APP_RATIOS] as const

export type FalImageAppRatio = (typeof FAL_IMAGE_APP_RATIOS)[number]

export function requireSingleUtilityImage(params: JsonObject, label: string): string {
  const images = [
    params.uploadedFilePaths,
    params.images,
    params.uploadedImages,
    params.image,
  ]
    .map(cleanMedia)
    .find((items) => items.length > 0) ?? []
  if (images.length !== 1) {
    throw new Error(`${label}必须且只能提供 1 张源图`)
  }
  return images[0]
}

export function resolveImageAppRatio(
  params: JsonObject,
  field = 'aspectRatio',
): FalImageAppRatio {
  const requested = typeof params[field] === 'string' ? params[field] : 'smart'
  if (FAL_IMAGE_APP_RATIOS.includes(requested as FalImageAppRatio)) {
    return requested as FalImageAppRatio
  }

  const ratioHint = finiteNumber(params.__firstImageRatio, 1)
  const sourceRatio = ratioHint > 0 ? ratioHint : 1
  return FAL_IMAGE_APP_RATIOS.reduce((best, candidate) => {
    return ratioDistance(candidate, sourceRatio) < ratioDistance(best, sourceRatio)
      ? candidate
      : best
  }, '1:1')
}

export function clampNumber(
  value: JsonValue,
  min: number,
  max: number,
  fallback: number,
): number {
  const numeric = finiteNumber(value, fallback)
  return Math.min(max, Math.max(min, numeric))
}

export function clampInteger(
  value: JsonValue,
  min: number,
  max: number,
  fallback: number,
): number {
  return Math.round(clampNumber(value, min, max, fallback))
}

export function booleanValue(value: JsonValue, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function cleanMedia(value: JsonValue): string[] {
  return Array.isArray(value)
    ? value
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .map((item) => item.trim())
    : []
}

function finiteNumber(value: JsonValue, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function ratioDistance(candidate: FalImageAppRatio, target: number): number {
  const [width, height] = candidate.split(':').map(Number)
  return Math.abs(width / height - target)
}
