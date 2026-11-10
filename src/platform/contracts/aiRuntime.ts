import type { ProviderKeyInfo } from '../../core/providerKeyInfo'
import type { AiRuntimeTrace } from '@/core/types'
import type { StructuredGenerationOutput, TtsVoice } from '@henjicc/ai-sdk'
import type { DocumentContainerRef } from '../../core/documents/types'

interface ProviderKeyStatusDto {
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

interface AiGenerateRequestDto {
  paidReceipt?: import('../../core/application-control/paidApproval').PaidOperationReceipt
  modelId: string
  params: DynamicValueMap
  requestId?: string
  /** 结果文件放进哪个容器的“生成结果”（项目或作品目录）；省略时放作品目录“生成结果”。由宿主解析位置，不进模型参数。 */
  outputContainer?: DocumentContainerRef
}

interface AiContinuePollingRequestDto {
  modelId: string
  taskId: string
  params?: DynamicValueMap
  requestId?: string
  /** 结果文件放进哪个容器的“生成结果”（项目或作品目录）；省略时放作品目录“生成结果”。由宿主解析位置，不进模型参数。 */
  outputContainer?: DocumentContainerRef
}

interface AiGetProgressEstimateRequestDto {
  modelId: string
  params?: DynamicValueMap
}

interface AiRecordProgressSampleRequestDto {
  modelId: string
  params?: DynamicValueMap
  startedAtMs: number
  finishedAtMs: number
  source: 'generation' | 'canvas'
}

interface AiGenerateResponseDto {
  status: 'completed' | 'pending' | 'failed'
  /** 供应商返回的结果地址，按输出顺序。 */
  urls: string[]
  /** 已保存到本地的结果文件，按输出顺序；没保存时为空数组。 */
  filePaths: string[]
  createdFilePaths?: string[]
  taskId?: string
  metadata?: DynamicValueMap
  structuredOutput?: StructuredGenerationOutput
  trace?: AiRuntimeTrace
}

interface AiProgressEstimateDto {
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

interface AiRecordProgressSampleResponseDto {
  actualDurationMs: number
  estimate: AiProgressEstimateDto
}

/** @public 通过 import() 类型引用，knip 看不到。 */
export interface AiSavedResult { status?: string; taskId?: string; urls?: string[]; filePaths?: string[]; createdFilePaths?: string[]; metadata?: unknown; structuredOutput?: unknown }

export interface AiRuntimePlatform {
  readSavedResult(requestId: string): Promise<AiSavedResult | null>
  setProviderApiKey(providerId: string, apiKey: string): Promise<void>
  removeProviderApiKey(providerId: string): Promise<void>
  getProviderKeyInfo(providerId: string): Promise<ProviderKeyInfo>
  getProviderKeyStatus(): Promise<ProviderKeyStatusDto[]>
  testProviderConnection(providerId: string): Promise<ProviderConnectionTestResultDto>
  listTtsVoices(modelId: string): Promise<TtsVoice[]>
  generate(request: AiGenerateRequestDto): Promise<AiGenerateResponseDto>
  continuePolling(request: AiContinuePollingRequestDto): Promise<AiGenerateResponseDto>
  cancelTask(taskId: string): Promise<void>
  getProgressEstimate(request: AiGetProgressEstimateRequestDto): Promise<AiProgressEstimateDto>
  recordProgressSample(
    request: AiRecordProgressSampleRequestDto
  ): Promise<AiRecordProgressSampleResponseDto>
}
