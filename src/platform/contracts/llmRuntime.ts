import type { LlmChatRequest, LlmStreamEvent } from '@/core/llm/types'
import type { ModelStepEvent, ModelStepInput, ModelStepResult } from '@/core/llm/modelStep'
import type { ModelCapabilitySmokeRequest, ModelCapabilitySmokeResult } from '@/core/llm/capabilitySmoke'

export interface LlmProviderKeyStatusDto {
  providerId: string
  configured: boolean
}

export interface LlmRuntimePlatform {
  setProviderApiKey(providerId: string, apiKey: string): Promise<void>
  removeProviderApiKey(providerId: string): Promise<void>
  getProviderApiKey(providerId: string): Promise<string | null>
  getProviderKeyStatus(providerIds: string[]): Promise<LlmProviderKeyStatusDto[]>
  chatStream(request: LlmChatRequest, onEvent: (event: LlmStreamEvent) => void): Promise<void>
  modelStep(input: ModelStepInput, onEvent: (event: ModelStepEvent) => void): Promise<ModelStepResult>
  verifyModelCapabilities(request: ModelCapabilitySmokeRequest): Promise<ModelCapabilitySmokeResult>
  cancelTask(taskId: string): Promise<void>
}
