import type { AiRuntimeTrace } from '@/core/types'

export interface ProviderKeyStatusDto {
  providerId: string
  configured: boolean
}

export interface ProviderConnectionTestResultDto {
  providerId: string
  status:
    | 'connected'
    | 'saved_unverified'
    | 'not_configured'
    | 'invalid_key'
    | 'insufficient_balance'
    | 'rate_limited'
    | 'timeout'
    | 'network_error'
    | 'service_error'
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
  params: DynamicValueMap
  requestId?: string
}

export interface AiContinuePollingRequestDto {
  modelId: string
  taskId: string
  params?: DynamicValueMap
}

export interface AiGetProgressEstimateRequestDto {
  modelId: string
  params?: DynamicValueMap
}

export interface AiRecordProgressSampleRequestDto {
  modelId: string
  params?: DynamicValueMap
  startedAtMs: number
  finishedAtMs: number
  source: 'generation' | 'canvas'
}

export interface AiGenerateResponseDto {
  status: 'completed' | 'pending' | 'failed'
  url: string
  filePath?: string
  taskId?: string
  metadata?: DynamicValueMap
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

export interface AiRuntimePlatform {
  setProviderApiKey(providerId: string, apiKey: string): Promise<void>
  removeProviderApiKey(providerId: string): Promise<void>
  getProviderApiKey(providerId: string): Promise<string | null>
  getProviderKeyStatus(): Promise<ProviderKeyStatusDto[]>
  testProviderConnection(providerId: string): Promise<ProviderConnectionTestResultDto>
  generate(request: AiGenerateRequestDto): Promise<AiGenerateResponseDto>
  continuePolling(request: AiContinuePollingRequestDto): Promise<AiGenerateResponseDto>
  cancelTask(taskId: string): Promise<void>
  reloadModelManifest(): Promise<number>
  getProgressEstimate(request: AiGetProgressEstimateRequestDto): Promise<AiProgressEstimateDto>
  recordProgressSample(
    request: AiRecordProgressSampleRequestDto
  ): Promise<AiRecordProgressSampleResponseDto>
}
