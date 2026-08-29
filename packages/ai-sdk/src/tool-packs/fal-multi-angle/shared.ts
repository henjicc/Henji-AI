import type { JsonObject, JsonValue } from '../../types/runtime'

const MULTI_ANGLE_IMAGE_KEYS = [
  'uploadedFilePaths',
  'images',
  'uploadedImages',
  'image',
] as const

export function requireSingleMultiAngleImage(params: JsonObject, label: string): string {
  const images = MULTI_ANGLE_IMAGE_KEYS
    .map((key) => cleanMedia(params[key]))
    .find((items) => items.length > 0) ?? []

  if (images.length !== 1) {
    throw new Error(`${label}必须且只能提供 1 张源图`)
  }

  return images[0]
}

function cleanMedia(value: JsonValue): string[] {
  return Array.isArray(value)
    ? value
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .map((item) => item.trim())
    : []
}
