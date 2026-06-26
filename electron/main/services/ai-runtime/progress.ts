import { getDb } from '../db'
import { getManifestStore } from './manifest'
import type {
  AiProgressEstimateDto,
  AiRecordProgressSampleResponseDto,
  JsonObject,
  ModelManifestItem,
} from './types'

const DEFAULT_PROFILE_KEY = '__default__'
const GLOBAL_SAMPLE_WINDOW = 30
const BUCKET_SAMPLE_WINDOW = 20
const QUERY_SAMPLE_WINDOW = 180
const BUCKET_MIN_SAMPLE_COUNT = 6
const GLOBAL_MIN_SAMPLE_COUNT_FOR_BUCKETS = 12
const DEFAULT_DURATION_MS = 60_000

type TimeBucket = 'night' | 'day' | 'evening'

interface ProgressSampleRow {
  duration_ms: number
  time_bucket: TimeBucket
}

export function getProgressEstimate(modelId: string, params: JsonObject = {}): AiProgressEstimateDto {
  const model = getManifestStore().get(modelId)
  if (!model) {
    throw new Error(`Model not found in manifest: ${modelId}`)
  }
  return buildEstimate(modelId, model, params, loadSamples(modelId, DEFAULT_PROFILE_KEY), currentTimeBucket())
}

export function recordProgressSample(
  modelId: string,
  params: JsonObject = {},
  startedAtMs: number,
  finishedAtMs: number,
  source: 'generation' | 'canvas'
): AiRecordProgressSampleResponseDto {
  const durationMs = Math.max(0, Math.round(finishedAtMs - startedAtMs))
  if (durationMs <= 0) {
    return { actualDurationMs: 0, estimate: getProgressEstimate(modelId, params) }
  }

  const model = getManifestStore().get(modelId)
  if (model) {
    getDb().prepare(`
      INSERT INTO progress_samples (
        model_id, provider_id, media_type, profile_key, time_bucket,
        duration_ms, started_at_ms, finished_at_ms, source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      modelId,
      model.providerId,
      model.modelType ?? 'unknown',
      DEFAULT_PROFILE_KEY,
      timeBucketFromTimestampMs(finishedAtMs),
      durationMs,
      Math.round(startedAtMs),
      Math.round(finishedAtMs),
      source
    )
  }

  return {
    actualDurationMs: durationMs,
    estimate: getProgressEstimate(modelId, params),
  }
}

function buildEstimate(
  modelId: string,
  model: ModelManifestItem,
  params: JsonObject,
  samples: ProgressSampleRow[],
  timeBucket: TimeBucket
): AiProgressEstimateDto {
  const globalDurations = samples.map((sample) => sample.duration_ms).slice(0, GLOBAL_SAMPLE_WINDOW)
  const bucketDurations = samples
    .filter((sample) => sample.time_bucket === timeBucket)
    .map((sample) => sample.duration_ms)
    .slice(0, BUCKET_SAMPLE_WINDOW)
  const defaultDurationMs = estimateFromMeta(model, params)
  const globalEstimateMs = trimmedMean(globalDurations) ?? defaultDurationMs
  const bucketEstimateMs = trimmedMean(bucketDurations)

  const useBucket = bucketEstimateMs !== undefined &&
    bucketDurations.length >= BUCKET_MIN_SAMPLE_COUNT &&
    globalDurations.length >= GLOBAL_MIN_SAMPLE_COUNT_FOR_BUCKETS

  return {
    durationMs: useBucket ? bucketEstimateMs : globalEstimateMs,
    source: useBucket ? 'time-bucket' : (globalDurations.length > 0 ? 'global' : sourceFromMeta(model)),
    profileKey: DEFAULT_PROFILE_KEY,
    timeBucket,
    globalSampleCount: globalDurations.length,
    bucketSampleCount: bucketDurations.length,
    defaultDurationMs,
    globalEstimateMs,
    bucketEstimateMs,
    recentGlobalDurationsMs: globalDurations,
    recentBucketDurationsMs: bucketDurations,
  }
}

function loadSamples(modelId: string, profileKey: string): ProgressSampleRow[] {
  return getDb().prepare(`
    SELECT duration_ms, time_bucket
    FROM progress_samples
    WHERE model_id = ? AND profile_key = ?
    ORDER BY finished_at_ms DESC
    LIMIT ?
  `).all(modelId, profileKey, QUERY_SAMPLE_WINDOW) as ProgressSampleRow[]
}

function trimmedMean(values: number[]): number | undefined {
  if (values.length === 0) {
    return undefined
  }
  const sorted = [...values].sort((left, right) => left - right)
  const trim = sorted.length >= 8 ? Math.floor(sorted.length * 0.1) : 0
  const sliced = sorted.slice(trim, sorted.length - trim)
  return Math.round(sliced.reduce((sum, value) => sum + value, 0) / sliced.length)
}

function estimateFromMeta(model: ModelManifestItem, params: JsonObject): number {
  const progress = model.progress
  if (!progress) {
    return DEFAULT_DURATION_MS
  }

  let duration = progress.baseDurationMs ?? DEFAULT_DURATION_MS
  if (progress.perUnitMs !== undefined && progress.scaleWith) {
    const scale = Number(params[progress.scaleWith])
    if (Number.isFinite(scale)) {
      duration += progress.perUnitMs * scale
    }
  }
  if (progress.minDurationMs !== undefined) duration = Math.max(progress.minDurationMs, duration)
  if (progress.maxDurationMs !== undefined) duration = Math.min(progress.maxDurationMs, duration)
  return Math.max(1, Math.round(duration))
}

function sourceFromMeta(model: ModelManifestItem): 'meta' | 'default' {
  return model.progress ? 'meta' : 'default'
}

function currentTimeBucket(): TimeBucket {
  return timeBucketFromHour(new Date().getHours())
}

function timeBucketFromTimestampMs(timestampMs: number): TimeBucket {
  return timeBucketFromHour(new Date(timestampMs).getHours())
}

function timeBucketFromHour(hour: number): TimeBucket {
  if (hour >= 0 && hour <= 7) return 'night'
  if (hour >= 8 && hour <= 15) return 'day'
  return 'evening'
}
