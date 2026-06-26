import type { LlmChatRequest, LlmStreamEvent } from '@/core/llm/types'

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
  cancelTask(taskId: string): Promise<void>
}
