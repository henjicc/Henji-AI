import type { JsonObject } from '../../types/runtime'
import type { ModelRuntimeDefinition } from '../../types/model'
import { speechNumber, speechString, speechText } from '../audio/tts-common'

// KIE 按 Google 官方价七折卖；Google 2026 年内半价促销，2027-01-01 起恢复原价。估价直接用原价，促销期内实际扣费更低。
const INPUT_RATE = 0.7

/** Gemini 3.8 Flash TTS 与 Flash-Lite TTS 请求结构相同，只有模型 ID 与输出单价不同。 */
export function gemini38TtsDefinition(model: string, outputRate: number, name: string): Omit<ModelRuntimeDefinition, 'meta'> {
  // 按 Gemini 3.1 Flash TTS 同样的输入 8192 / 输出 16384 Token 窗口预留上限；KIE 输入单价两档相同。
  const estimate = (8192 * INPUT_RATE + 16384 * outputRate) / 1_000_000
  return {
    inputLimits: { images: { max: 0 }, videos: { max: 0 } },
    params: [
      { id: 'kieGemini38TtsVoice', type: 'composite', valueType: 'string', order: 1, default: 'Fola' },
      { id: 'kieGemini38TtsStyle', type: 'text', order: 2, default: '' },
      { id: 'kieGemini38TtsTemperature', type: 'number', order: 3, default: 1, min: 0, max: 2, step: 0.1 },
    ],
    endpoints: '/api/v1/jobs/createTask',
    request: {
      builder: (params): JsonObject => {
        const speakers = Array.isArray(params.kieGeminiTtsSpeakers) && params.kieGeminiTtsSpeakers.length > 0
          ? params.kieGeminiTtsSpeakers
          : [{ speaker_id: 'Speaker 1', voice_name: speechString(params.kieGemini38TtsVoice) ?? 'Fola' }]
        const style = speechString(params.kieGemini38TtsStyle)
        const turn: JsonObject = { speaker_id: 'Speaker 1', text: speechText(params, 10000) }
        if (style) turn.style = style
        const dialogueTurns = Array.isArray(params.kieGeminiTtsDialogueTurns) && params.kieGeminiTtsDialogueTurns.length > 0
          ? params.kieGeminiTtsDialogueTurns
          : [turn]
        return {
          model,
          input: { speakers, dialogue_turns: dialogueTurns, temperature: speechNumber(params.kieGemini38TtsTemperature) ?? 1 },
        }
      },
    },
    pricing: {
      currency: '$', billingMode: 'estimated',
      calculator: () => estimate,
      description: `上限估价 $${estimate.toFixed(4)}：按输入8192、输出16384 Token预留；KIE ${name} 原价输入$${INPUT_RATE}/输出$${outputRate}每百万Token（2026 年内跟随 Google 促销减半），实际以KIE账单为准。`,
    },
  }
}
