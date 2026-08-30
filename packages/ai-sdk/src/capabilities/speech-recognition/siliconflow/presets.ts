import { defineSpeechRecognitionDescriptor } from '..'

export interface SiliconFlowAsrPreset {
  id: string
  modelId: 'FunAudioLLM/SenseVoiceSmall' | 'TeleAI/TeleSpeechASR'
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
    }),
  }
}

export const siliconFlowSenseVoiceSmall = definePreset('FunAudioLLM/SenseVoiceSmall')
export const siliconFlowTeleSpeechAsr = definePreset('TeleAI/TeleSpeechASR')

export const siliconFlowAsrPresets = [
  siliconFlowSenseVoiceSmall,
  siliconFlowTeleSpeechAsr,
] as const satisfies readonly SiliconFlowAsrPreset[]
