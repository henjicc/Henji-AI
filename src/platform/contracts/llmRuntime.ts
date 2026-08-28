import type {
  LlmChatRequest,
  LlmConfigState,
  LlmModelConfig,
  LlmProviderConfig,
  LlmStreamEvent,
} from '@henjicc/ai-sdk'
import type { ModelStepEvent, ModelStepInput, ModelStepResult } from '@henjicc/ai-sdk'
import type { ModelCapabilitySmokeRequest, ModelCapabilitySmokeResult } from '@/core/llm/capabilitySmoke'

export interface LlmProviderKeyStatusDto {
  credentialId: string
  configured: boolean
}

export type LlmCredentialMutationDto =
  | { kind: 'unchanged' }
  | { kind: 'set'; apiKey: string }
  | { kind: 'remove' }

export interface CommitLlmProviderSettingsDto {
  provider: LlmProviderConfig
  seedModels: LlmModelConfig[]
  baselineConfig: LlmConfigState
  credential: LlmCredentialMutationDto
}

export interface DeleteLlmProviderSettingsDto {
  providerId: string
  baselineConfig: LlmConfigState
}

export interface LlmProviderSettingsResultDto {
  config: LlmConfigState
  providerId: string
  credentialId: string
  configured: boolean
  apiKeyUrl: string | null
  credentialAction: 'unchanged' | 'set' | 'removed' | 'preserved_shared'
  rollbackStatus: 'not-needed' | 'completed'
}

export interface LlmRuntimePlatform {
  getProviderApiKey(credentialId: string): Promise<string | null>
  getProviderKeyStatus(credentialIds: string[]): Promise<LlmProviderKeyStatusDto[]>
  readConfig(): Promise<LlmConfigState | null>
  writeConfig(config: LlmConfigState): Promise<void>
  commitProviderSettings(request: CommitLlmProviderSettingsDto): Promise<LlmProviderSettingsResultDto>
  deleteProviderSettings(request: DeleteLlmProviderSettingsDto): Promise<LlmProviderSettingsResultDto>
  chatStream(request: LlmChatRequest, onEvent: (event: LlmStreamEvent) => void): Promise<void>
  modelStep(input: ModelStepInput, onEvent: (event: ModelStepEvent) => void): Promise<ModelStepResult>
  verifyModelCapabilities(request: ModelCapabilitySmokeRequest): Promise<ModelCapabilitySmokeResult>
  cancelTask(taskId: string): Promise<void>
}
