import { ModelDefinition, ModelType, ProgressConfig, ProgressCurveConfig } from '@/core/types'
import type { ProgressStatus } from '@/core/providers/base'

export interface ProgressSpec {
  expectedDurationMs: number
  tickMs: number
  curve: Required<ProgressCurveConfig>
}

export interface ProgressTracker {
  start: () => void
  stop: () => void
  complete: () => void
  fail: (message?: string) => void
}

const DEFAULT_CURVE: Required<ProgressCurveConfig> = {
  slowStart: 80,
  slowEnd: 95,
  cap: 99,
  tailFactor: 1.2
}

const DEFAULT_TICK_MS = 300
const DEFAULT_POLLING_ATTEMPTS = 120
const DEFAULT_POLLING_INTERVAL = 3000

const DEFAULT_DURATION_BY_TYPE: Record<ModelType, { baseMs: number; minMs: number; maxMs: number }> = {
  image: { baseMs: 60000, minMs: 15000, maxMs: 240000 },
  video: { baseMs: 120000, minMs: 30000, maxMs: 900000 },
  audio: { baseMs: 10000, minMs: 3000, maxMs: 120000 }
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))

const parseNumberLike = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string') {
    const parsed = Number(value.trim())
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  return null
}

const pickFirstFiniteNumber = (params: Record<string, unknown>, keys: string[]): number | null => {
  for (const key of keys) {
    const raw = parseNumberLike(params[key])
    if (raw !== null) {
      return raw
    }
  }
  return null
}

const resolveAudioTextLength = (params: Record<string, unknown>): number => {
  const textCandidates = [params.text, params.prompt]
  for (const candidate of textCandidates) {
    if (typeof candidate === 'string') {
      const normalized = candidate.trim()
      if (normalized.length > 0) {
        return normalized.length
      }
    }
  }
  return 0
}

const resolveGenericDurationMs = (
  modelType: ModelType,
  params: Record<string, unknown>,
  defaults: { baseMs: number; minMs: number; maxMs: number }
): number => {
  if (modelType === 'image') {
    const imageCount = Math.max(
      1,
      Math.round(
        pickFirstFiniteNumber(params, [
          'maxImages',
          'max_images',
          'numImages',
          'num_images',
          'imageCount',
          'image_count'
        ]) ?? 1
      )
    )
    const durationMs = defaults.baseMs + (imageCount - 1) * 12000
    return clamp(durationMs, defaults.minMs, defaults.maxMs)
  }

  if (modelType === 'video') {
    const videoDurationSeconds = pickFirstFiniteNumber(params, [
      'duration',
      'videoDuration',
      'video_duration',
      'ppioWan25VideoDuration',
      'seconds'
    ]) ?? 5
    const normalizedSeconds = clamp(videoDurationSeconds, 1, 30)
    const scale = clamp(normalizedSeconds / 5, 0.5, 6)
    const durationMs = Math.round(defaults.baseMs * scale)
    return clamp(durationMs, defaults.minMs, defaults.maxMs)
  }

  const textLength = resolveAudioTextLength(params)
  const extraBlocks = Math.max(0, Math.ceil((textLength - 120) / 80))
  const durationMs = defaults.baseMs + extraBlocks * 800
  return clamp(durationMs, defaults.minMs, defaults.maxMs)
}

const getUnitCount = (params: Record<string, unknown>, scaleWith?: string): number => {
  if (!scaleWith) return 1
  const raw = params[scaleWith]

  if (Array.isArray(raw)) {
    return Math.max(1, raw.length)
  }

  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return Math.max(1, raw)
  }

  if (typeof raw === 'string') {
    const parsed = Number(raw)
    if (Number.isFinite(parsed)) {
      return Math.max(1, parsed)
    }
  }

  return 1
}

const resolveCurve = (curve?: ProgressCurveConfig): Required<ProgressCurveConfig> => ({
  slowStart: curve?.slowStart ?? DEFAULT_CURVE.slowStart,
  slowEnd: curve?.slowEnd ?? DEFAULT_CURVE.slowEnd,
  cap: curve?.cap ?? DEFAULT_CURVE.cap,
  tailFactor: curve?.tailFactor ?? DEFAULT_CURVE.tailFactor
})

