import { defineModel } from '../defineModel'
import type { JsonObject } from '../../types/runtime'
import { speechCharacterPrice, speechString, speechText } from '../audio/tts-common'

// 字段、音色与价格来源：docs/model-adaptation/Orpheus-V1-English/Orpheus-V1-English_Groq.md（2026-11-07 读取）。
// Orpheus 只输出 wav，且单次输入最多 200 字符；方括号语气指令写在文本里，不是独立参数。
const ORPHEUS_ENGLISH_VOICES = ['autumn', 'diana', 'hannah', 'austin', 'daniel', 'troy'] as const

export const groqOrpheusV1EnglishModel = defineModel({
  meta: {
    id: 'groq-orpheus-v1-english', canonicalModelId: 'orpheus-v1-english', provider: 'groq', type: 'audio',
    tags: ['text-to-audio'],
    promptLanguage: 'en',
  },
  inputLimits: { images: { max: 0 }, videos: { max: 0 } },
  params: [
    { id: 'groqOrpheusEnglishVoice', type: 'composite', valueType: 'string', order: 1, default: 'troy' },
  ],
  endpoints: '/v1/audio/speech',
  request: {
    builder: (params): JsonObject => {
      const voice = speechString(params.groqOrpheusEnglishVoice) ?? 'troy'
      if (!(ORPHEUS_ENGLISH_VOICES as readonly string[]).includes(voice)) throw new Error(`Orpheus English 不支持音色 ${voice}`)
      return { model: 'canopylabs/orpheus-v1-english', input: speechText(params, 200), voice, response_format: 'wav' }
    },
  },
  pricing: { currency: '$', calculator: params => speechCharacterPrice(params, 0.022), description: '$22/百万字符' },
})

export default groqOrpheusV1EnglishModel
