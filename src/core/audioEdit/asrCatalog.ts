import {
  bailianNonRealtimeAsrPresets,
  groqWhisperLargeV3,
  groqWhisperLargeV3Turbo,
  siliconFlowSenseVoiceSmall,
  siliconFlowTeleSpeechAsr,
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
  ...[siliconFlowSenseVoiceSmall, siliconFlowTeleSpeechAsr].map((preset): AsrCatalogEntry => ({
    descriptor: preset.descriptor, localAudio: true, wordGranularity: 'word', timestampOptions: {},
  })),
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

/** Host authorization metadata from packages/ai-sdk/docs/model-adaptation (Fun/Qwen3, Groq, SenseVoice).
 * SDK capability descriptors have no pricing field; unknown/token-priced models remain unknown.
 * Beijing is the SDK Bailian module's endpoint. Account free quotas are deliberately not assumed.
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
}
export type AsrCostEstimate = { status: 'estimated'; amount: number; currency: 'CNY' | 'USD' } | { status: 'unknown'; amount: null; currency: null }
export function estimateAsrCost(modelId: string, durationMs: number): AsrCostEstimate {
  const price = asrDurationPrices[modelId]
  if (!price || !Number.isFinite(durationMs) || durationMs <= 0) return { status: 'unknown', amount: null, currency: null }
  return { status: 'estimated', amount: Math.max(durationMs / 1000, price.minimumSeconds ?? 0) * price.perSecond, currency: price.currency }
}
