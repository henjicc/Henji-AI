import { BAILIAN_QWEN_MT_PRESETS } from '@henjicc/ai-sdk/capabilities/translation/bailian'
import { LLM_PROVIDER_PRESETS, estimateChineseTextCost, findLlmProviderPreset, textTokenRatioFor, type LlmTrace, type TokenListPricing } from '@henjicc/ai-sdk'
import { llmChatStream } from '@/commands/llmRuntime'
import { estimateAsrCost } from '@/core/audioEdit/asrCatalog'
import { resolveInputLimits } from '@/core/inputs/inputLimits'
import { convertPriceAmount, readPriceEstimateDisplaySettings } from '@/core/pricing/priceDisplay'
import { readVideoInfo } from '@/commands/video'
import { resolveModeForMedia } from '@/core/inputs/modeForMedia'
import { registry } from '@/core/ModelRegistry'
import type { GenerateResult, ProgressStatus } from '@/core/providers/base/types'
import { generateToCompletion, prepareGenerationTask } from '@/features/generation'
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
  taskId?: string
  /** 供应商返回的原始元数据（实扣费用、用量等从这里读） */
  metadata?: DynamicValueMap
  /** 结果能做的续接（草稿转正片、续写、做成视频）的平台引用 */
  continuations?: GenerateResult['continuations']
}

export async function runGenerationTest(input: {
  modelId: string
  prompt: string
  params: DynamicValueMap
  media: TestMedia
  signal: AbortSignal
  onProgress?: (status: ProgressStatus) => void
  /** 固定请求标识：同一标识重复提交时主进程返回原结果，不会重复计费 */
  requestId?: string
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
  const requestId = input.requestId ?? `developer-test-${input.modelId}-${Date.now()}`
  const startedAt = performance.now()
  const result = await generateToCompletion(input.modelId, { ...options, prompt: input.prompt, text: input.prompt }, input.onProgress, { requestId, signal: input.signal })
  return { requestId, elapsedMs: performance.now() - startedAt, urls: result.urls, filePaths: result.filePaths, params: options, taskId: result.taskId, metadata: result.metadata, continuations: result.continuations }
}

/** 换成人民币给付费策略用；拿不到单价时为 null，付费策略照常询问。 */
function toCny(amount: number, currency: 'CNY' | 'USD'): number {
  return convertPriceAmount(amount, currency, 'CNY', readPriceEstimateDisplaySettings().usdToCnyRate)
}

/** 按登记的单价估一段文字调用：输入、输出都按汉字折 token（翻译的译文长度按字数估）。 */
function estimateTextCallCny(pricing: TokenListPricing | undefined, modelId: string, inputChars: number, outputChars: number): number | null {
  if (!pricing) return null
  return toCny(estimateChineseTextCost(pricing, textTokenRatioFor(modelId), { input: inputChars, output: outputChars }), pricing.currency)
}

/**
 * 大语言模型调用的上限：输入按汉字折 token，输出按请求里实际带上的 token 上限算（不再折算）。
 * 开思考时不估：有的供应商思考长度不受输出上限约束，估出来会偏低，交给付费策略询问。
 */
function estimateLlmCallCny(pricing: TokenListPricing | undefined, modelId: string, inputChars: number, maxOutputTokens: number, reasoning: boolean): number | null {
  if (!pricing || reasoning) return null
  const input = inputChars * textTokenRatioFor(modelId).tokensPerChineseChar * pricing.inputPerMillionTokens
  return toCny((input + maxOutputTokens * pricing.outputPerMillionTokens) / 1_000_000, pricing.currency)
}

/** 没指定输出上限时请求也带上这个上限，估价才真是上限；测试台的提问都很短。 */
const DEFAULT_TEST_OUTPUT_TOKENS = 4096

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
  const maxOutputTokens = input.maxOutputTokens ?? DEFAULT_TEST_OUTPUT_TOKENS
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
    maxOutputTokens,
    metadata: { source: 'developer-test' },
  }, (event) => {
    if (event.type === 'Token') handlers.onToken(event.data)
    else if (event.type === 'ReasoningToken') handlers.onReasoning(event.data)
    else if (event.type === 'Done') trace = event.data
  }, {
    category: 'generation', titleKey: 'paidApproval.generateText', signal: handlers.signal,
    estimatedCny: estimateLlmCallCny(findLlmProviderPreset(input.providerId)?.modelPricing?.[input.modelId], input.modelId,
      input.system.length + input.user.length, maxOutputTokens, reasoning?.enabled === true),
  })
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
  const durationSeconds = await readVideoInfo(input.audioPath).then((info) => info.durationSeconds).catch(() => 0)
  const cost = estimateAsrCost(input.modelId, durationSeconds * 1000)
  const estimatedCny = cost.status === 'estimated' ? toCny(cost.amount, cost.currency) : null
  const result = await withPaidOperation({ category: 'recognition', titleKey: 'paidApproval.recognizeAudio', estimatedCny },
    () => runCancellable(requestId, input.signal, () => getPlatform().developer.runTest({ kind: 'asr', requestId, modelId: input.modelId, audioPath: input.audioPath, language: input.language })), input.signal)
  if (result.kind !== 'asr') throw new Error('识别结果类型不对')
  return { requestId, elapsedMs: result.elapsedMs, text: result.output.text, segments: result.output.segments?.length ?? 0 }
}

export async function runTranslationTest(input: { moduleId: string; text: string; targetLanguage: string; signal: AbortSignal }): Promise<TextTestResult> {
  const requestId = `developer-test-${input.moduleId}-${Date.now()}`
  const preset = Object.values(BAILIAN_QWEN_MT_PRESETS).find((item) => item.moduleId === input.moduleId)
  // 译文长度按原文两倍估，中译英往往更长。
  const estimatedCny = estimateTextCallCny(preset?.pricing, preset?.modelId ?? input.moduleId, input.text.length, input.text.length * 2)
  const result = await withPaidOperation({ category: 'translation', estimatedCny },
    () => runCancellable(requestId, input.signal, () => getPlatform().developer.runTest({ kind: 'translation', requestId, moduleId: input.moduleId, text: input.text, targetLanguage: input.targetLanguage })), input.signal)
  if (result.kind !== 'translation') throw new Error('翻译结果类型不对')
  return { requestId, elapsedMs: result.elapsedMs, text: result.output.translations.map((item) => item.text).join('\n') }
}
