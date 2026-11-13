import { defineModel } from '../defineModel'
import type { JsonObject } from '../../types/runtime'
import { speechString } from '../audio/tts-common'

/** 官方单次上限按计费字符算：汉字算 2 个，英文字母、数字、空格等其他字符算 1 个。 */
const MAX_BILLING_CHARACTERS = 10_000
// 刊例价 3 元/万计费字符；官方限时 5 折（1.5 元），估价按刊例价，实际扣费以账单为准。
const LIST_PRICE_PER_10K = 3

export function deepseekTtsBillingCharacters(text: string): number {
  let count = 0
  for (const character of text) count += /\p{Script=Han}/u.test(character) ? 2 : 1
  return count
}

function ttsText(params: JsonObject): string {
  const value = typeof params.text === 'string' ? params.text : params.prompt
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error('语音合成需要非空文本')
  const characters = deepseekTtsBillingCharacters(value)
  if (characters > MAX_BILLING_CHARACTERS) {
    throw new Error(`DeepSeek 语音合成单次最多 ${MAX_BILLING_CHARACTERS} 个计费字符（汉字算 2 个），当前 ${characters} 个，请分段生成`)
  }
  return value
}

export const deepseekTtsModel = defineModel({
  meta: {
    id: 'deepseek-tts', canonicalModelId: 'deepseek-tts', provider: 'deepseek', type: 'audio',
    tags: ['text-to-audio'],
  },
  inputLimits: { images: { max: 0 }, videos: { max: 0 } },
  params: [
    { id: 'deepseekTtsVoice', type: 'composite', valueType: 'string', order: 1, default: 'stella' },
  ],
  // 整段合成：响应体边合成边流式返回 WAV；输出格式与去除 Markdown 用官方默认（wav、去除），不展示不发送。
  endpoints: '/v1/tools/tts',
  request: {
    builder: (params): JsonObject => ({
      text: ttsText(params),
      voice_id: speechString(params.deepseekTtsVoice) === 'tide' ? 'tide' : 'stella',
    }),
  },
  pricing: {
    currency: '¥',
    calculator: params => {
      const value = typeof params.text === 'string' ? params.text : params.prompt
      return typeof value === 'string' ? deepseekTtsBillingCharacters(value) * LIST_PRICE_PER_10K / 10_000 : 0
    },
    description: '¥3/万计费字符（汉字算 2 个），官方限时 5 折，按刊例价估算',
  },
})

export default deepseekTtsModel
