import { invoke, isTauri } from '@tauri-apps/api/core'
import type { AiRuntimeTrace } from '@/core/types'

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

export interface AiGetProgressEstimateRequestDto {
  modelId: string
  params?: Record<string, unknown>
}

export interface AiRecordProgressSampleRequestDto {
  modelId: string
  params?: Record<string, unknown>
  startedAtMs: number
  finishedAtMs: number
  source: 'generation' | 'canvas'
}

export interface AiGenerateResponseDto {
  status: 'completed' | 'pending' | 'failed'
  url: string
  filePath?: string
  taskId?: string
  metadata?: Record<string, unknown>
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

export async function aiGetProviderApiKey(providerId: string): Promise<string | null> {
  ensureDesktopRuntime()
  return await invoke<string | null>('ai_get_provider_api_key', { providerId })
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

export async function aiGetProgressEstimate(
  request: AiGetProgressEstimateRequestDto
): Promise<AiProgressEstimateDto> {
  ensureDesktopRuntime()
  return await invoke<AiProgressEstimateDto>('ai_get_progress_estimate', { request })
}

export async function aiRecordProgressSample(
  request: AiRecordProgressSampleRequestDto
): Promise<AiRecordProgressSampleResponseDto> {
  ensureDesktopRuntime()
  return await invoke<AiRecordProgressSampleResponseDto>('ai_record_progress_sample', { request })
}
