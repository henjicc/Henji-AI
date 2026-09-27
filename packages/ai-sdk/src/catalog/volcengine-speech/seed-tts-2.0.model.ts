import { defineModel } from '../defineModel'
import type { JsonObject } from '../../types/runtime'
import { speechString, speechText } from '../audio/tts-common'

export const volcengineSeedTts20Model = defineModel({
  meta: {
    id: 'volcengine-seed-tts-2.0', canonicalModelId: 'seed-tts-2.0', provider: 'volcengine-speech', type: 'audio',
    tags: ['text-to-audio', 'provider-volcengine'],
  },
  inputLimits: { images: { max: 0 }, videos: { max: 0 } },
  params: [
    { id: 'volcSeedTtsSpeaker', type: 'composite', valueType: 'string', order: 1, default: 'zh_female_vv_uranus_bigtts' },
  ],
  endpoints: '/api/v3/tts/unidirectional',
  request: {
    builder: (params): JsonObject => ({
      resource_id: 'seed-tts-2.0',
      req_params: {
        text: speechText(params),
        speaker: speechString(params.volcSeedTtsSpeaker) ?? 'zh_female_vv_uranus_bigtts',
        audio_params: { format: 'mp3', sample_rate: 24000 },
      },
    }),
  },
  pricing: { currency: '¥', calculator: () => Number.NaN, description: '火山语音按量计费单价未核实；不显示费用预估' },
})

export default volcengineSeedTts20Model
