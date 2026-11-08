import { defineSpeechRecognitionDescriptor } from '..'
import { audioDurationPrice } from '../../../pricing/capabilityPricing'

export interface SiliconFlowAsrPreset {
  id: string
  modelId: 'FunAudioLLM/SenseVoiceSmall'
  descriptor: ReturnType<typeof defineSpeechRecognitionDescriptor>
}

function definePreset(modelId: SiliconFlowAsrPreset['modelId']): SiliconFlowAsrPreset {
  const id = `siliconflow.speech-recognition.${modelId}`
  return {
    id,
    modelId,
    descriptor: defineSpeechRecognitionDescriptor({
      id,
      source: { kind: 'builtin', namespace: '@henjicc/ai-sdk' },
      providerIds: ['siliconflow'],
      modelId,
      mediaTypes: ['audio/*'],
      features: ['file-transcription'],
      tags: ['cloud'],
      // 实名认证账号当前免费。
      pricing: audioDurationPrice('CNY', 0),
    }),
  }
}

export const siliconFlowSenseVoiceSmall = definePreset('FunAudioLLM/SenseVoiceSmall')

export const siliconFlowAsrPresets = [
  siliconFlowSenseVoiceSmall,
] as const satisfies readonly SiliconFlowAsrPreset[]
