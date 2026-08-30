import type {
  LlmConfigState,
  LlmModelConfig,
  LlmProviderConfig,
  LlmReasoningConfig,
  ModelStepEvent,
  ModelStepInput,
  ModelStepResult,
  StructuredGenerationOutput,
} from '@henjicc/ai-sdk'
import type {
  ModelCapabilitySmokeRequest,
  ModelCapabilitySmokeResult,
} from '../../src/core/llm/capabilitySmoke'

export interface HenjiProviderKeyStatus {
  providerId: string
  configured: boolean
}

export interface HenjiAiGenerateRequest {
  modelId: string
  params: Record<string, unknown>
  requestId?: string
}

export interface HenjiAiContinuePollingRequest {
  modelId: string
  taskId: string
  params?: Record<string, unknown>
  requestId?: string
}

export interface HenjiAiGetProgressEstimateRequest {
  modelId: string
  params?: Record<string, unknown>
}

export interface HenjiAiRecordProgressSampleRequest {
  modelId: string
  params?: Record<string, unknown>
  startedAtMs: number
  finishedAtMs: number
  source: 'generation' | 'canvas'
}

export interface HenjiAiGenerateResponse {
  status: 'completed' | 'pending' | 'failed'
  url: string
  filePath?: string
  createdFilePaths?: string[]
  taskId?: string
  metadata?: unknown
  structuredOutput?: StructuredGenerationOutput
  trace?: unknown
}

export interface HenjiAiProgressEstimate {
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

export interface HenjiAiRecordProgressSampleResponse {
  actualDurationMs: number
  estimate: HenjiAiProgressEstimate
}

export interface HenjiProviderConnectionTestResult {
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

export interface HenjiAiApi {
  setProviderApiKey(providerId: string, apiKey: string): Promise<void>
  removeProviderApiKey(providerId: string): Promise<void>
  getProviderApiKey(providerId: string): Promise<string | null>
  getProviderKeyStatus(): Promise<HenjiProviderKeyStatus[]>
  testProviderConnection(providerId: string): Promise<HenjiProviderConnectionTestResult>
  generate(request: HenjiAiGenerateRequest): Promise<HenjiAiGenerateResponse>
  continuePolling(request: HenjiAiContinuePollingRequest): Promise<HenjiAiGenerateResponse>
  cancelTask(taskId: string): Promise<void>
  getProgressEstimate(request: HenjiAiGetProgressEstimateRequest): Promise<HenjiAiProgressEstimate>
  recordProgressSample(request: HenjiAiRecordProgressSampleRequest): Promise<HenjiAiRecordProgressSampleResponse>
  consumePendingResult(serverTaskId: string): Promise<{
    url?: string
    filePath?: string
    createdFilePaths?: string[]
    metadata?: unknown
    structuredOutput?: StructuredGenerationOutput
  } | null>
}

export interface HenjiLlmApi {
  getProviderApiKey(credentialId: string): Promise<string | null>
  getProviderKeyStatus(credentialIds: string[]): Promise<Array<{ credentialId: string; configured: boolean }>>
  readConfig(): Promise<LlmConfigState | null>
  writeConfig(config: LlmConfigState): Promise<void>
  commitProviderSettings(request: {
    provider: LlmProviderConfig
    seedModels: LlmModelConfig[]
    baselineConfig: LlmConfigState
    credential: { kind: 'unchanged' } | { kind: 'set'; apiKey: string } | { kind: 'remove' }
  }): Promise<HenjiLlmProviderSettingsResult>
  deleteProviderSettings(request: {
    providerId: string
    baselineConfig: LlmConfigState
  }): Promise<HenjiLlmProviderSettingsResult>
  chatStream(request: HenjiLlmChatRequest, onEvent: (event: HenjiLlmStreamEvent) => void): Promise<void>
  modelStep(input: ModelStepInput, onEvent: (event: ModelStepEvent) => void): Promise<ModelStepResult>
  verifyModelCapabilities(request: ModelCapabilitySmokeRequest): Promise<ModelCapabilitySmokeResult>
  cancelTask(taskId: string): Promise<void>
  discoverModels(provider: Pick<
    LlmProviderConfig,
    'providerId' | 'providerFamilyId' | 'endpointProfile' | 'credentialId' | 'baseUrl'
  >): Promise<Array<{
    modelId: string
    displayName: string
    contextWindow: number | null
    maxOutputTokens: number | null
  }>>
}

export interface HenjiLlmProviderSettingsResult {
  config: LlmConfigState
  providerId: string
  credentialId: string
  configured: boolean
  apiKeyUrl: string | null
  credentialAction: 'unchanged' | 'set' | 'removed' | 'preserved_shared'
  rollbackStatus: 'not-needed' | 'completed'
}

export interface HenjiModelStepEventPayload {
  streamId: string
  event: ModelStepEvent
}

export type HenjiLlmRole = 'system' | 'user' | 'assistant'

export interface HenjiLlmContentPart {
  type: string
  text?: string
  imageUrl?: unknown
  videoUrl?: unknown
  inputAudio?: unknown
  [key: string]: unknown
}

export interface HenjiLlmChatMessage {
  role: HenjiLlmRole
  content?: string | HenjiLlmContentPart[] | null
  name?: string
  [key: string]: unknown
}

export interface HenjiLlmChatRequest {
  requestId?: string
  providerId: string
  providerFamilyId?: string
  endpointProfile?: string
  credentialId?: string
  modelId: string
  adapter?: string
  baseUrl?: string
  reasoning?: LlmReasoningConfig
  messages: HenjiLlmChatMessage[]
  capabilities?: Record<string, unknown>
  tools?: unknown
  policy?: Record<string, unknown>
  memory?: Record<string, unknown>
  metadata?: Record<string, unknown>
}

export interface HenjiLlmTrace {
  providerId: string
  modelId: string
  startedAtMs: number
  elapsedMs: number
  inputChars: number
  outputChars: number
}

export type HenjiLlmStreamEvent =
  | { type: 'Token'; data: string }
  | { type: 'ReasoningToken'; data: string }
  | { type: 'Done'; data: HenjiLlmTrace }
  | { type: 'Error'; data: string }

export interface HenjiLlmStreamEventPayload {
  streamId: string
  event: HenjiLlmStreamEvent
}
