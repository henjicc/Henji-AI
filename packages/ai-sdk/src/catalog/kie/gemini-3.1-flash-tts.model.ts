import { defineModel } from '../defineModel'
import type { JsonObject } from '../../types/runtime'
import { speechNumber, speechString, speechText } from '../audio/tts-common'

export const kieGemini31FlashTtsModel = defineModel({
  meta: {
    id: 'kie-gemini-3.1-flash-tts', canonicalModelId: 'gemini-3.1-flash-tts', provider: 'kie', type: 'audio',
    tags: ['text-to-audio', 'provider-kie'],
    polling: { interval: 3000, maxAttempts: 120, expectedAttempts: 20 },
  },
  inputLimits: { images: { max: 0 }, videos: { max: 0 } },
  params: [
    { id: 'kieGeminiTtsVoice', type: 'composite', valueType: 'string', order: 1, default: 'Fenrir' },
    { id: 'kieGeminiTtsScene', type: 'text', order: 2, default: '' },
    { id: 'kieGeminiTtsTemperature', type: 'number', order: 3, default: 1, min: 0, max: 2, step: 0.1 },
  ],
  endpoints: '/api/v1/jobs/createTask',
  request: {
    builder: (params): JsonObject => {
      const speakers = Array.isArray(params.kieGeminiTtsSpeakers) && params.kieGeminiTtsSpeakers.length > 0
        ? params.kieGeminiTtsSpeakers
        : [{ speaker_id: 'Speaker 1', voice_name: speechString(params.kieGeminiTtsVoice) ?? 'Fenrir' }]
      const dialogueTurns = Array.isArray(params.kieGeminiTtsDialogueTurns) && params.kieGeminiTtsDialogueTurns.length > 0
        ? params.kieGeminiTtsDialogueTurns
        : [{ speaker_id: 'Speaker 1', text: speechText(params) }]
      const input: JsonObject = {
        speakers,
        dialogue_turns: dialogueTurns,
        temperature: speechNumber(params.kieGeminiTtsTemperature) ?? 1,
      }
      const scene = speechString(params.kieGeminiTtsScene)
      if (scene) input.scene = scene
      return { model: 'google/gemini-3-1-flash-tts', input }
    },
  },
  pricing: {
    currency: '$', billingMode: 'estimated',
    // 按 Google 同名模型的完整输入/输出 token 窗口预留，避免把语速猜测当硬上限。
    calculator: () => (8192 * 0.7 + 16384 * 14) / 1_000_000,
    description: '上限估价 $0.2351：按输入8192、输出16384 Token预留；KIE费率$0.7/$14每百万Token。依据Google同名模型窗口，实际以KIE账单为准。',
  },
})

export default kieGemini31FlashTtsModel
