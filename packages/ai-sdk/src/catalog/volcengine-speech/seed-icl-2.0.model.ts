import { defineModel } from '../defineModel'
import type { JsonObject } from '../../types/runtime'
import { speechString, speechText } from '../audio/tts-common'

export const volcengineSeedIcl20Model = defineModel({
  meta: {
    id: 'volcengine-seed-icl-2.0', canonicalModelId: 'seed-icl-2.0', provider: 'volcengine-speech', type: 'audio',
    tags: ['text-to-audio', 'provider-volcengine'],
  },
  inputLimits: { images: { max: 0 }, videos: { max: 0 } },
  params: [
    { id: 'volcSeedIclSpeaker', type: 'composite', valueType: 'string', required: true, order: 1, default: '' },
  ],
  endpoints: '/api/v3/tts/unidirectional',
  request: {
    builder: (params): JsonObject => {
      const speaker = speechString(params.volcSeedIclSpeaker)
      if (!speaker) throw new Error('Seed-ICL 2.0 需要已创建的复刻音色 ID')
      return {
        resource_id: 'seed-icl-2.0',
        req_params: { text: speechText(params), model: 'seed-tts-2.0-standard', speaker, audio_params: { format: 'mp3', sample_rate: 24000 } },
      }
    },
  },
  pricing: { currency: '¥', calculator: () => Number.NaN, description: '火山语音按量计费单价未核实；不显示费用预估' },
})

export default volcengineSeedIcl20Model
