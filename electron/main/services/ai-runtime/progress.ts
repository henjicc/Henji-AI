import fs from 'node:fs'
import path from 'node:path'
import { getDb } from '../db'
import { getManifestStore } from './manifest'
import type {
  AiProgressEstimateDto,
  AiRecordProgressSampleResponseDto,
  JsonObject,
  JsonValue,
  ModelManifestItem,
} from './types'

const DEFAULT_PROFILE_KEY = '__default__'
const GLOBAL_SAMPLE_WINDOW = 30
const BUCKET_SAMPLE_WINDOW = 20
const QUERY_SAMPLE_WINDOW = 180
const BUCKET_MIN_SAMPLE_COUNT = 6
const GLOBAL_MIN_SAMPLE_COUNT_FOR_BUCKETS = 12
const GENERATED_RESOURCE_FILE = 'progress-seeds.json'
const BASE_RESOURCE_FILE = 'progress-seeds.base.json'

type TimeBucket = 'night' | 'day' | 'evening'

interface ProgressSampleRow {
  duration_ms: number
  time_bucket: TimeBucket
}

interface EstimateComputation {
  durationMs: number
  sampleCount: number
}

interface ProgressSeedFile {
  version?: number
  generatedAt?: string
  models?: Record<string, ProgressSeedModel>
}

interface ProgressSeedModel {
  profiles?: Record<string, ProgressSeedProfile>
}

interface ProgressSeedProfile {
  globalMs?: number
  buckets?: Partial<Record<TimeBucket, number>>
}

let progressSeedFile: ProgressSeedFile | null = null

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
  const globalDefault = resolveGlobalDefaultMs(modelId, model, params)
  const globalDurations = recentSampleDurations(samples, undefined, GLOBAL_SAMPLE_WINDOW)
  const global = computeEstimate(globalDurations, globalDefault)
  const seedBucketMs = lookupSeedBucket(modelId, DEFAULT_PROFILE_KEY, timeBucket)
  const bucketDurations = recentSampleDurations(samples, timeBucket, BUCKET_SAMPLE_WINDOW)
  const bucketEstimate = bucketDurations.length > 0
    ? computeEstimate(bucketDurations, global.durationMs)
    : undefined

  if (global.sampleCount === 0) {
    if (seedBucketMs !== undefined) {
      return createEstimate({
        durationMs: seedBucketMs,
        source: 'seed',
        timeBucket,
        globalDefault,
        globalEstimateMs: globalDefault,
        globalSampleCount: 0,
        bucketSampleCount: 0,
        globalDurations,
        bucketDurations,
      })
    }

    return createEstimate({
      durationMs: global.durationMs,
      source: resolveDefaultSource(modelId, model, params),
      timeBucket,
      globalDefault,
      globalEstimateMs: globalDefault,
      globalSampleCount: 0,
      bucketSampleCount: 0,
      globalDurations,
      bucketDurations,
    })
  }

  if (global.sampleCount < GLOBAL_MIN_SAMPLE_COUNT_FOR_BUCKETS || bucketDurations.length < BUCKET_MIN_SAMPLE_COUNT) {
    return createEstimate({
      durationMs: global.durationMs,
      source: 'global',
      timeBucket,
      globalDefault,
      globalEstimateMs: global.durationMs,
      bucketEstimateMs: bucketEstimate?.durationMs,
      globalSampleCount: global.sampleCount,
      bucketSampleCount: bucketDurations.length,
      globalDurations,
      bucketDurations,
    })
  }

  const bucket = bucketEstimate ?? computeEstimate(bucketDurations, global.durationMs)
  return createEstimate({
    durationMs: bucket.durationMs,
    source: 'time-bucket',
    timeBucket,
    globalDefault,
    globalEstimateMs: global.durationMs,
    bucketEstimateMs: bucket.durationMs,
    globalSampleCount: global.sampleCount,
    bucketSampleCount: bucket.sampleCount,
    globalDurations,
    bucketDurations,
  })
}

