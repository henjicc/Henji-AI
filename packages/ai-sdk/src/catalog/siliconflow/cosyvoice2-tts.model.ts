import { defineModel } from '../defineModel'
import type { JsonObject } from '../../types/runtime'
import { speechCharacterPrice, speechNumber, speechString, speechText } from '../audio/tts-common'

export const siliconflowCosyVoice2TtsModel = defineModel({
  meta: {
    id: 'siliconflow-cosyvoice2-tts', canonicalModelId: 'cosyvoice2-0.5b', provider: 'siliconflow', type: 'audio',
    tags: ['text-to-audio'],
  },
  inputLimits: { images: { max: 0 }, videos: { max: 0 } },
  params: [
    { id: 'siliconflowCosyVoice', type: 'composite', valueType: 'string', order: 1, default: 'FunAudioLLM/CosyVoice2-0.5B:alex' },
    { id: 'siliconflowCosySpeed', type: 'number', order: 2, default: 1, min: 0.25, max: 4, step: 0.05 },
    { id: 'siliconflowCosyFormat', type: 'dropdown', order: 3, default: 'mp3', options: ['mp3', 'opus', 'wav', 'pcm'].map(value => ({ value })) },
  ],
  endpoints: '/v1/audio/speech',
  request: {
    builder: (params): JsonObject => ({
      model: 'FunAudioLLM/CosyVoice2-0.5B',
      input: speechText(params),
      voice: speechString(params.siliconflowCosyVoice) ?? 'FunAudioLLM/CosyVoice2-0.5B:alex',
      response_format: speechString(params.siliconflowCosyFormat) ?? 'mp3',
      speed: speechNumber(params.siliconflowCosySpeed) ?? 1,
      stream: false,
    }),
  },
  pricing: { currency: '¥', calculator: params => speechCharacterPrice(params, 0.05), description: '¥0.05/千 UTF-8 字符' },
})

export default siliconflowCosyVoice2TtsModel
