import { defineSpeechRecognitionDescriptor } from '../..'
import type { BailianRealtimeAsrProtocol } from './types'

export interface BailianRealtimeAsrPreset {
  id: string
  modelId: string
  protocol: BailianRealtimeAsrProtocol
  descriptor: ReturnType<typeof defineSpeechRecognitionDescriptor>
}

function definePreset(
  modelId: string,
  protocol: BailianRealtimeAsrProtocol
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

export const bailianRealtimeAsrPresets = [
  bailianFunAsrRealtime,
  bailianFunAsrRealtime20260228,
  bailianQwen3AsrFlashRealtime,
  bailianQwen3AsrFlashRealtime20260210,
] as const satisfies readonly BailianRealtimeAsrPreset[]