function createEstimate(input: {
  durationMs: number
  source: AiProgressEstimateDto['source']
  timeBucket: TimeBucket
  globalDefault: number
  globalEstimateMs: number
  bucketEstimateMs?: number
  globalSampleCount: number
  bucketSampleCount: number
  globalDurations: number[]
  bucketDurations: number[]
}): AiProgressEstimateDto {
  return {
    durationMs: input.durationMs,
    source: input.source,
    profileKey: DEFAULT_PROFILE_KEY,
    timeBucket: input.timeBucket,
    globalSampleCount: input.globalSampleCount,
    bucketSampleCount: input.bucketSampleCount,
    defaultDurationMs: input.globalDefault,
    globalEstimateMs: input.globalEstimateMs,
    bucketEstimateMs: input.bucketEstimateMs,
    recentGlobalDurationsMs: input.globalDurations,
    recentBucketDurationsMs: input.bucketDurations,
  }
}

function recentSampleDurations(samples: ProgressSampleRow[], bucket: TimeBucket | undefined, limit: number): number[] {
  return samples
    .filter((sample) => bucket === undefined || sample.time_bucket === bucket)
    .slice(0, limit)
    .map((sample) => sample.duration_ms)
}

function computeEstimate(samples: number[], defaultMs: number): EstimateComputation {
  if (samples.length === 0) {
    return { durationMs: defaultMs, sampleCount: 0 }
  }
  if (samples.length < 10) {
    const total = defaultMs + samples.reduce((sum, value) => sum + value, 0)
    return { durationMs: Math.floor(total / (samples.length + 1)), sampleCount: samples.length }
  }
  if (samples.length < 12) {
    return {
      durationMs: Math.floor(samples.reduce((sum, value) => sum + value, 0) / samples.length),
      sampleCount: samples.length,
    }
  }
  const sorted = [...samples].sort((left, right) => left - right)
  const trimmed = sorted.slice(1, sorted.length - 1)
  return {
    durationMs: Math.floor(trimmed.reduce((sum, value) => sum + value, 0) / trimmed.length),
    sampleCount: samples.length,
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

function resolveGlobalDefaultMs(modelId: string, model: ModelManifestItem, params: JsonObject): number {
  return lookupSeedGlobal(modelId, DEFAULT_PROFILE_KEY) ??
    resolveMetaDurationMs(model, params) ??
    resolveGenericDefaultMs(model, params)
}

function resolveDefaultSource(
  modelId: string,
  model: ModelManifestItem,
  params: JsonObject
): AiProgressEstimateDto['source'] {
  if (lookupSeedGlobal(modelId, DEFAULT_PROFILE_KEY) !== undefined) return 'seed'
  if (resolveMetaDurationMs(model, params) !== undefined) return 'meta'
  return 'default'
}

function resolveMetaDurationMs(model: ModelManifestItem, params: JsonObject): number | undefined {
  const progress = model.progress
  if (progress?.mode === 'time') {
    const baseDurationMs = progress.baseDurationMs
    if (baseDurationMs === undefined) return undefined
    const unitCount = resolveUnitCount(params, progress.scaleWith)
    const perUnitMs = progress.perUnitMs ?? 0
    const raw = baseDurationMs + perUnitMs * Math.max(0, unitCount - 1)
    return clampNumber(raw, progress.minDurationMs ?? 1, progress.maxDurationMs ?? Math.max(raw, progress.minDurationMs ?? 1))
  }

  if (progress?.mode === 'polling') {
    const baseAttempts = progress.baseAttempts
    if (baseAttempts === undefined) return undefined
    const unitCount = resolveUnitCount(params, progress.scaleWith)
    const rawAttempts = baseAttempts + (progress.perUnitAttempts ?? 0) * Math.max(0, unitCount - 1)
    const minAttempts = progress.minAttempts ?? 1
    const maxAttempts = progress.maxAttempts ?? model.polling?.maxAttempts ?? Math.max(rawAttempts, minAttempts)
    const attempts = clampNumber(rawAttempts, minAttempts, maxAttempts)
    const intervalMs = progress.intervalMs ?? model.polling?.interval ?? 3000
    const rawDurationMs = attempts * intervalMs
    return clampNumber(rawDurationMs, progress.minDurationMs ?? 1, progress.maxDurationMs ?? Math.max(rawDurationMs, progress.minDurationMs ?? 1))
  }

  if (model.polling) {
    return (model.polling.expectedAttempts ?? model.polling.maxAttempts) * model.polling.interval
  }
  return undefined
}

function resolveGenericDefaultMs(model: ModelManifestItem, params: JsonObject): number {
  if (model.modelType === 'video') {
    const durationSeconds = pickFirstNumberLike(params, ['duration', 'videoDuration', 'video_duration', 'ppioWan25VideoDuration', 'seconds']) ?? 5
    const scale = clampNumber(clampNumber(durationSeconds, 1, 30) / 5, 0.5, 6)
    return clampNumber(Math.round(120_000 * scale), 30_000, 900_000)
  }
  if (model.modelType === 'audio') {
    const textLength = resolvePromptTextLength(params)
    const extraBlocks = textLength > 120 ? Math.ceil((textLength - 120) / 80) : 0
    return clampNumber(10_000 + extraBlocks * 800, 3_000, 120_000)
  }
  const imageCount = Math.max(1, Math.round(pickFirstNumberLike(params, ['maxImages', 'max_images', 'numImages', 'num_images', 'imageCount', 'image_count']) ?? 1))
  return clampNumber(60_000 + Math.max(0, imageCount - 1) * 12_000, 15_000, 240_000)
}

function resolveUnitCount(params: JsonObject, field: string | undefined): number {
  if (!field) return 1
  const value = params[field]
  if (Array.isArray(value)) return Math.max(1, value.length)
  if (typeof value === 'number') return Math.max(1, Math.round(value))
  if (typeof value === 'string') {
    const parsed = Number(value.trim())
    return Number.isFinite(parsed) ? Math.max(1, Math.round(parsed)) : 1
  }
  return 1
}

function resolvePromptTextLength(params: JsonObject): number {
  for (const key of ['text', 'prompt']) {
    const value = params[key]
    if (typeof value === 'string') return [...value.trim()].length
  }
  return 0
}

function pickFirstNumberLike(params: JsonObject, keys: string[]): number | undefined {
  for (const key of keys) {
    const parsed = parseNumber(params[key])
    if (parsed !== undefined) return parsed
  }
  return undefined
}

function lookupSeedGlobal(modelId: string, profileKey: string): number | undefined {
  const value = loadProgressSeedFile().models?.[modelId]?.profiles?.[profileKey]?.globalMs
  return typeof value === 'number' && value > 0 ? value : undefined
}

function lookupSeedBucket(modelId: string, profileKey: string, bucket: TimeBucket): number | undefined {
  const value = loadProgressSeedFile().models?.[modelId]?.profiles?.[profileKey]?.buckets?.[bucket]
  return typeof value === 'number' && value > 0 ? value : undefined
}

function loadProgressSeedFile(): ProgressSeedFile {
  if (progressSeedFile) return progressSeedFile
  for (const candidate of loadSeedCandidates()) {
    if (!fs.existsSync(candidate)) continue
    progressSeedFile = JSON.parse(fs.readFileSync(candidate, 'utf8')) as ProgressSeedFile
    return progressSeedFile
  }
  progressSeedFile = { version: 1, models: {} }
  return progressSeedFile
}

function loadSeedCandidates(): string[] {
  const cwd = process.cwd()
  const candidates = [
    path.join(cwd, 'resources', GENERATED_RESOURCE_FILE),
    path.join(cwd, 'resources', BASE_RESOURCE_FILE),
  ]
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'resources', GENERATED_RESOURCE_FILE))
    candidates.push(path.join(process.resourcesPath, '..', 'resources', GENERATED_RESOURCE_FILE))
    candidates.push(path.join(process.resourcesPath, 'resources', BASE_RESOURCE_FILE))
    candidates.push(path.join(process.resourcesPath, '..', 'resources', BASE_RESOURCE_FILE))
  }
  return candidates
}

function parseNumber(value: JsonValue | undefined): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value.trim())
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)))
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
