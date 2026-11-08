import type { GenerationTask, ResultImageDimensions } from '../types'

const DIMENSION_TEXT_PATTERN = /^\s*(\d+)\s*[x×*]\s*(\d+)\s*$/i

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

const RATIO_TEXT = /^\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)\s*$/

/**
 * 结果格与生成中占位共用的画面比例，出图前后不跳：已知尺寸优先，
 * 其次是参数里的画面比例（各模型字段名不同，按“数:数”的取值识别），都没有时按常见成品比例。
 */
export function resolveResultAspectRatio(task: Pick<GenerationTask, 'dimensions' | 'options' | 'type'>, imageIndex: number): string {
  const dimensions = resolveResultImageDimensions(task, imageIndex)
  if (dimensions) return `${dimensions.width} / ${dimensions.height}`
  for (const value of Object.values(task.options ?? {})) {
    const match = typeof value === 'string' ? RATIO_TEXT.exec(value) : null
    if (match && Number(match[1]) > 0 && Number(match[2]) > 0) return `${match[1]} / ${match[2]}`
  }
  return task.type === 'video' ? '16 / 9' : '1 / 1'
}
