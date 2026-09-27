import { defineModel } from '../defineModel'
import type { JsonObject } from '../../types/runtime'
import { speechCharacterPrice, speechNumber, speechString, speechText } from '../audio/tts-common'

export const bailianMinimaxSpeech28Model = defineModel({
  meta: {
    id: 'bailian-minimax-speech-2.8', canonicalModelId: 'minimax-speech-2.8', provider: 'bailian', type: 'audio',
    tags: ['text-to-audio', 'provider-bailian'],
  },
  inputLimits: { images: { max: 0 }, videos: { max: 0 } },
  params: [
    { id: 'bailianMinimaxSpeechSpec', type: 'dropdown', order: 1, default: 'hd', options: [{ value: 'hd' }, { value: 'turbo' }] },
    { id: 'bailianMinimaxSpeechVoice', type: 'text', order: 2, default: 'male-qn-qingse' },
    { id: 'bailianMinimaxSpeechSpeed', type: 'number', order: 3, default: 1, min: 0.5, max: 2, step: 0.1 },
    { id: 'bailianMinimaxSpeechEmotion', type: 'dropdown', order: 4, default: '', options: ['', 'happy', 'sad', 'angry', 'fearful', 'disgusted', 'surprised', 'calm'].map(value => ({ value })) },
  ],
  endpoints: '/api/v1/services/aigc/multimodal-generation/generation',
  request: {
    builder: (params): JsonObject => {
      const spec = params.bailianMinimaxSpeechSpec === 'turbo' ? 'turbo' : 'hd'
      const voiceSetting: JsonObject = {
        voice_id: speechString(params.bailianMinimaxSpeechVoice) ?? 'male-qn-qingse',
        speed: speechNumber(params.bailianMinimaxSpeechSpeed) ?? 1,
      }
      const emotion = speechString(params.bailianMinimaxSpeechEmotion)
      if (emotion) voiceSetting.emotion = emotion
      return {
        model: `MiniMax/speech-2.8-${spec}`,
        input: { text: speechText(params), voice_setting: voiceSetting },
      }
    },
  },
  pricing: {
    currency: '¥',
    calculator: params => speechCharacterPrice(params, params.bailianMinimaxSpeechSpec === 'turbo' ? 0.2 : 0.35),
    description: '百炼 MiniMax 2.8 HD ¥3.5/万字符，Turbo ¥2/万字符',
  },
})

export default bailianMinimaxSpeech28Model
