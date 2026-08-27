import { defineSpeechRecognitionDescriptor } from '../..'
import type { BailianRealtimeAsrProtocol } from './types'

export interface BailianRealtimeAsrPreset {
  id: string
  modelId: string
  protocol: BailianRealtimeAsrProtocol
  descriptor: ReturnType<typeof defineSpeechRecognitionDescriptor>
}

function definePreset(
  id: string,
  modelId: string,
  protocol: BailianRealtimeAsrProtocol
): BailianRealtimeAsrPreset {
  return {
    id,
    modelId,
    protocol,
    descriptor: defineSpeechRecognitionDescriptor({
      id,
      providerIds: ['bailian'],
      modelId,
      realtime: true,
      streaming: true,
      mediaTypes: protocol === 'fun-duplex'
        ? ['audio/pcm', 'audio/wav', 'audio/mpeg', 'audio/opus', 'audio/aac', 'audio/amr']
        : ['audio/pcm', 'audio/opus'],
      features: ['realtime', 'streaming', 'partial-results', 'timestamps'],
      tags: ['cloud', protocol],
    }),
  }
}

export const bailianFunAsrRealtime = definePreset(
  'bailian.fun-asr-realtime', 'fun-asr-realtime', 'fun-duplex'
)
export const bailianFunAsrRealtime20260228 = definePreset(
  'bailian.fun-asr-realtime-2026-02-28', 'fun-asr-realtime-2026-02-28', 'fun-duplex'
)
export const bailianQwen3AsrFlashRealtime = definePreset(
  'bailian.qwen3-asr-flash-realtime', 'qwen3-asr-flash-realtime', 'qwen-realtime'
)
export const bailianQwen3AsrFlashRealtime20260210 = definePreset(
  'bailian.qwen3-asr-flash-realtime-2026-02-10',
  'qwen3-asr-flash-realtime-2026-02-10',
  'qwen-realtime'
)

export const bailianRealtimeAsrPresets = [
  bailianFunAsrRealtime,
  bailianFunAsrRealtime20260228,
  bailianQwen3AsrFlashRealtime,
  bailianQwen3AsrFlashRealtime20260210,
] as const satisfies readonly BailianRealtimeAsrPreset[]
