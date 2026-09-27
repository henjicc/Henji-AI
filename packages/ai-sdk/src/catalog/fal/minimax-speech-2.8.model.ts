import { defineModel } from '../defineModel'
import type { JsonObject } from '../../types/runtime'
import { speechCharacterPrice, speechNumber, speechString, speechText } from '../audio/tts-common'

export const falMinimaxSpeech28Model = defineModel({
  meta: {
    id: 'fal-minimax-speech-2.8', canonicalModelId: 'minimax-speech-2.8',
    provider: 'fal', type: 'audio',
    tags: ['text-to-audio', 'provider-fal'],
    polling: { interval: 3000, maxAttempts: 120, expectedAttempts: 20 },
  },
  inputLimits: { images: { max: 0 }, videos: { max: 0 } },
  params: [
    { id: 'falMinimaxSpeechSpec', type: 'dropdown', order: 1, default: 'hd', options: [{ value: 'hd' }, { value: 'turbo' }] },
    { id: 'falMinimaxSpeechVoice', type: 'composite', valueType: 'string', order: 2, default: 'Wise_Woman' },
    { id: 'falMinimaxSpeechSpeed', type: 'number', order: 3, default: 1, min: 0.5, max: 2, step: 0.1 },
    { id: 'falMinimaxSpeechEmotion', type: 'dropdown', order: 4, default: '', options: ['', 'happy', 'sad', 'angry', 'fearful', 'disgusted', 'surprised', 'neutral'].map(value => ({ value })) },
  ],
  endpoints: {
    selector: (params) => params.falMinimaxSpeechSpec === 'turbo'
      ? 'fal-ai/minimax/speech-2.8-turbo' : 'fal-ai/minimax/speech-2.8-hd',
  },
  request: {
    builder: (params): JsonObject => {
      const voice: JsonObject = {
        voice_id: speechString(params.falMinimaxSpeechVoice) ?? 'Wise_Woman',
        speed: speechNumber(params.falMinimaxSpeechSpeed) ?? 1,
      }
      const emotion = speechString(params.falMinimaxSpeechEmotion)
      if (emotion) voice.emotion = emotion
      return { prompt: speechText(params), voice_setting: voice, output_format: 'url' }
    },
  },
  pricing: {
    currency: '$',
    calculator: params => speechCharacterPrice(params, params.falMinimaxSpeechSpec === 'turbo' ? 0.06 : 0.1),
    description: 'Fal Speech 2.8 HD $0.10/千字符，Turbo $0.06/千字符',
  },
})

export default falMinimaxSpeech28Model
