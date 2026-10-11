import { defineModel } from '../defineModel'
import type { JsonObject } from '../../types/runtime'
import { speechNumber, speechString, speechText } from '../audio/tts-common'

export const bailianQwenAudio31TtsFlashModel = defineModel({
  meta: {
    id: 'bailian-qwen-audio-3.1-tts-flash', canonicalModelId: 'qwen-audio-3.1-tts-flash',
    provider: 'bailian', type: 'audio',
    tags: ['text-to-audio', 'provider-bailian'],
  },
  inputLimits: { images: { max: 0 }, videos: { max: 0 } },
  params: [
    { id: 'bailianQwenTtsVoice', type: 'composite', valueType: 'string', order: 1, default: 'longanhuan_v3.1' },
    { id: 'bailianQwenTtsInstruction', type: 'text', order: 2, default: '' },
    { id: 'bailianQwenTtsSpeed', type: 'number', order: 3, default: 1, min: 0.5, max: 2, step: 0.1 },
  ],
  endpoints: '/api/v1/services/audio/tts/SpeechSynthesizer',
  request: {
    builder: (params): JsonObject => {
      const input: JsonObject = {
        text: speechText(params),
        voice: speechString(params.bailianQwenTtsVoice) ?? 'longanhuan_v3.1',
        format: 'mp3',
        rate: speechNumber(params.bailianQwenTtsSpeed) ?? 1,
      }
      const instruction = speechString(params.bailianQwenTtsInstruction)
      if (instruction) input.instruction = instruction
      return { model: 'qwen-audio-3.1-tts-flash', input }
    },
  },
  pricing: {
    estimateKind: 'upper-bound',
    currency: '¥', calculator: params => {
      const text = typeof params.text === 'string' ? params.text : typeof params.prompt === 'string' ? params.prompt : ''
      const instruction = speechString(params.bailianQwenTtsInstruction) ?? ''
      const speed = Math.min(2, Math.max(0.5, speechNumber(params.bailianQwenTtsSpeed) ?? 1))
      // 公开文档/模型卡片未提供输入上限或音频 Token/秒。按当前输入全文作预算，
      // 采用慢速 1 字/秒、每音频秒 100 Token 的保守工程假设，不冒充官方折算。
      const characters = Array.from(text).length
      const inputTokens = new TextEncoder().encode(text + instruction).length
      const outputTokens = Math.ceil(characters / speed) * 100
      return (inputTokens * 1.5 + outputTokens * 12) / 1_000_000
    },
    description: '估算上限（非账单保证）：输入 ¥1.5/百万 Token、输出 ¥12/百万 Token。官方未公布文本上限及音频折算；按当前全文、慢速每秒1字÷语速、每秒100音频Token及UTF-8字节作为输入Token预算。实际按供应商用量结算。',
  },
})

export default bailianQwenAudio31TtsFlashModel
