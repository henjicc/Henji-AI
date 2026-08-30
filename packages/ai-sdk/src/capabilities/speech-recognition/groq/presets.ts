import { defineSpeechRecognitionDescriptor } from '..'

export interface GroqAsrPreset {
  id: string
  modelId: 'whisper-large-v3-turbo' | 'whisper-large-v3'
  descriptor: ReturnType<typeof defineSpeechRecognitionDescriptor>
}

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
    }),
  }
}

export const groqWhisperLargeV3Turbo = definePreset('whisper-large-v3-turbo')
export const groqWhisperLargeV3 = definePreset('whisper-large-v3')

export const groqAsrPresets = [
  groqWhisperLargeV3Turbo,
  groqWhisperLargeV3,
] as const satisfies readonly GroqAsrPreset[]
