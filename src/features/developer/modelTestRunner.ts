import { LLM_PROVIDER_PRESETS, type LlmTrace } from '@henjicc/ai-sdk'
import { llmChatStream } from '@/commands/llmRuntime'
import { resolveInputLimits } from '@/core/inputs/inputLimits'
import { resolveModeForMedia } from '@/core/inputs/modeForMedia'
import { registry } from '@/core/ModelRegistry'
import type { ProgressStatus } from '@/core/providers/base/types'
import { generationService } from '@/core/services/GenerationService'
import { prepareGenerationTask } from '@/features/generation/application/generationPreparationService'
import { llmConfigService } from '@/services/llm'
import { withPaidOperation } from '@/services/paidApproval'
import { getPlatform } from '@/platform/runtime'

export type TestMediaKind = 'images' | 'videos' | 'audios'
export type TestMedia = Readonly<Record<TestMediaKind, readonly string[]>>
export const EMPTY_TEST_MEDIA: TestMedia = { images: [], videos: [], audios: [] }

/** 这种素材在模型任一模式或渠道下收不收；全都不收的素材不发给它，免得一张图就让纯文生模型整次失败。 */
export function modelAcceptsMedia(modelId: string, kind: TestMediaKind): boolean {
  const model = registry.getModel(modelId)
  if (!model) return false
  const defaults = registry.getDefaultValues(modelId)
  const variants = [{}, ...model.params.flatMap((param) => (param.type === 'dropdown' || param.type === 'radio') && param.role
    ? (param.options ?? []).map((option) => ({ [param.id]: option.value }))
    : [])]
  return variants.some((variant) => resolveInputLimits(modelId, { ...defaults, ...variant })[kind].max > 0)
}

export interface GenerationTestResult {
  requestId: string
  elapsedMs: number
  urls: string[]
  filePaths: string[]
  /** 按素材自动换过的模式或渠道，界面据此同步参数 */
  params: DynamicValueMap
}

export async function runGenerationTest(input: {
  modelId: string
  prompt: string
  params: DynamicValueMap
  media: TestMedia
  signal: AbortSignal
  onProgress?: (status: ProgressStatus) => void
}): Promise<GenerationTestResult> {
  const model = registry.getModel(input.modelId)
  if (!model) throw new Error('模型没有注册')
  const pick = (kind: TestMediaKind): string[] => modelAcceptsMedia(input.modelId, kind) ? [...input.media[kind]] : []
  const images = pick('images'), videos = pick('videos'), audios = pick('audios')
  const supplied: DynamicValueMap = {
    ...input.params,
    uploadedFilePaths: images, images,
    uploadedVideoFilePaths: videos, videos,
    uploadedAudioFilePaths: audios,
  }
  // 能在生成页选到的模型先走正式准备：同一套联动、按素材选模式和参数校验；受控工具没有公开入口，直接按素材选模式
  const options = !registry.getDiscoverableModel(input.modelId)
    ? resolveModeForMedia(input.modelId, { ...registry.getDefaultValues(input.modelId), ...supplied }, { images: images.length, videos: videos.length, audios: audios.length })
    : prepareGenerationTask({ modelId: input.modelId, prompt: input.prompt, mediaType: model.meta.type as 'image' | 'video' | 'audio', options: supplied }).options as DynamicValueMap
  const requestId = `developer-test-${input.modelId}-${Date.now()}`
  const startedAt = performance.now()
  const result = await generationService.generate(input.modelId, { ...options, prompt: input.prompt, text: input.prompt }, input.onProgress, { requestId, signal: input.signal })
  return { requestId, elapsedMs: performance.now() - startedAt, urls: result.urls, filePaths: result.filePaths, params: options }
}

export interface LlmTestInput {
  providerId: string
  modelId: string
  system: string
  user: string
  maxOutputTokens?: number
  /** 不填沿用供应商设置里的思考开关 */
  reasoning?: boolean
}

export interface LlmTestResult {
  requestId: string
  elapsedMs: number
  firstTokenMs: number | null
  outputTokensPerSecond: number | null
  inputTokens: number | null
  outputTokens: number | null
}

