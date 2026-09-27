import { defineModel } from '../defineModel'
import type { JsonObject } from '../../types/runtime'
import { speechCharacterPrice, speechString, speechText } from '../audio/tts-common'

export const siliconflowMossTtsd05Model = defineModel({
  meta: {
    id: 'siliconflow-moss-ttsd-0.5', canonicalModelId: 'moss-ttsd-v0.5', provider: 'siliconflow', type: 'audio',
    tags: ['text-to-audio'],
  },
  inputLimits: { images: { max: 0 }, videos: { max: 0 } },
  params: [
    { id: 'siliconflowMossVoice', type: 'composite', valueType: 'string', order: 1, default: 'fnlp/MOSS-TTSD-v0.5:alex' },
    { id: 'siliconflowMossFormat', type: 'dropdown', order: 2, default: 'mp3', options: ['mp3', 'opus', 'wav', 'pcm'].map(value => ({ value })) },
  ],
  endpoints: '/v1/audio/speech',
  request: {
    builder: (params): JsonObject => {
      const text = speechText(params)
      return {
        model: 'fnlp/MOSS-TTSD-v0.5',
        input: /\[S[12]\]/.test(text) ? text : `[S1]${text}`,
        voice: speechString(params.siliconflowMossVoice) ?? 'fnlp/MOSS-TTSD-v0.5:alex',
        response_format: speechString(params.siliconflowMossFormat) ?? 'mp3',
        stream: false,
      }
    },
  },
  pricing: { currency: '¥', calculator: params => speechCharacterPrice(params, 0.05), description: '¥0.05/千 UTF-8 字符' },
})

export default siliconflowMossTtsd05Model
