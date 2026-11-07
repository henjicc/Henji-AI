import { defineModel } from '../defineModel'
import type { JsonObject } from '../../types/runtime'
import { speechNumber, speechString, speechText } from '../audio/tts-common'

/** 百炼计费字符：汉字（含繁体、日文汉字、韩文汉字）记 2 个，其余字符记 1 个。 */
function billingCharacters(text: string): number {
  return Array.from(text).reduce((sum, char) => sum + (/\p{Script=Han}/u.test(char) ? 2 : 1), 0)
}

export const bailianQwenAudio31TtsPlusModel = defineModel({
  meta: {
    id: 'bailian-qwen-audio-3.1-tts-plus', canonicalModelId: 'qwen-audio-3.1-tts-plus',
    provider: 'bailian', type: 'audio',
    tags: ['text-to-audio'],
  },
  inputLimits: { images: { max: 0 }, videos: { max: 0 } },
  params: [
    { id: 'bailianQwenTtsPlusVoice', type: 'composite', valueType: 'string', order: 1, default: 'longanlingxin_v3.1' },
    { id: 'bailianQwenTtsPlusInstruction', type: 'text', order: 2, default: '' },
    { id: 'bailianQwenTtsPlusSpeed', type: 'number', order: 3, default: 1, min: 0.5, max: 2, step: 0.1 },
  ],
  endpoints: '/api/v1/services/audio/tts/SpeechSynthesizer',
  request: {
    builder: (params): JsonObject => {
      const input: JsonObject = {
        text: speechText(params),
        voice: speechString(params.bailianQwenTtsPlusVoice) ?? 'longanlingxin_v3.1',
        format: 'mp3',
        rate: speechNumber(params.bailianQwenTtsPlusSpeed) ?? 1,
      }
      const instruction = speechString(params.bailianQwenTtsPlusInstruction)
      if (instruction) input.instruction = instruction
      return { model: 'qwen-audio-3.1-tts-plus', input }
    },
  },
  pricing: {
    currency: '¥',
    // 北京地域 ¥1.4/万字符，只按待合成文本计费：https://help.aliyun.com/zh/model-studio/model-pricing
    calculator: params => {
      const text = typeof params.text === 'string' ? params.text : typeof params.prompt === 'string' ? params.prompt : ''
      return billingCharacters(text) * 1.4 / 10_000
    },
    description: '¥1.4/万字符（汉字记 2 个字符，其余记 1 个）；只按待合成文本计费',
  },
})

export default bailianQwenAudio31TtsPlusModel
