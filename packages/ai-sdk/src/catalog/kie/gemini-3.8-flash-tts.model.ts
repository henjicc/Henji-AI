import { defineModel } from '../defineModel'
import { gemini38TtsDefinition } from './gemini38Tts'

export const kieGemini38FlashTtsModel = defineModel({
  meta: {
    id: 'kie-gemini-3.8-flash-tts', canonicalModelId: 'gemini-3.8-flash-tts', provider: 'kie', type: 'audio',
    tags: ['text-to-audio'],
    polling: { interval: 3000, maxAttempts: 120, expectedAttempts: 20 },
  },
  ...gemini38TtsDefinition('google/gemini-3-8-flash-tts', 12.6, 'Flash'),
})

export default kieGemini38FlashTtsModel
