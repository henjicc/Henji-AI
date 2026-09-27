import { defineModel } from '../defineModel'
import type { JsonObject } from '../../types/runtime'
import { speechCharacterPrice, speechNumber, speechString, speechText } from '../audio/tts-common'

export const falQwen3Tts17bModel = defineModel({
  meta: {
    id: 'fal-qwen3-tts-1.7b', canonicalModelId: 'qwen3-tts-1.7b', provider: 'fal', type: 'audio',
    tags: ['text-to-audio', 'provider-fal'],
    polling: { interval: 3000, maxAttempts: 120, expectedAttempts: 20 },
  },
  inputLimits: { images: { max: 0 }, videos: { max: 0 } },
  params: [
    { id: 'falQwen3TtsVoice', type: 'dropdown', order: 1, default: 'Vivian', options: ['Vivian', 'Serena', 'Uncle_Fu', 'Dylan', 'Eric', 'Ryan', 'Aiden', 'Ono_Anna', 'Sohee'].map(value => ({ value })) },
    { id: 'falQwen3TtsLanguage', type: 'dropdown', order: 2, default: 'Auto', options: ['Auto', 'English', 'Chinese', 'Spanish', 'French', 'German', 'Italian', 'Japanese', 'Korean', 'Portuguese', 'Russian'].map(value => ({ value })) },
    { id: 'falQwen3TtsStyle', type: 'text', order: 3, default: '' },
    { id: 'falQwen3TtsTemperature', type: 'number', order: 4, default: 0.9, min: 0, max: 2, step: 0.1 },
  ],
  endpoints: 'fal-ai/qwen-3-tts/text-to-speech/1.7b',
  request: {
    builder: (params): JsonObject => {
      const body: JsonObject = {
        text: speechText(params),
        voice: speechString(params.falQwen3TtsVoice) ?? 'Vivian',
        language: speechString(params.falQwen3TtsLanguage) ?? 'Auto',
        temperature: speechNumber(params.falQwen3TtsTemperature) ?? 0.9,
      }
      const style = speechString(params.falQwen3TtsStyle)
      if (style) body.prompt = style
      return body
    },
  },
  pricing: { currency: '$', calculator: params => speechCharacterPrice(params, 0.09), description: '$0.09/千字符' },
})

export default falQwen3Tts17bModel
