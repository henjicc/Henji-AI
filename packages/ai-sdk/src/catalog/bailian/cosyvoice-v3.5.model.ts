import { defineModel } from '../defineModel'
import type { JsonObject } from '../../types/runtime'
import { speechCharacterPrice, speechNumber, speechString, speechText } from '../audio/tts-common'

export const bailianCosyVoice35Model = defineModel({
  meta: {
    id: 'bailian-cosyvoice-v3.5', canonicalModelId: 'cosyvoice-v3.5', provider: 'bailian', type: 'audio',
    tags: ['text-to-audio', 'provider-bailian'],
  },
  inputLimits: { images: { max: 0 }, videos: { max: 0 } },
  params: [
    { id: 'bailianCosyVoiceSpec', type: 'dropdown', order: 1, default: 'flash', options: [{ value: 'flash' }, { value: 'plus' }] },
    { id: 'bailianCosyVoiceId', type: 'text', order: 2, required: true, default: '' },
    { id: 'bailianCosyVoiceInstruction', type: 'text', order: 3, default: '' },
    { id: 'bailianCosyVoiceSpeed', type: 'number', order: 4, default: 1, min: 0.5, max: 2, step: 0.1 },
  ],
  endpoints: '/api/v1/services/audio/tts/SpeechSynthesizer',
  request: {
    builder: (params): JsonObject => {
      const voice = speechString(params.bailianCosyVoiceId)
      if (!voice) throw new Error('CosyVoice 3.5 需要事先创建的声音复刻或设计音色 ID')
      const input: JsonObject = {
        text: speechText(params), voice, format: 'mp3',
        rate: speechNumber(params.bailianCosyVoiceSpeed) ?? 1,
      }
      const instruction = speechString(params.bailianCosyVoiceInstruction)
      if (instruction) input.instruction = instruction
      return {
        model: params.bailianCosyVoiceSpec === 'plus' ? 'cosyvoice-v3.5-plus' : 'cosyvoice-v3.5-flash',
        input,
      }
    },
  },
  pricing: {
    currency: '¥',
    calculator: params => speechCharacterPrice(params, params.bailianCosyVoiceSpec === 'plus' ? 0.15 : 0.08),
    description: 'CosyVoice 3.5 Flash ¥0.8/万字符，Plus ¥1.5/万字符；须先取得自定义音色 ID',
  },
})

export default bailianCosyVoice35Model
