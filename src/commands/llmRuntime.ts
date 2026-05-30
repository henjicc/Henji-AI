import { Channel, invoke, isTauri } from '@tauri-apps/api/core'
import type { LlmChatRequest, LlmStreamEvent } from '@/core/llm/types'

export interface LlmProviderKeyStatusDto {
  providerId: string
  configured: boolean
}

function ensureDesktopRuntime(): void {
  if (!isTauri()) {
    throw new Error('LLM Runtime only available in Tauri desktop mode')
  }
}

export async function llmSetProviderApiKey(providerId: string, apiKey: string): Promise<void> {
  ensureDesktopRuntime()
  await invoke('llm_set_provider_api_key', { providerId, apiKey })
}

export async function llmRemoveProviderApiKey(providerId: string): Promise<void> {
  ensureDesktopRuntime()
  await invoke('llm_remove_provider_api_key', { providerId })
}

export async function llmGetProviderApiKey(providerId: string): Promise<string | null> {
  ensureDesktopRuntime()
  return await invoke<string | null>('llm_get_provider_api_key', { providerId })
}

export async function llmGetProviderKeyStatus(providerIds: string[]): Promise<LlmProviderKeyStatusDto[]> {
  ensureDesktopRuntime()
  return await invoke<LlmProviderKeyStatusDto[]>('llm_get_provider_key_status', { providerIds })
}

export async function llmChatStream(
  request: LlmChatRequest,
  onEvent: (event: LlmStreamEvent) => void
): Promise<void> {
  ensureDesktopRuntime()
  const channel = new Channel<LlmStreamEvent>()
  channel.onmessage = onEvent
  await invoke('llm_chat_stream', { request, onEvent: channel })
}

export async function llmCancelTask(taskId: string): Promise<void> {
  ensureDesktopRuntime()
  await invoke('llm_cancel_task', { taskId })
}
