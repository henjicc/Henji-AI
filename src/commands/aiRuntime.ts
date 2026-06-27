import type { AiRuntimeTrace } from '@/core/types'
import { getPlatform, isDesktopRuntime } from '@/platform/runtime'

export interface ProviderKeyStatusDto {
  providerId: string
  configured: boolean
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

function ensureDesktopRuntime(): void {
  if (!isDesktopRuntime()) {
    throw new Error('AI Runtime only available in desktop mode')
  }
}

export async function aiSetProviderApiKey(providerId: string, apiKey: string): Promise<void> {
  ensureDesktopRuntime()
  await getPlatform().aiRuntime.setProviderApiKey(providerId, apiKey)
}

export async function aiRemoveProviderApiKey(providerId: string): Promise<void> {
  ensureDesktopRuntime()
  await getPlatform().aiRuntime.removeProviderApiKey(providerId)
}

export async function aiGetProviderApiKey(providerId: string): Promise<string | null> {
  ensureDesktopRuntime()
  return await getPlatform().aiRuntime.getProviderApiKey(providerId)
}

export async function aiGetProviderKeyStatus(): Promise<ProviderKeyStatusDto[]> {
  ensureDesktopRuntime()
  return await getPlatform().aiRuntime.getProviderKeyStatus()
}

export async function aiGenerate(request: AiGenerateRequestDto): Promise<AiGenerateResponseDto> {
  ensureDesktopRuntime()
  return await getPlatform().aiRuntime.generate(request)
}

export async function aiContinuePolling(request: AiContinuePollingRequestDto): Promise<AiGenerateResponseDto> {
  ensureDesktopRuntime()
  return await getPlatform().aiRuntime.continuePolling(request)
}

export async function aiCancelTask(taskId: string): Promise<void> {
  ensureDesktopRuntime()
  await getPlatform().aiRuntime.cancelTask(taskId)
}

export async function aiReloadModelManifest(): Promise<number> {
  ensureDesktopRuntime()
  return await getPlatform().aiRuntime.reloadModelManifest()
}

export async function aiGetProgressEstimate(
  request: AiGetProgressEstimateRequestDto
): Promise<AiProgressEstimateDto> {
  ensureDesktopRuntime()
  return await getPlatform().aiRuntime.getProgressEstimate(request)
}

export async function aiRecordProgressSample(
  request: AiRecordProgressSampleRequestDto
): Promise<AiRecordProgressSampleResponseDto> {
  ensureDesktopRuntime()
  return await getPlatform().aiRuntime.recordProgressSample(request)
}
