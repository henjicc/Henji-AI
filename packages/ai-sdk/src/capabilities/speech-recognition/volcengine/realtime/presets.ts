import { defineSpeechRecognitionDescriptor } from '../..'
import { audioDurationPrice } from '../../../../pricing/capabilityPricing'

export interface VolcengineRealtimeAsrPreset {
  id: string
  modelId: 'seedasr-2.0-realtime'
  descriptor: ReturnType<typeof defineSpeechRecognitionDescriptor>
}

function definePreset(modelId: VolcengineRealtimeAsrPreset['modelId']): VolcengineRealtimeAsrPreset {
  const id = `volcengine.speech-recognition.${modelId}`
  return {
    id,
    modelId,
    descriptor: defineSpeechRecognitionDescriptor({
      id,
      source: { kind: 'builtin', namespace: '@henjicc/ai-sdk' },
      providerIds: ['volcengine'],
      modelId,
      realtime: true,
      streaming: true,
      mediaTypes: ['audio/pcm'],
      features: ['realtime', 'streaming', 'partial-results', 'timestamps', 'pcm-s16le-16khz-mono'],
      tags: ['cloud', 'multilingual', 'seedasr-2.0'],
      // 后付费小时版 1 元/小时。
      pricing: audioDurationPrice('CNY', 1 / 3600),
    }),
  }
}

export const volcengineSeedAsrRealtime = definePreset('seedasr-2.0-realtime')

export const volcengineRealtimeAsrPresets = [
  volcengineSeedAsrRealtime,
] as const satisfies readonly VolcengineRealtimeAsrPreset[]
