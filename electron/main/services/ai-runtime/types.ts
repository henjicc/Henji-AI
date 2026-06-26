export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue }

export type JsonObject = { [key: string]: JsonValue }

export interface ProviderKeyStatusDto {
  providerId: string
  configured: boolean
}

export interface AiGenerateRequestDto {
  modelId: string
  params: JsonObject
  requestId?: string
}

export interface AiContinuePollingRequestDto {
  modelId: string
  taskId: string
  params?: JsonObject
}

export interface AiGetProgressEstimateRequestDto {
  modelId: string
  params?: JsonObject
}

export interface AiRecordProgressSampleRequestDto {
  modelId: string
  params?: JsonObject
  startedAtMs: number
  finishedAtMs: number
  source: 'generation' | 'canvas'
}

export type GenerateStatus = 'completed' | 'pending' | 'failed'

export interface AiRuntimeTrace {
  modelId: string
  providerId: string
  requestId: string
  phase: 'generate' | 'continuePolling'
  route: string
  method: string
  taskId?: string
  requestBody?: JsonValue
  responseBody: JsonValue
}

export interface AiGenerateResponseDto {
  status: GenerateStatus
  url: string
  filePath?: string
  taskId?: string
  metadata?: JsonValue
  trace?: AiRuntimeTrace
}

export interface AiProgressEstimateDto {
  durationMs: number
  source: 'time-bucket' | 'global' | 'seed' | 'meta' | 'default'
  profileKey: string
  timeBucket: 'night' | 'day' | 'evening'
  globalSampleCount: number
  bucketSampleCount: number
  defaultDurationMs: number
  globalEstimateMs: number
  bucketEstimateMs?: number
  recentGlobalDurationsMs: number[]
  recentBucketDurationsMs: number[]
}

export interface AiRecordProgressSampleResponseDto {
  actualDurationMs: number
  estimate: AiProgressEstimateDto
}

export interface ModelManifest {
  models?: ModelManifestItem[]
}

export interface ModelManifestItem {
  modelId: string
  providerId: string
  modelType?: string
  polling?: PollingConfig
  progress?: ProgressConfig
  progressLearning?: ProgressLearningConfig
  endpoints?: EndpointConfigDsl
  request?: RequestConfigDsl
  runtimeConstraints?: RuntimeConstraintsDsl
}

export interface PollingConfig {
  interval: number
  maxAttempts: number
  expectedAttempts?: number
}

export interface ProgressConfig {
  mode: string
  baseDurationMs?: number
  perUnitMs?: number
  scaleWith?: string
  minDurationMs?: number
  maxDurationMs?: number
  baseAttempts?: number
  perUnitAttempts?: number
  minAttempts?: number
  maxAttempts?: number
  intervalMs?: number
}

export interface ProgressLearningConfig {
  segments?: ProgressLearningSegment[]
  enableTimeBuckets?: boolean
}

export type ProgressLearningSegment =
  | { kind: 'field'; field: string }
  | { kind: 'textLength'; field: string; buckets: number[] }

export interface EndpointRuleDsl {
  when: JsonValue
  route: string
  method?: string
}

export interface EndpointNamedRouteDsl {
  path: string
  method?: string
}

export interface EndpointConfigDsl {
  defaultRoute: string
  rules?: EndpointRuleDsl[]
  selectorJs?: string
  method?: string
  routes?: Record<string, EndpointNamedRouteDsl>
}

export interface RequestTransformDsl {
  name: string
  args?: JsonObject
}

export interface RequestFieldDsl {
  from: string
  to: string
  transforms?: RequestTransformDsl[]
  when?: JsonValue
}

export interface RequestConfigDsl {
  constants?: JsonObject
  fields?: RequestFieldDsl[]
  removeEmpty?: string[]
  builderJs?: string
}

export interface RuntimeConstraintsDsl {
  numberFields?: RuntimeNumberFieldConstraintDsl[]
  enumFields?: RuntimeEnumFieldConstraintDsl[]
  imageSizeFields?: RuntimeImageSizeFieldConstraintDsl[]
}

export interface RuntimeNumberFieldConstraintDsl {
  field: string
  min?: number
  max?: number
  integer?: boolean
  fallback?: number
}

export interface RuntimeEnumFieldConstraintDsl {
  field: string
  allowed?: JsonValue[]
  fallback?: JsonValue
}

export interface RuntimeImageSizeFieldConstraintDsl {
  field: string
  format?: string
  widthKey?: string
  heightKey?: string
  minSide?: number
  maxSide?: number
  minPixels?: number
  maxPixels: number
  minAspectRatio?: number
  maxAspectRatio?: number
}

export interface BuiltRequest {
  route: string
  method: string
  body: JsonValue
}

export interface ProviderExecutionInput {
  apiKey: string
  route: string
  method: string
  body: JsonValue
  requestId: string
  polling?: PollingConfig
  signal?: AbortSignal
}

export interface ProviderContinuePollingInput {
  apiKey: string
  route: string
  taskId: string
  requestId: string
  polling?: PollingConfig
  signal?: AbortSignal
}

export interface ProviderExecutionResult {
  status: GenerateStatus
  url: string
  taskId?: string
  metadata: JsonValue
}
