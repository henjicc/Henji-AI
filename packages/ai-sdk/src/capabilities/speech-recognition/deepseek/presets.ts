import { defineSpeechRecognitionDescriptor } from '..'
import { audioDurationPrice } from '../../../pricing/capabilityPricing'

export interface DeepSeekAsrPreset {
  id: string
  descriptor: ReturnType<typeof defineSpeechRecognitionDescriptor>
}

// 刊例价 0.78 元/小时音频，按秒计、不足 1 秒按 1 秒；官方限时 5 折，估价按刊例价。
const LIST_PRICE_PER_HOUR = 0.78

/** 单次整段识别：16 位 PCM WAV 或 Ogg Opus，最大 8 MiB、最长 120 秒，没有时间戳，语种自动识别。 */
export const deepSeekAsr: DeepSeekAsrPreset = {
  id: 'deepseek.speech-recognition.asr',
  descriptor: defineSpeechRecognitionDescriptor({
    id: 'deepseek.speech-recognition.asr',
    source: { kind: 'builtin', namespace: '@henjicc/ai-sdk' },
    providerIds: ['deepseek'],
    modelId: 'deepseek-asr',
    mediaTypes: ['audio/wav', 'audio/ogg'],
    features: ['file-transcription', 'short-audio'],
    tags: ['cloud', 'multilingual'],
    pricing: audioDurationPrice('CNY', LIST_PRICE_PER_HOUR / 3600, 1),
  }),
}

export const deepSeekAsrPresets = [deepSeekAsr] as const satisfies readonly DeepSeekAsrPreset[]
