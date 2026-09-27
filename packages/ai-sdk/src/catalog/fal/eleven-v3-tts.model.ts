import { defineModel } from '../defineModel'
import type { JsonObject } from '../../types/runtime'
import { speechCharacterPrice, speechNumber, speechString, speechText } from '../audio/tts-common'

export const falElevenV3TtsModel = defineModel({
  meta: {
    id: 'fal-eleven-v3-tts', canonicalModelId: 'eleven-v3-tts', provider: 'fal', type: 'audio',
    tags: ['text-to-audio', 'provider-fal'],
    polling: { interval: 3000, maxAttempts: 120, expectedAttempts: 20 },
  },
  inputLimits: { images: { max: 0 }, videos: { max: 0 } },
  params: [
    { id: 'falElevenV3Voice', type: 'text', order: 1, default: 'Rachel' },
    { id: 'falElevenV3Stability', type: 'number', order: 2, default: 0.5, min: 0, max: 1, step: 0.05 },
    { id: 'falElevenV3Language', type: 'text', order: 3, default: '' },
  ],
  endpoints: 'fal-ai/elevenlabs/tts/eleven-v3',
  request: {
    builder: (params): JsonObject => {
      const body: JsonObject = {
        text: speechText(params),
        voice: speechString(params.falElevenV3Voice) ?? 'Rachel',
        stability: speechNumber(params.falElevenV3Stability) ?? 0.5,
      }
      const language = speechString(params.falElevenV3Language)
      if (language) body.language_code = language
      return body
    },
  },
  pricing: { currency: '$', calculator: params => speechCharacterPrice(params, 0.1), description: '$0.10/千字符' },
})

export default falElevenV3TtsModel
