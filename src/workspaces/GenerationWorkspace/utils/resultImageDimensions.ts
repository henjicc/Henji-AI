import type { GenerationTask, ResultImageDimensions } from '../types'

const DIMENSION_TEXT_PATTERN = /^\s*(\d+)\s*[x×*]\s*(\d+)\s*$/i
const RESULT_IMAGE_WIDTH_REM = 16

function toPositiveInteger(value: unknown): number | null {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^\d+$/.test(value.trim())
      ? Number(value)
      : Number.NaN
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

export function parseResultImageDimensions(value: unknown): ResultImageDimensions | null {
  if (typeof value === 'string') {
    const match = DIMENSION_TEXT_PATTERN.exec(value)
    if (!match) return null
    const width = toPositiveInteger(match[1])
    const height = toPositiveInteger(match[2])
    return width && height ? { width, height } : null
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const width = toPositiveInteger(record['width'])
  const height = toPositiveInteger(record['height'])
  return width && height ? { width, height } : null
}

export function resolveResultImageDimensions(
  task: Pick<GenerationTask, 'dimensions' | 'options'>,
  imageIndex: number
): ResultImageDimensions | null {
  const storedDimensions = task.options?.resultImageDimensions
  if (Array.isArray(storedDimensions)) {
    const parsedStoredDimensions = parseResultImageDimensions(storedDimensions[imageIndex])
    if (parsedStoredDimensions) return parsedStoredDimensions
  }

  const candidates: unknown[] = [
    task.dimensions,
    task.options?.size,
    task.options?.['resolution'],
  ]
  for (const candidate of candidates) {
    const parsedDimensions = parseResultImageDimensions(candidate)
    if (parsedDimensions) return parsedDimensions
  }
  return null
}

export function getResultImageSlotHeight(dimensions: ResultImageDimensions | null): string | null {
  if (!dimensions) return null
  const heightRem = RESULT_IMAGE_WIDTH_REM * dimensions.height / dimensions.width
  return `${Number(heightRem.toFixed(6))}rem`
}
