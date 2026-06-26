import type {
  JsonObject,
  JsonValue,
  RuntimeConstraintsDsl,
  RuntimeImageSizeFieldConstraintDsl,
} from './types'

export function normalizeRequestBody(body: JsonValue, constraints?: RuntimeConstraintsDsl): JsonValue {
  if (!constraints || !isJsonObject(body)) {
    return body
  }

  const next: JsonObject = { ...body }
  for (const constraint of constraints.numberFields ?? []) {
    const current = next[constraint.field]
    const parsed = parseNumber(current)
    if (parsed === undefined) {
      continue
    }
    let numeric = parsed
    if (constraint.min !== undefined && numeric < constraint.min) numeric = constraint.min
    if (constraint.max !== undefined && numeric > constraint.max) numeric = constraint.max
    if (constraint.integer === true) numeric = Math.round(numeric)
    next[constraint.field] = Number.isFinite(numeric) ? numeric : constraint.fallback ?? current
  }

  for (const constraint of constraints.enumFields ?? []) {
    const current = next[constraint.field]
    if ((constraint.allowed ?? []).some((allowed) => jsonEquals(allowed, current))) {
      continue
    }
    if (constraint.fallback !== undefined) {
      next[constraint.field] = constraint.fallback
    }
  }

  for (const constraint of constraints.imageSizeFields ?? []) {
    const current = next[constraint.field]
    const normalized = constraint.format === 'object'
      ? normalizeImageSizeObject(current, constraint)
      : normalizeImageSizeString(current, constraint)
    if (normalized !== undefined) {
      next[constraint.field] = normalized
    }
  }

  return next
}

function normalizeImageSizeString(
  current: JsonValue | undefined,
  constraint: RuntimeImageSizeFieldConstraintDsl
): JsonValue | undefined {
  if (typeof current !== 'string') {
    return undefined
  }
  const parsed = parseSizeText(current)
  if (!parsed) {
    return undefined
  }
  const [width, height] = normalizeDimensions(parsed[0], parsed[1], constraint)
  return `${Math.trunc(width)}x${Math.trunc(height)}`
}

function normalizeImageSizeObject(
  current: JsonValue | undefined,
  constraint: RuntimeImageSizeFieldConstraintDsl
): JsonValue | undefined {
  if (!isJsonObject(current)) {
    return undefined
  }
  const widthKey = constraint.widthKey ?? 'width'
  const heightKey = constraint.heightKey ?? 'height'
  const width = parseNumber(current[widthKey])
  const height = parseNumber(current[heightKey])
  if (width === undefined || height === undefined) {
    return undefined
  }
  const [nextWidth, nextHeight] = normalizeDimensions(width, height, constraint)
  return { ...current, [widthKey]: nextWidth, [heightKey]: nextHeight }
}

function normalizeDimensions(
  width: number,
  height: number,
  constraint: RuntimeImageSizeFieldConstraintDsl
): [number, number] {
  const minSide = Math.max(1, constraint.minSide ?? 1)
  const maxSide = constraint.maxSide ?? Number.MAX_SAFE_INTEGER
  let nextWidth = normalizeSide(width, minSide, maxSide)
  let nextHeight = normalizeSide(height, minSide, maxSide)

  if (constraint.minAspectRatio !== undefined && constraint.maxAspectRatio !== undefined) {
    const ratio = nextWidth / Math.max(1, nextHeight)
    if (ratio < constraint.minAspectRatio && constraint.minAspectRatio > 0) {
      nextHeight = Math.max(1, Math.floor(nextWidth / constraint.minAspectRatio))
    } else if (ratio > constraint.maxAspectRatio && constraint.maxAspectRatio > 0) {
      nextWidth = Math.max(1, Math.floor(nextHeight * constraint.maxAspectRatio))
    }
  }

  nextWidth = normalizeSide(nextWidth, minSide, maxSide)
  nextHeight = normalizeSide(nextHeight, minSide, maxSide)
  let pixels = nextWidth * nextHeight

  if (pixels > constraint.maxPixels) {
    const scaled = scaleDimensions(nextWidth, nextHeight, Math.sqrt(constraint.maxPixels / pixels))
    nextWidth = normalizeSide(scaled[0], minSide, maxSide)
    nextHeight = normalizeSide(scaled[1], minSide, maxSide)
    pixels = nextWidth * nextHeight
  }

  if (constraint.minPixels !== undefined && constraint.minPixels > 0 && pixels < constraint.minPixels) {
    const scaled = scaleDimensions(nextWidth, nextHeight, Math.sqrt(constraint.minPixels / Math.max(1, pixels)))
    nextWidth = normalizeSide(scaled[0], minSide, maxSide)
    nextHeight = normalizeSide(scaled[1], minSide, maxSide)
  }

  return enforceMaxPixels(nextWidth, nextHeight, minSide, constraint.maxPixels)
}

function normalizeSide(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)))
}

function scaleDimensions(width: number, height: number, scale: number): [number, number] {
  return [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))]
}

function enforceMaxPixels(width: number, height: number, minSide: number, maxPixels: number): [number, number] {
  let nextWidth = Math.max(1, Math.round(width))
  let nextHeight = Math.max(1, Math.round(height))
  while (nextWidth * nextHeight > maxPixels) {
    if (nextWidth >= nextHeight && nextWidth > minSide) nextWidth -= 1
    else if (nextHeight > minSide) nextHeight -= 1
    else break
  }
  return [nextWidth, nextHeight]
}

function parseSizeText(value: string): [number, number] | undefined {
  const pair = value.trim().replace('*', 'x').split('x')
  if (pair.length !== 2) {
    return undefined
  }
  const width = Number(pair[0].trim())
  const height = Number(pair[1].trim())
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? [width, height]
    : undefined
}

function parseNumber(value: JsonValue | undefined): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined
  }
  if (typeof value === 'string') {
    const parsed = Number(value.trim())
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function jsonEquals(left: JsonValue, right: JsonValue | undefined): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
