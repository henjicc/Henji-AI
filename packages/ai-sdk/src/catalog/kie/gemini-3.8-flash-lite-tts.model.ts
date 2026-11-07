import { defineModel } from '../defineModel'
import { gemini38TtsDefinition } from './gemini38Tts'

export const kieGemini38FlashLiteTtsModel = defineModel({
  meta: {
    id: 'kie-gemini-3.8-flash-lite-tts', canonicalModelId: 'gemini-3.8-flash-lite-tts', provider: 'kie', type: 'audio',
    tags: ['text-to-audio'],
    polling: { interval: 3000, maxAttempts: 120, expectedAttempts: 20 },
  },
  ...gemini38TtsDefinition('google/gemini-3-8-flash-lite-tts', 4.2, 'Flash-Lite'),
})

export default kieGemini38FlashLiteTtsModel
