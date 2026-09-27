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
    currency: '¥', calculator: () => Number.NaN,
    description: '输入 ¥1.5/百万 Token、输出 ¥12/百万 Token；输出 Token 无法在提交前准确估算',
  },
})

export default bailianQwenAudio31TtsFlashModel
