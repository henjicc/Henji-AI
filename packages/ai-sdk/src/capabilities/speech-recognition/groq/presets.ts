import { defineSpeechRecognitionDescriptor } from '..'
import { audioDurationPrice } from '../../../pricing/capabilityPricing'

export interface GroqAsrPreset {
  id: string
  modelId: 'whisper-large-v3-turbo' | 'whisper-large-v3'
  descriptor: ReturnType<typeof defineSpeechRecognitionDescriptor>
}

// 官方按小时标价，每次请求最少按 10 秒计费。
const HOURLY_USD: Record<GroqAsrPreset['modelId'], number> = { 'whisper-large-v3-turbo': 0.04, 'whisper-large-v3': 0.111 }

function definePreset(modelId: GroqAsrPreset['modelId']): GroqAsrPreset {
  const id = `groq.speech-recognition.${modelId}`
  return {
    id,
    modelId,
    descriptor: defineSpeechRecognitionDescriptor({
      id,
      source: { kind: 'builtin', namespace: '@henjicc/ai-sdk' },
      providerIds: ['groq'],
      modelId,
      mediaTypes: ['audio/*', 'video/*'],
      features: ['file-transcription', 'timestamps', 'remote-url'],
      tags: ['cloud', 'multilingual', 'whisper'],
      pricing: audioDurationPrice('USD', HOURLY_USD[modelId] / 3600, 10),
    }),
  }
}

export const groqWhisperLargeV3Turbo = definePreset('whisper-large-v3-turbo')
export const groqWhisperLargeV3 = definePreset('whisper-large-v3')

export const groqAsrPresets = [
  groqWhisperLargeV3Turbo,
  groqWhisperLargeV3,
] as const satisfies readonly GroqAsrPreset[]
