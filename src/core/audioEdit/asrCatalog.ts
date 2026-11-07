import {
  bailianNonRealtimeAsrPresets,
  groqWhisperLargeV3,
  groqWhisperLargeV3Turbo,
  siliconFlowSenseVoiceSmall,
  volcengineSeedAsrFile,
  type CapabilityDescriptor,
} from '@henjicc/ai-sdk'

export type AsrWordGranularity = 'word' | 'character'

/** SDK descriptor 是模型事实来源；这里只补宿主已验证的本地媒体准备路径与粒度。 */
export interface AsrCatalogEntry {
  descriptor: CapabilityDescriptor
  localAudio: boolean
  wordGranularity: AsrWordGranularity
  timestampOptions: Readonly<Record<string, unknown>>
}

export const ASR_CATALOG: readonly AsrCatalogEntry[] = [
  ...bailianNonRealtimeAsrPresets.map((preset): AsrCatalogEntry => ({
    descriptor: preset.descriptor,
    localAudio: true,
    wordGranularity: preset.asyncInputField === 'file_url' ? 'character' : 'word',
    timestampOptions: {}, // timestamps:true 由 SDK 转成 Qwen filetrans enable_words。
  })),
  ...[groqWhisperLargeV3Turbo, groqWhisperLargeV3].map((preset): AsrCatalogEntry => ({
    descriptor: preset.descriptor,
    localAudio: true,
    wordGranularity: 'word',
    timestampOptions: { timestampGranularities: ['word', 'segment'] },
  })),
  { descriptor: siliconFlowSenseVoiceSmall.descriptor, localAudio: true, wordGranularity: 'word', timestampOptions: {} },
  { descriptor: volcengineSeedAsrFile.descriptor, localAudio: false, wordGranularity: 'word', timestampOptions: {} },
]

export function isTimestampedLocalAsr(entry: AsrCatalogEntry): boolean {
  return entry.descriptor.kind === 'speech-recognition'
    && entry.descriptor.features?.includes('timestamps') === true
    && !entry.descriptor.executionModes?.includes('realtime')
    && entry.localAudio
}

export function asrProviderId(entry: AsrCatalogEntry): string {
  return entry.descriptor.providerIds?.[0] ?? ''
}

export function listTimestampedLocalAsr(isConfigured: (providerId: string) => boolean): AsrCatalogEntry[] {
  return ASR_CATALOG.filter((entry) => isTimestampedLocalAsr(entry) && isConfigured(asrProviderId(entry)))
}

export function resolveTimestampedLocalAsr(
  isConfigured: (providerId: string) => boolean,
  modelId?: string,
  providerId?: string,
): AsrCatalogEntry {
  const candidates = listTimestampedLocalAsr(isConfigured)
  if (modelId) {
    const selected = candidates.find((entry) => entry.descriptor.id === modelId)
    if (!selected) throw new Error('ASR_MODEL_UNAVAILABLE：默认转写模型不可用，请配置凭据或重新选择。')
    return selected
  }
  const providerCandidates = candidates.filter((entry) => asrProviderId(entry) === providerId)
  const preferred = providerCandidates.length ? providerCandidates : candidates
  const selected = preferred.find((entry) => entry.descriptor.tags?.includes('long-audio')) ?? preferred[0]
  if (!selected) throw new Error('ASR_UNAVAILABLE：请先配置支持带时间转写的供应商。')
  return selected
}

/**
 * Qwen-Audio 3.1 识别按 token 计价（元/百万 tokens），官方没写每秒音频折多少 token，按接口文档的用量示例折算：
 * 2 秒音频输入 85 token（9 秒 365），取偏多的每秒 42.5；输出按每秒 6 个汉字、1 字 1 token（无公布比例时的保守取值）。
 */
function qwenAudioTokenPricePerSecond(inputPerMillion: number, outputPerMillion: number): number {
  return (42.5 * inputPerMillion + 6 * outputPerMillion) / 1_000_000
}

/**
 * 付费授权用的单价，出处见 packages/ai-sdk/docs/model-adaptation 各模型文档；SDK 的能力描述不带价格。
 * 百炼按 SDK 使用的北京地域计价；不计账号免费额度。没有登记的模型估价为未知，提交时照常确认。
 */
const asrDurationPrices: Readonly<Record<string, { currency: 'CNY' | 'USD'; perSecond: number; minimumSeconds?: number }>> = {
  'bailian.speech-recognition.fun-asr': { currency: 'CNY', perSecond: .00022 },
  'bailian.speech-recognition.fun-asr-flash-2026-06-15': { currency: 'CNY', perSecond: .00022 },
  'bailian.speech-recognition.qwen3-asr-flash': { currency: 'CNY', perSecond: .00022 },
  'bailian.speech-recognition.qwen3-asr-flash-2026-02-10': { currency: 'CNY', perSecond: .00022 },
  'bailian.speech-recognition.qwen3-asr-flash-filetrans': { currency: 'CNY', perSecond: .00022 },
  [groqWhisperLargeV3.descriptor.id]: { currency: 'USD', perSecond: .111 / 3600, minimumSeconds: 10 },
  [groqWhisperLargeV3Turbo.descriptor.id]: { currency: 'USD', perSecond: .04 / 3600, minimumSeconds: 10 },
  [siliconFlowSenseVoiceSmall.descriptor.id]: { currency: 'CNY', perSecond: 0 },
  'bailian.speech-recognition.qwen-audio-3.0-asr-flash': { currency: 'CNY', perSecond: .00022 },
  'bailian.speech-recognition.qwen-audio-3.0-asr-flash-filetrans': { currency: 'CNY', perSecond: .00022 },
  'bailian.speech-recognition.qwen-audio-3.0-asr-flash-streaming': { currency: 'CNY', perSecond: .00033 },
  'bailian.speech-recognition.qwen-audio-3.1-asr-flash': { currency: 'CNY', perSecond: qwenAudioTokenPricePerSecond(.8, 2.7) },
  'bailian.speech-recognition.qwen-audio-3.1-asr-flash-filetrans': { currency: 'CNY', perSecond: qwenAudioTokenPricePerSecond(.8, 2.7) },
  'bailian.speech-recognition.qwen-audio-3.1-asr-flash-streaming': { currency: 'CNY', perSecond: qwenAudioTokenPricePerSecond(6, 4.5) },
  'bailian.speech-recognition.fun-asr-realtime': { currency: 'CNY', perSecond: .00033 },
  'bailian.speech-recognition.fun-asr-realtime-2026-02-28': { currency: 'CNY', perSecond: .00033 },
  'bailian.speech-recognition.qwen3-asr-flash-realtime': { currency: 'CNY', perSecond: .00033 },
  'bailian.speech-recognition.qwen3-asr-flash-realtime-2026-02-10': { currency: 'CNY', perSecond: .00033 },
  [volcengineSeedAsrFile.descriptor.id]: { currency: 'CNY', perSecond: .8 / 3600 },
  'volcengine.speech-recognition.seedasr-2.0-realtime': { currency: 'CNY', perSecond: 1 / 3600 },
}
export type AsrCostEstimate = { status: 'estimated'; amount: number; currency: 'CNY' | 'USD' } | { status: 'unknown'; amount: null; currency: null }
export function estimateAsrCost(modelId: string, durationMs: number): AsrCostEstimate {
  const price = asrDurationPrices[modelId]
  if (!price || !Number.isFinite(durationMs) || durationMs <= 0) return { status: 'unknown', amount: null, currency: null }
  return { status: 'estimated', amount: Math.max(durationMs / 1000, price.minimumSeconds ?? 0) * price.perSecond, currency: price.currency }
}
