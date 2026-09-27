import { defineModel } from '../defineModel'
import type { JsonObject } from '../../types/runtime'
import { speechCharacterPrice, speechNumber, speechString, speechText } from '../audio/tts-common'

export const kieElevenTurbo25TtsModel = defineModel({
  meta: {
    id: 'kie-eleven-turbo-2.5-tts', canonicalModelId: 'eleven-turbo-2.5-tts', provider: 'kie', type: 'audio',
    tags: ['text-to-audio', 'provider-kie'],
    polling: { interval: 3000, maxAttempts: 120, expectedAttempts: 20 },
  },
  inputLimits: { images: { max: 0 }, videos: { max: 0 } },
  params: [
    { id: 'kieElevenTurboVoice', type: 'text', order: 1, default: 'Rachel' },
    { id: 'kieElevenTurboStability', type: 'number', order: 2, default: 0.5, min: 0, max: 1, step: 0.05 },
    { id: 'kieElevenTurboSpeed', type: 'number', order: 3, default: 1, min: 0.7, max: 1.2, step: 0.05 },
  ],
  endpoints: '/api/v1/jobs/createTask',
  request: {
    builder: (params): JsonObject => ({
      model: 'elevenlabs/text-to-speech-turbo-2-5',
      input: {
        text: speechText(params),
        voice: speechString(params.kieElevenTurboVoice) ?? 'Rachel',
        stability: speechNumber(params.kieElevenTurboStability) ?? 0.5,
        speed: speechNumber(params.kieElevenTurboSpeed) ?? 1,
      },
    }),
  },
  pricing: { currency: '$', calculator: params => speechCharacterPrice(params, 0.03), description: '$0.03/千字符' },
})

export default kieElevenTurbo25TtsModel
