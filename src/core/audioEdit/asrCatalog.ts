import {
  bailianNonRealtimeAsrPresets,
  estimateAudioDurationCost,
  groqWhisperLargeV3,
  groqWhisperLargeV3Turbo,
  siliconFlowSenseVoiceSmall,
  volcengineSeedAsrFile,
  type CapabilityDescriptor,
} from '@henjicc/ai-sdk'

export type AsrWordGranularity = 'word' | 'character'

/**
 * 上传给识别服务的音频副本编码（都是 16 kHz 单声道）。本地资料里官方格式表明确列出 ogg/opus 的模型用 Opus，
 * 其余用 16 位 PCM WAV：与此前上传的 WAV 同一容器，SDK 缺省声明的格式也是 wav。
 */
export type AsrUploadEncoding = 'opus' | 'pcm16'

/** 副本每秒的字节数（估算上限）：Opus 按 32 kbit/s 再留一成余量（实测口播约 27 kbit/s），16 位 PCM 单声道 16 kHz 正好 32000。 */
const UPLOAD_BYTES_PER_SECOND: Record<AsrUploadEncoding, number> = { opus: 4_400, pcm16: 32_000 }

/** SDK descriptor 是模型事实来源；这里只补宿主已验证的本地媒体准备路径与粒度。 */
export interface AsrCatalogEntry {
  descriptor: CapabilityDescriptor
  localAudio: boolean
  wordGranularity: AsrWordGranularity
  timestampOptions: Readonly<Record<string, unknown>>
  uploadEncoding: AsrUploadEncoding
  /**
   * 单次上传的大小上限（字节），与 SDK 上传前的硬校验同一数值：发起转写、确认付费之前就按时长估算，
   * 超了直接提示换模型，不让人等副本做完才失败。
   */
  maxUploadBytes: number
}

// 本地资料（packages/ai-sdk/docs/model-adaptation）里官方格式表列出 ogg/opus 的百炼文件转写模型。
// Qwen-Audio 文件转写的资料没有格式表；百炼临时存储的对象名不带扩展名，只能靠内容识别，没有依据的不换格式。
const BAILIAN_OPUS_MODELS = new Set(['fun-asr', 'qwen3-asr-flash-filetrans'])

export const ASR_CATALOG: readonly AsrCatalogEntry[] = [
  ...bailianNonRealtimeAsrPresets.map((preset): AsrCatalogEntry => ({
    descriptor: preset.descriptor,
    localAudio: true,
    wordGranularity: preset.asyncInputField === 'file_url' ? 'character' : 'word',
    timestampOptions: {}, // timestamps:true 由 SDK 转成 Qwen filetrans enable_words。
    uploadEncoding: BAILIAN_OPUS_MODELS.has(preset.modelId) ? 'opus' : 'pcm16',
    // 文件转写走临时存储（单文件 1 GB）；短音频内联，上限是预设登记的原始字节数
    maxUploadBytes: preset.protocol === 'file-async' ? 1_000_000_000 : preset.maxInlineBytes ?? 10_000_000,
  })),
  ...[groqWhisperLargeV3Turbo, groqWhisperLargeV3].map((preset): AsrCatalogEntry => ({
    descriptor: preset.descriptor,
    localAudio: true,
    wordGranularity: 'word',
    timestampOptions: { timestampGranularities: ['word', 'segment'] },
    // 官方格式表含 ogg，服务端本来就下采样到 16 kHz 单声道；附件上限 25 MB，Opus 一小时约 14 MB。
    uploadEncoding: 'opus',
    maxUploadBytes: 25_000_000,
  })),
  // 不带时间戳，口播转写用不上；官方只以 MP3 为示例、没有公开格式白名单，用 WAV；文件上限 50 MB（约 26 分钟）
  { descriptor: siliconFlowSenseVoiceSmall.descriptor, localAudio: true, wordGranularity: 'word', timestampOptions: {}, uploadEncoding: 'pcm16', maxUploadBytes: 50_000_000 },
  { descriptor: volcengineSeedAsrFile.descriptor, localAudio: false, wordGranularity: 'word', timestampOptions: {}, uploadEncoding: 'pcm16', maxUploadBytes: 0 },
]

export function asrUploadEncoding(modelId: string): AsrUploadEncoding {
  return ASR_CATALOG.find((entry) => entry.descriptor.id === modelId)?.uploadEncoding ?? 'pcm16'
}

/**
 * 上传文件超过所选模型的上传上限时，返回给人看的提示；不超时返回 undefined。
 * uploadBytes 是实际要传的文件大小（讲解录音这类现成文件），没有时按时长与副本编码估算。
 */
export function asrUploadLimitProblem(entry: AsrCatalogEntry, durationMs: number, uploadBytes?: number): string | undefined {
  const rate = UPLOAD_BYTES_PER_SECOND[entry.uploadEncoding]
  const bytes = uploadBytes ?? Math.ceil(durationMs / 1000 * rate)
  if (!entry.maxUploadBytes || bytes <= entry.maxUploadBytes) return undefined
  const megabytes = (value: number): string => `${Math.round(value / 1_000_000)} MB`
  return `要上传的音频约 ${megabytes(bytes)}，超过所选识别模型单次 ${megabytes(entry.maxUploadBytes)} 的上限。请在设置里换用百炼 Fun-ASR 这类长音频模型。没有上传，也不收费。`
}

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


export type AsrCostEstimate = { status: 'estimated'; amount: number; currency: 'CNY' | 'USD' } | { status: 'unknown'; amount: null; currency: null }
/** 付费授权用的参考价，单价取 SDK 能力描述；没有登记价格的模型估价为未知，提交时照常确认。 */
export function estimateAsrCost(modelId: string, durationMs: number): AsrCostEstimate {
  const pricing = ASR_CATALOG.find((entry) => entry.descriptor.id === modelId)?.descriptor.pricing
  const estimate = pricing ? estimateAudioDurationCost(pricing, durationMs) : null
  return estimate ? { status: 'estimated', ...estimate } : { status: 'unknown', amount: null, currency: null }
}
