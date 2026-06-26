import { Channel, invoke } from '@tauri-apps/api/core'
import type { LlmChatRequest, LlmStreamEvent } from '@/core/llm/types'
import type { LlmProviderKeyStatusDto, LlmRuntimePlatform } from '@/platform/contracts/llmRuntime'

export function createTauriLlmRuntime(): LlmRuntimePlatform {
  return {
    async setProviderApiKey(providerId, apiKey) {
      await invoke('llm_set_provider_api_key', { providerId, apiKey })
    },
    async removeProviderApiKey(providerId) {
      await invoke('llm_remove_provider_api_key', { providerId })
    },
    async getProviderApiKey(providerId) {
      return await invoke<string | null>('llm_get_provider_api_key', { providerId })
    },
    async getProviderKeyStatus(providerIds) {
      return await invoke<LlmProviderKeyStatusDto[]>('llm_get_provider_key_status', { providerIds })
    },
    async chatStream(request: LlmChatRequest, onEvent: (event: LlmStreamEvent) => void) {
      const channel = new Channel<LlmStreamEvent>()
      channel.onmessage = onEvent
      await invoke('llm_chat_stream', { request, onEvent: channel })
    },
    async cancelTask(taskId) {
      await invoke('llm_cancel_task', { taskId })
    },
  }
}