const resolveExpectedDurationMs = (
  model: ModelDefinition,
  params: Record<string, unknown>
): { durationMs: number; tickMs: number; curve: Required<ProgressCurveConfig> } | null => {
  const progress = model.meta.progress
  const mode: ProgressConfig['mode'] = progress?.mode ?? 'time'
  const typeDefaults = DEFAULT_DURATION_BY_TYPE[model.meta.type]

  if (mode === 'time') {
    const hasModelTimeConfig = progress?.mode === 'time'
    const minDurationMs = hasModelTimeConfig ? progress.minDurationMs ?? typeDefaults.minMs : typeDefaults.minMs
    const maxDurationMs = hasModelTimeConfig ? progress.maxDurationMs ?? typeDefaults.maxMs : typeDefaults.maxMs

    const durationMs = hasModelTimeConfig
      ? clamp(
        progress.baseDurationMs + (progress.perUnitMs ?? 0) * Math.max(0, getUnitCount(params, progress.scaleWith) - 1),
        minDurationMs,
        maxDurationMs
      )
      : resolveGenericDurationMs(model.meta.type, params, typeDefaults)

    return {
      durationMs,
      tickMs: hasModelTimeConfig ? progress.tickMs ?? DEFAULT_TICK_MS : DEFAULT_TICK_MS,
      curve: resolveCurve(hasModelTimeConfig ? progress.curve : undefined)
    }
  }

  const pollingBaseAttempts = progress?.mode === 'polling'
    ? progress.baseAttempts
    : model.meta.polling?.expectedAttempts ?? model.meta.polling?.maxAttempts ?? DEFAULT_POLLING_ATTEMPTS
  const perUnitAttempts = progress?.mode === 'polling' ? progress.perUnitAttempts ?? 0 : 0
  const unitCount = getUnitCount(params, progress?.mode === 'polling' ? progress.scaleWith : undefined)
  const rawAttempts = pollingBaseAttempts + perUnitAttempts * Math.max(0, unitCount - 1)

  const minAttempts = progress?.mode === 'polling' ? progress.minAttempts ?? 1 : 1
  const maxAttempts = progress?.mode === 'polling'
    ? progress.maxAttempts ?? model.meta.polling?.maxAttempts ?? DEFAULT_POLLING_ATTEMPTS
    : model.meta.polling?.maxAttempts ?? DEFAULT_POLLING_ATTEMPTS
  const attempts = clamp(rawAttempts, minAttempts, maxAttempts)

  const intervalMs = progress?.mode === 'polling'
    ? progress.intervalMs ?? model.meta.polling?.interval ?? DEFAULT_POLLING_INTERVAL
    : model.meta.polling?.interval ?? DEFAULT_POLLING_INTERVAL

  const rawDurationMs = attempts * intervalMs
  const minDurationMs = progress?.mode === 'polling' ? progress.minDurationMs ?? typeDefaults.minMs : typeDefaults.minMs
  const maxDurationMs = progress?.mode === 'polling' ? progress.maxDurationMs ?? typeDefaults.maxMs : typeDefaults.maxMs
  const durationMs = clamp(rawDurationMs, minDurationMs, maxDurationMs)

  return {
    durationMs,
    tickMs: progress?.mode === 'polling' ? progress.tickMs ?? DEFAULT_TICK_MS : DEFAULT_TICK_MS,
    curve: resolveCurve(progress?.mode === 'polling' ? progress.curve : undefined)
  }
}

const computeProgress = (elapsedMs: number, spec: ProgressSpec): number => {
  if (spec.expectedDurationMs <= 0) return 0

  const t = elapsedMs / spec.expectedDurationMs
  const startT = spec.curve.slowStart / 100
  const slowEnd = spec.curve.slowEnd
  const cap = spec.curve.cap

  if (t <= 0) return 0

  if (t <= startT) {
    const u = t / startT
    const ease = 1 - (1 - u) * (1 - u)
    return spec.curve.slowStart * ease
  }

  if (t <= 1) {
    const u = (t - startT) / (1 - startT)
    const ease = 1 - Math.pow(1 - u, 3)
    return spec.curve.slowStart + (slowEnd - spec.curve.slowStart) * ease
  }

  const extra = t - 1
  const tail = (cap - slowEnd) * (1 - Math.exp(-extra / spec.curve.tailFactor))
  return slowEnd + tail
}

export const resolveProgressSpec = (
  model: ModelDefinition,
  params: Record<string, unknown>
): ProgressSpec | null => {
  const resolved = resolveExpectedDurationMs(model, params)
  if (!resolved) return null

  return {
    expectedDurationMs: resolved.durationMs,
    tickMs: resolved.tickMs,
    curve: resolved.curve
  }
}

export const createProgressTracker = (
  spec: ProgressSpec,
  onProgress: (status: ProgressStatus) => void
): ProgressTracker => {
  let timer: ReturnType<typeof setInterval> | null = null
  let startAt = 0
  let lastProgress = 0

  const emit = (progress: number, status: ProgressStatus['status'], message?: string): void => {
    onProgress({
      status,
      progress,
      message
    })
  }

  const tick = (): void => {
    const elapsedMs = Date.now() - startAt
    const raw = computeProgress(elapsedMs, spec)
    let next = Math.min(spec.curve.cap, Math.max(raw, lastProgress))

    if (next <= lastProgress && lastProgress < spec.curve.cap) {
      next = Math.min(spec.curve.cap, lastProgress + 0.01)
    }

    next = Number(next.toFixed(3))

    if (next > lastProgress + 0.0005) {
      lastProgress = next
      emit(next, 'IN_PROGRESS')
    }
  }

  const stopTimer = (): void => {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  return {
    start: (): void => {
      startAt = Date.now()
      emit(0, 'IN_PROGRESS')
      tick()
      timer = setInterval(tick, spec.tickMs)
    },
    stop: (): void => {
      stopTimer()
    },
    complete: (): void => {
      stopTimer()
      emit(100, 'COMPLETED')
    },
    fail: (message?: string): void => {
      stopTimer()
      emit(lastProgress, 'FAILED', message)
    }
  }
}
