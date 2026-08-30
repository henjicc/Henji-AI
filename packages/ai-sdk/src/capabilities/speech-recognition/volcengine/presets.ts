import { defineSpeechRecognitionDescriptor } from '..'

export interface VolcengineAsrPreset {
  id: string
  modelId: 'seedasr-2.0-file'
  descriptor: ReturnType<typeof defineSpeechRecognitionDescriptor>
}

function definePreset(modelId: VolcengineAsrPreset['modelId']): VolcengineAsrPreset {
  const id = `volcengine.speech-recognition.${modelId}`
  return {
    id,
    modelId,
    descriptor: defineSpeechRecognitionDescriptor({
      id,
      source: { kind: 'builtin', namespace: '@henjicc/ai-sdk' },
      providerIds: ['volcengine'],
      modelId,
      mediaTypes: ['audio/*'],
      features: ['file-transcription', 'async-polling', 'remote-url', 'timestamps'],
      tags: ['cloud', 'multilingual', 'seedasr-2.0'],
    }),
  }
}

export const volcengineSeedAsrFile = definePreset('seedasr-2.0-file')

export const volcengineFileAsrPresets = [
  volcengineSeedAsrFile,
] as const satisfies readonly VolcengineAsrPreset[]
