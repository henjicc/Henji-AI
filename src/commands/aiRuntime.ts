import { invoke, isTauri } from '@tauri-apps/api/core'

export interface ProviderKeyStatusDto {
  providerId: string
  configured: boolean
}

export interface AiGenerateRequestDto {
  modelId: string
  params: Record<string, unknown>
  requestId?: string
}

export interface AiContinuePollingRequestDto {
  modelId: string
  taskId: string
  params?: Record<string, unknown>
}

export interface AiGenerateResponseDto {
  status: 'completed' | 'failed' | 'timeout'
  url: string
  filePath?: string
  metadata?: Record<string, unknown>
}

function ensureDesktopRuntime(): void {
  if (!isTauri()) {
    throw new Error('AI Runtime only available in Tauri desktop mode')
  }
}

export async function aiSetProviderApiKey(providerId: string, apiKey: string): Promise<void> {
  ensureDesktopRuntime()
  await invoke('ai_set_provider_api_key', { providerId, apiKey })
}

export async function aiRemoveProviderApiKey(providerId: string): Promise<void> {
  ensureDesktopRuntime()
  await invoke('ai_remove_provider_api_key', { providerId })
}

export async function aiGetProviderKeyStatus(): Promise<ProviderKeyStatusDto[]> {
  ensureDesktopRuntime()
  return await invoke<ProviderKeyStatusDto[]>('ai_get_provider_key_status')
}

export async function aiGenerate(request: AiGenerateRequestDto): Promise<AiGenerateResponseDto> {
  ensureDesktopRuntime()
  return await invoke<AiGenerateResponseDto>('ai_generate', { request })
}

export async function aiContinuePolling(request: AiContinuePollingRequestDto): Promise<AiGenerateResponseDto> {
  ensureDesktopRuntime()
  return await invoke<AiGenerateResponseDto>('ai_continue_polling', { request })
}

export async function aiCancelTask(taskId: string): Promise<void> {
  ensureDesktopRuntime()
  await invoke('ai_cancel_task', { taskId })
}

export async function aiReloadModelManifest(): Promise<number> {
  ensureDesktopRuntime()
  return await invoke<number>('ai_reload_model_manifest')
}
