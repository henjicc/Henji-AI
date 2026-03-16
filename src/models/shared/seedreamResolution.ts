import { findClosestRatio } from '@/core/linkage/smartMatch'

export interface SeedreamResolutionValue {
  mode?: string
  aspectRatio?: string
  quality?: '2K' | '4K'
  width?: number
  height?: number
}

export interface SeedreamSizeConstraints {
  minSide: number
  maxSide: number
  maxPixels: number
  minPixels?: number
}

export const SEEDREAM_RATIO_OPTIONS = ['21:9', '16:9', '3:2', '4:3', '1:1', '3:4', '2:3', '9:16']

function parseRatio(value: string): number | null {
  const match = value.trim().match(/^(\d+)\s*:\s*(\d+)$/)
  if (!match) {
    return null
  }

  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || height <= 0) {
    return null
  }

  return width / height
}

function clampToRange(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function normalizeSide(value: number, minSide: number, maxSide: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return minSide
  }
  return clampToRange(Math.round(value), minSide, maxSide)
}

function resizeByScale(width: number, height: number, scale: number): { width: number; height: number } {
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

export async function getImageSize(source: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      resolve({ width: image.naturalWidth, height: image.naturalHeight })
    }
    image.onerror = () => {
      reject(new Error('Failed to load image'))
    }
    image.src = source
  })
}

export function resolveSeedreamRatio(
  aspectRatio: string | undefined,
  targetImageRatio: number | null
): string {
  if (aspectRatio && aspectRatio !== 'smart') {
    return aspectRatio
  }

  if (targetImageRatio && Number.isFinite(targetImageRatio) && targetImageRatio > 0) {
    return findClosestRatio(targetImageRatio, SEEDREAM_RATIO_OPTIONS)
  }

  return '1:1'
}

export function calculateSeedreamSizeFromRatio(
  ratioText: string,
  quality: '2K' | '4K',
  constraints: SeedreamSizeConstraints
): { width: number; height: number } {
  const ratio = parseRatio(ratioText) ?? 1
  const targetPixels = quality === '4K' ? 16777216 : 4194304

  const targetHeight = Math.sqrt(targetPixels / ratio)
  const targetWidth = targetHeight * ratio

  let width = normalizeSide(targetWidth, constraints.minSide, constraints.maxSide)
  let height = normalizeSide(targetHeight, constraints.minSide, constraints.maxSide)

  let pixels = width * height

  if (pixels > constraints.maxPixels) {
    const downScale = Math.sqrt(constraints.maxPixels / pixels)
    const resized = resizeByScale(width, height, downScale)
    width = normalizeSide(resized.width, constraints.minSide, constraints.maxSide)
    height = normalizeSide(resized.height, constraints.minSide, constraints.maxSide)
    pixels = width * height
  }

  if (constraints.minPixels && pixels < constraints.minPixels) {
    const upScale = Math.sqrt(constraints.minPixels / Math.max(1, pixels))
    const resized = resizeByScale(width, height, upScale)
    width = normalizeSide(resized.width, constraints.minSide, constraints.maxSide)
    height = normalizeSide(resized.height, constraints.minSide, constraints.maxSide)
    pixels = width * height
  }

  if (pixels > constraints.maxPixels) {
    const fallbackScale = Math.sqrt(constraints.maxPixels / pixels)
    const resized = resizeByScale(width, height, fallbackScale)
    width = normalizeSide(resized.width, constraints.minSide, constraints.maxSide)
    height = normalizeSide(resized.height, constraints.minSide, constraints.maxSide)
  }

  return { width, height }
}

export function normalizeSeedreamCustomSize(
  width: number | undefined,
  height: number | undefined,
  constraints: SeedreamSizeConstraints
): { width: number; height: number } {
  const normalizedWidth = normalizeSide(width ?? constraints.minSide, constraints.minSide, constraints.maxSide)
  const normalizedHeight = normalizeSide(height ?? constraints.minSide, constraints.minSide, constraints.maxSide)
  const pixels = normalizedWidth * normalizedHeight

  if (pixels <= constraints.maxPixels) {
    return { width: normalizedWidth, height: normalizedHeight }
  }

  const scale = Math.sqrt(constraints.maxPixels / pixels)
  const resized = resizeByScale(normalizedWidth, normalizedHeight, scale)
  return {
    width: normalizeSide(resized.width, constraints.minSide, constraints.maxSide),
    height: normalizeSide(resized.height, constraints.minSide, constraints.maxSide),
  }
}