/** 用户设置里有这家供应商就用它的连接设置（含自定义地址与凭据槽），没有就用 SDK 预设。 */
async function resolveLlmConnection(providerId: string) {
  const config = await llmConfigService.getConfig()
  const provider = config.providers.find((item) => item.providerId === providerId)
  const preset = LLM_PROVIDER_PRESETS.find((item) => item.providerId === providerId)
  if (!provider && !preset) throw new Error('没有这家供应商的连接设置，先在设置里添加')
  return {
    providerFamilyId: provider?.providerFamilyId,
    endpointProfile: provider?.endpointProfile,
    credentialId: provider?.credentialId,
    adapter: provider?.adapter ?? preset!.adapter,
    baseUrl: provider?.baseUrl ?? preset?.baseUrl,
    reasoning: provider?.reasoning ?? preset?.reasoning,
  }
}

export async function runLlmTest(input: LlmTestInput, handlers: {
  signal: AbortSignal
  onToken: (text: string) => void
  onReasoning: (text: string) => void
}): Promise<LlmTestResult> {
  const connection = await resolveLlmConnection(input.providerId)
  const requestId = `developer-test-${input.modelId}-${Date.now()}`
  let trace: LlmTrace | null = null
  const reasoning = input.reasoning === undefined
    ? connection.reasoning
    : { enabled: input.reasoning, effort: connection.reasoning?.effort ?? 'medium' }
  await llmChatStream({
    requestId,
    providerId: input.providerId,
    providerFamilyId: connection.providerFamilyId,
    endpointProfile: connection.endpointProfile,
    credentialId: connection.credentialId,
    modelId: input.modelId,
    adapter: connection.adapter,
    baseUrl: connection.baseUrl,
    reasoning,
    messages: [
      ...(input.system.trim() ? [{ role: 'system' as const, content: input.system }] : []),
      { role: 'user' as const, content: input.user },
    ],
    capabilities: { text: true, streaming: true, reasoning: reasoning?.enabled === true },
    ...(input.maxOutputTokens ? { maxOutputTokens: input.maxOutputTokens } : {}),
    metadata: { source: 'developer-test' },
  }, (event) => {
    if (event.type === 'Token') handlers.onToken(event.data)
    else if (event.type === 'ReasoningToken') handlers.onReasoning(event.data)
    else if (event.type === 'Done') trace = event.data
  }, { category: 'generation', titleKey: 'paidApproval.generateText', signal: handlers.signal })
  const done = trace as LlmTrace | null
  return {
    requestId,
    elapsedMs: done?.elapsedMs ?? 0,
    firstTokenMs: done?.firstTokenMs ?? null,
    outputTokensPerSecond: done?.outputTokensPerSecond ?? null,
    inputTokens: done?.inputTokens ?? null,
    outputTokens: done?.outputTokens ?? null,
  }
}

export interface TextTestResult {
  requestId: string
  elapsedMs: number
  text: string
  /** 识别分段数；翻译时为空 */
  segments?: number
}

/** 主进程那次调用进行中，停止信号要连供应商请求一起取消，不让它跑完计费 */
async function runCancellable<T>(requestId: string, signal: AbortSignal, call: () => Promise<T>): Promise<T> {
  const cancel = (): void => { void getPlatform().developer.cancelTest(requestId) }
  signal.addEventListener('abort', cancel, { once: true })
  try { return await call() } finally { signal.removeEventListener('abort', cancel) }
}

export async function runAsrTest(input: { modelId: string; audioPath: string; language?: string; signal: AbortSignal }): Promise<TextTestResult> {
  const requestId = `developer-test-${input.modelId}-${Date.now()}`
  const result = await withPaidOperation({ category: 'recognition', titleKey: 'paidApproval.recognizeAudio' },
    () => runCancellable(requestId, input.signal, () => getPlatform().developer.runTest({ kind: 'asr', requestId, modelId: input.modelId, audioPath: input.audioPath, language: input.language })), input.signal)
  if (result.kind !== 'asr') throw new Error('识别结果类型不对')
  return { requestId, elapsedMs: result.elapsedMs, text: result.output.text, segments: result.output.segments?.length ?? 0 }
}

export async function runTranslationTest(input: { moduleId: string; text: string; targetLanguage: string; signal: AbortSignal }): Promise<TextTestResult> {
  const requestId = `developer-test-${input.moduleId}-${Date.now()}`
  const result = await withPaidOperation({ category: 'translation' },
    () => runCancellable(requestId, input.signal, () => getPlatform().developer.runTest({ kind: 'translation', requestId, moduleId: input.moduleId, text: input.text, targetLanguage: input.targetLanguage })), input.signal)
  if (result.kind !== 'translation') throw new Error('翻译结果类型不对')
  return { requestId, elapsedMs: result.elapsedMs, text: result.output.translations.map((item) => item.text).join('\n') }
}
