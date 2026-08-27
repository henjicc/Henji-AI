import type { RuntimeContext } from '../runtime'

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

export type ProviderConnectionStatus =
  | 'connected'
  | 'saved_unverified'
  | 'not_configured'
  | 'invalid_key'
  | 'insufficient_balance'
  | 'rate_limited'
  | 'timeout'
  | 'network_error'
  | 'service_error'

export interface ProviderConnectionTestResultDto {
  providerId: string
  status: ProviderConnectionStatus
  verified: boolean
  checkedAt: string
  durationMs: number
  httpStatus?: number
  remainingBalance?: number
  balanceUnit?: 'credits' | 'provider_units'
  unlimitedBalance?: boolean
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

export interface PollingConfig {
  interval: number
  maxAttempts: number
  expectedAttempts?: number
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
  /**
   * 宿主运行时能力（网络、凭据、媒体、日志、追踪）。任务 2.3 起供应商适配器改为从这里取
   * `Transport`，不再直接依赖全局 `fetch`。设为必填字段（而不是可选 + 运行时校验）是刻意的：
   * 借助 TypeScript 编译期检查，任何遗漏传参的调用点在 `tsc` 阶段就会报错，不会等到运行时
   * 才暴露成一个难以追踪的 `undefined` 异常（见任务文件「风险与回退」的缓解措施）。
   */
  runtime: RuntimeContext
}

export interface ProviderContinuePollingInput {
  apiKey: string
  route: string
  taskId: string
  requestId: string
  polling?: PollingConfig
  signal?: AbortSignal
  /** 同 {@link ProviderExecutionInput.runtime}。 */
  runtime: RuntimeContext
}

export interface ProviderExecutionResult {
  status: GenerateStatus
  url: string
  taskId?: string
  metadata: JsonValue
}
