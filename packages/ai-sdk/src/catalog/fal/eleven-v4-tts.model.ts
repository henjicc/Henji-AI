import { defineModel } from '../defineModel'
import type { JsonObject } from '../../types/runtime'
import { speechCharacterPrice, speechNumber, speechString, speechText } from '../audio/tts-common'

// 字段与价格来源：docs/model-adaptation/Eleven-v4/Eleven-v4_Fal.md（Fal 模型页与 OpenAPI，2026-11-07 读取）
const turbo = (params: JsonObject) => params.falElevenV4Version === 'turbo'

export const falElevenV4TtsModel = defineModel({
  meta: {
    id: 'fal-eleven-v4-tts', canonicalModelId: 'eleven-v4-tts', provider: 'fal', type: 'audio',
    tags: ['text-to-audio'],
    polling: { interval: 3000, maxAttempts: 120, expectedAttempts: 20 },
  },
  inputLimits: { images: { max: 0 }, videos: { max: 0 } },
  params: [
    { id: 'falElevenV4Version', type: 'dropdown', order: 1, default: 'standard', options: [{ value: 'standard' }, { value: 'turbo' }] },
    { id: 'falElevenV4Voice', type: 'composite', valueType: 'string', order: 2, default: 'Rachel' },
    { id: 'falElevenV4Stability', type: 'number', order: 3, default: 0.5, min: 0, max: 1, step: 0.05 },
    { id: 'falElevenV4Language', type: 'text', order: 4, default: '' },
  ],
  endpoints: { selector: params => turbo(params) ? 'elevenlabs/tts/eleven-v4-turbo' : 'elevenlabs/tts/eleven-v4' },
  request: {
    builder: (params): JsonObject => {
      const body: JsonObject = {
        text: speechText(params, 5000),
        voice: speechString(params.falElevenV4Voice) ?? 'Rachel',
        stability: speechNumber(params.falElevenV4Stability) ?? 0.5,
      }
      const language = speechString(params.falElevenV4Language)
      if (language) body.language_code = language
      return body
    },
  },
  pricing: {
    currency: '$',
    calculator: params => speechCharacterPrice(params, turbo(params) ? 0.04 : 0.08),
    description: 'v4 $0.08/千字符，v4 Turbo $0.04/千字符',
  },
})

export default falElevenV4TtsModel
