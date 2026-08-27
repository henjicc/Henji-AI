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
  minAspectRatio?: number
  maxAspectRatio?: number
  targetPixelsByQuality?: Partial<Record<'2K' | '4K', number>>
}

export const SEEDREAM_RATIO_OPTIONS = ['21:9', '16:9', '3:2', '4:3', '1:1', '3:4', '2:3', '9:16']

/**
 * 查找最接近的比例。原实现在 `@/core/linkage/smartMatch`（应用侧联动算法模块），
 * 这里内联一份纯函数副本——SDK 目录不允许反向依赖 `@/core`，且这段逻辑本身与
 * "画布联动"无关，只是 seedream 尺寸换算的内部工具。
 */
function findClosestRatio(targetRatio: number, ratios: string[]): string {
  if (ratios.length === 0) {
    throw new Error('Ratios array cannot be empty')
  }

  let closestRatio = ratios[0]
  let minDiff = Infinity

  for (const ratio of ratios) {
    const [w, h] = ratio.split(':').map(Number)

    if (isNaN(w) || isNaN(h) || h === 0) {
      continue
    }

    const r = w / h
    const diff = Math.abs(r - targetRatio)

    if (diff < minDiff) {
      minDiff = diff
      closestRatio = ratio
    }
  }

  return closestRatio
}

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

function resolveTargetPixels(
  quality: '2K' | '4K',
  constraints: SeedreamSizeConstraints
): number {
  const constrainedTarget = constraints.targetPixelsByQuality?.[quality]
  if (typeof constrainedTarget === 'number' && Number.isFinite(constrainedTarget) && constrainedTarget > 0) {
    return constrainedTarget
  }
  return quality === '4K' ? 16777216 : 4194304
}

function clampDimensionsToAspectRange(
  width: number,
  height: number,
  constraints: SeedreamSizeConstraints
): { width: number; height: number } {
  const minAspectRatio = constraints.minAspectRatio
  const maxAspectRatio = constraints.maxAspectRatio
  if (
    !minAspectRatio ||
    !maxAspectRatio ||
    !Number.isFinite(minAspectRatio) ||
    !Number.isFinite(maxAspectRatio) ||
    minAspectRatio <= 0 ||
    maxAspectRatio <= 0
  ) {
    return { width, height }
  }

  if (height <= 0 || width <= 0) {
    return { width, height }
  }

  const ratio = width / height
  if (ratio < minAspectRatio) {
    return {
      width,
      height: Math.max(1, Math.floor(width / minAspectRatio)),
    }
  }

  if (ratio > maxAspectRatio) {
    return {
      width: Math.max(1, Math.floor(height * maxAspectRatio)),
      height,
    }
  }

  return { width, height }
}

function enforceMaxPixels(
  width: number,
  height: number,
  constraints: SeedreamSizeConstraints
): { width: number; height: number } {
  let nextWidth = width
  let nextHeight = height

  while (nextWidth * nextHeight > constraints.maxPixels) {
    if (nextWidth >= nextHeight && nextWidth > constraints.minSide) {
      nextWidth -= 1
      continue
    }

    if (nextHeight > constraints.minSide) {
      nextHeight -= 1
      continue
    }

    if (nextWidth > 1) {
      nextWidth -= 1
      continue
    }

    if (nextHeight > 1) {
      nextHeight -= 1
      continue
    }

    break
  }

  return {
    width: nextWidth,
    height: nextHeight,
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
  const targetPixels = resolveTargetPixels(quality, constraints)

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

  return enforceMaxPixels(width, height, constraints)
}

export function normalizeSeedreamCustomSize(
  width: number | undefined,
  height: number | undefined,
  constraints: SeedreamSizeConstraints
): { width: number; height: number } {
  const aspectClamped = clampDimensionsToAspectRange(
    normalizeSide(width ?? constraints.minSide, constraints.minSide, constraints.maxSide),
    normalizeSide(height ?? constraints.minSide, constraints.minSide, constraints.maxSide),
    constraints
  )
  const normalizedWidth = normalizeSide(aspectClamped.width, constraints.minSide, constraints.maxSide)
  const normalizedHeight = normalizeSide(aspectClamped.height, constraints.minSide, constraints.maxSide)
  const pixels = normalizedWidth * normalizedHeight

  if (pixels <= constraints.maxPixels) {
    return { width: normalizedWidth, height: normalizedHeight }
  }

  const scale = Math.sqrt(constraints.maxPixels / pixels)
  const resized = resizeByScale(normalizedWidth, normalizedHeight, scale)
  const nextSize = {
    width: normalizeSide(resized.width, constraints.minSide, constraints.maxSide),
    height: normalizeSide(resized.height, constraints.minSide, constraints.maxSide),
  }
  return enforceMaxPixels(nextSize.width, nextSize.height, constraints)
}

export function parseSeedreamSize(value: string | undefined): { width: number; height: number } | null {
  if (typeof value !== 'string') {
    return null
  }

  const match = value.trim().match(/^(\d+)\s*[xX*]\s*(\d+)$/)
  if (!match) {
    return null
  }

  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null
  }

  return { width, height }
}

export function normalizeSeedreamSizeString(
  value: string | undefined,
  constraints: SeedreamSizeConstraints
): string | null {
  const parsed = parseSeedreamSize(value)
  if (!parsed) {
    return null
  }

  const normalized = normalizeSeedreamCustomSize(parsed.width, parsed.height, constraints)
  return `${normalized.width}x${normalized.height}`
}
