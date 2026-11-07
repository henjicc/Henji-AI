import { defineModel } from '../defineModel'
import type { JsonObject } from '../../types/runtime'
import { speechCharacterPrice, speechString, speechText } from '../audio/tts-common'

// 字段、音色与价格来源：docs/model-adaptation/Orpheus-Arabic-Saudi/Orpheus-Arabic-Saudi_Groq.md（2026-11-07 读取）。
// Orpheus 只输出 wav，且单次输入最多 200 字符；阿拉伯语版不支持方括号语气指令。
const ORPHEUS_ARABIC_VOICES = ['abdullah', 'fahad', 'sultan', 'lulwa', 'noura', 'aisha'] as const

export const groqOrpheusArabicSaudiModel = defineModel({
  meta: {
    id: 'groq-orpheus-arabic-saudi', canonicalModelId: 'orpheus-arabic-saudi', provider: 'groq', type: 'audio',
    tags: ['text-to-audio'],
  },
  inputLimits: { images: { max: 0 }, videos: { max: 0 } },
  params: [
    { id: 'groqOrpheusArabicVoice', type: 'composite', valueType: 'string', order: 1, default: 'fahad' },
  ],
  endpoints: '/v1/audio/speech',
  request: {
    builder: (params): JsonObject => {
      const voice = speechString(params.groqOrpheusArabicVoice) ?? 'fahad'
      if (!(ORPHEUS_ARABIC_VOICES as readonly string[]).includes(voice)) throw new Error(`Orpheus Arabic Saudi 不支持音色 ${voice}`)
      return { model: 'canopylabs/orpheus-arabic-saudi', input: speechText(params, 200), voice, response_format: 'wav' }
    },
  },
  pricing: { currency: '$', calculator: params => speechCharacterPrice(params, 0.04), description: '$40/百万字符' },
})

export default groqOrpheusArabicSaudiModel
