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
