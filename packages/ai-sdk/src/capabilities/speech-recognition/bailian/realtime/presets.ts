import { defineSpeechRecognitionDescriptor } from '../..'
import { audioDurationPrice, type CapabilityPricing } from '../../../../pricing/capabilityPricing'
import { QWEN_AUDIO_31_STREAMING_PRICING } from '../pricing'
import type { BailianRealtimeAsrProtocol } from './types'

export interface BailianRealtimeAsrPreset {
  id: string
  modelId: string
  protocol: BailianRealtimeAsrProtocol
  descriptor: ReturnType<typeof defineSpeechRecognitionDescriptor>
}

// 价格为华北2（北京）原价，不含限时免费额度。
const REALTIME_PRICING = audioDurationPrice('CNY', 0.00033)

function definePreset(
  modelId: string,
  protocol: BailianRealtimeAsrProtocol,
  pricing: CapabilityPricing = REALTIME_PRICING
): BailianRealtimeAsrPreset {
  const id = `bailian.speech-recognition.${modelId}`
  return {
    id,
    modelId,
    protocol,
    descriptor: defineSpeechRecognitionDescriptor({
      id,
      source: { kind: 'builtin', namespace: '@henjicc/ai-sdk' },
      providerIds: ['bailian'],
      modelId,
      realtime: true,
      streaming: true,
      mediaTypes: protocol === 'fun-duplex'
        ? ['audio/pcm', 'audio/wav', 'audio/mpeg', 'audio/opus', 'audio/aac', 'audio/amr']
        : ['audio/pcm', 'audio/opus'],
      features: ['realtime', 'streaming', 'partial-results', 'timestamps'],
      tags: ['cloud', protocol],
      pricing,
    }),
  }
}

export const bailianFunAsrRealtime = definePreset(
  'fun-asr-realtime', 'fun-duplex'
)
export const bailianFunAsrRealtime20260228 = definePreset(
  'fun-asr-realtime-2026-02-28',
  'fun-duplex'
)
export const bailianQwen3AsrFlashRealtime = definePreset(
  'qwen3-asr-flash-realtime',
  'qwen-realtime'
)
export const bailianQwen3AsrFlashRealtime20260210 = definePreset(
  'qwen3-asr-flash-realtime-2026-02-10',
  'qwen-realtime'
)

export const bailianQwenAudio31AsrFlashStreaming = definePreset('qwen-audio-3.1-asr-flash-streaming', 'fun-duplex', QWEN_AUDIO_31_STREAMING_PRICING)
export const bailianQwenAudio30AsrFlashStreaming = definePreset('qwen-audio-3.0-asr-flash-streaming', 'fun-duplex')

export const bailianRealtimeAsrPresets = [
  bailianFunAsrRealtime,
  bailianFunAsrRealtime20260228,
  bailianQwen3AsrFlashRealtime,
  bailianQwen3AsrFlashRealtime20260210,
  bailianQwenAudio31AsrFlashStreaming,
  bailianQwenAudio30AsrFlashStreaming,
] as const satisfies readonly BailianRealtimeAsrPreset[]
