import type { AiRuntimeTrace } from '@/core/types'
import type { StructuredGenerationOutput, TtsVoice } from '@henjicc/ai-sdk'
import { getPlatform, isDesktopRuntime } from '@/platform/runtime'
import type { DocumentContainerRef } from '@/core/documents/types'

export interface ProviderKeyStatusDto {
  providerId: string
  configured: boolean
}

export type { ProviderConnectionTestResultDto } from '@/platform/contracts/aiRuntime'

export interface AiGenerateRequestDto {
  modelId: string
  params: DynamicValueMap
  requestId?: string
  /** 结果文件放进哪个容器的“生成结果”（项目或作品目录）；省略时放作品目录“生成结果”。由宿主解析位置，不进模型参数。 */
  outputContainer?: DocumentContainerRef
}

export interface AiContinuePollingRequestDto {
  modelId: string
  taskId: string
  params?: DynamicValueMap
  requestId?: string
  /** 结果文件放进哪个容器的“生成结果”（项目或作品目录）；省略时放作品目录“生成结果”。由宿主解析位置，不进模型参数。 */
  outputContainer?: DocumentContainerRef
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
  ttsVoiceCache.clear()
}

export async function aiRemoveProviderApiKey(providerId: string): Promise<void> {
  ensureDesktopRuntime()
  await getPlatform().aiRuntime.removeProviderApiKey(providerId)
  ttsVoiceCache.clear()
}

export async function aiGetProviderApiKey(providerId: string): Promise<string | null> {
  ensureDesktopRuntime()
  return await getPlatform().aiRuntime.getProviderApiKey(providerId)
}

export async function aiGetProviderKeyStatus(): Promise<ProviderKeyStatusDto[]> {
  ensureDesktopRuntime()
  return await getPlatform().aiRuntime.getProviderKeyStatus()
}

export async function aiTestProviderConnection(
  providerId: string
): Promise<import('@/platform/contracts/aiRuntime').ProviderConnectionTestResultDto> {
  ensureDesktopRuntime()
  return await getPlatform().aiRuntime.testProviderConnection(providerId)
}

const TTS_VOICE_CACHE_MS = 24 * 60 * 60 * 1000
const ttsVoiceCache = new Map<string, { voices?: TtsVoice[]; expiresAt: number; pending?: Promise<TtsVoice[]> }>()

/** 已获取的列表可直接展示；过期后由读取入口后台更新。 */
export function aiGetCachedTtsVoices(modelId: string): TtsVoice[] | undefined {
  return ttsVoiceCache.get(modelId)?.voices
}

export async function aiListTtsVoices(modelId: string, force = false): Promise<TtsVoice[]> {
  ensureDesktopRuntime()
  const cached = ttsVoiceCache.get(modelId)
  if (cached?.pending) return cached.pending
  if (!force && cached?.voices && cached.expiresAt > Date.now()) return cached.voices
  const entry = { voices: cached?.voices, expiresAt: cached?.expiresAt ?? 0, pending: undefined as Promise<TtsVoice[]> | undefined }
  ttsVoiceCache.set(modelId, entry)
  entry.pending = getPlatform().aiRuntime.listTtsVoices(modelId).then(voices => {
    entry.voices = voices
    entry.expiresAt = Date.now() + TTS_VOICE_CACHE_MS
    return voices
  }).finally(() => { entry.pending = undefined })
  return entry.pending
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

export async function aiReadSavedResult(requestId: string): Promise<import('@/platform/contracts/aiRuntime').AiSavedResult | null> {
  ensureDesktopRuntime()
  return getPlatform().aiRuntime.readSavedResult(requestId)
}
