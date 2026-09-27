import { defineModel } from '../defineModel'
import type { JsonObject } from '../../types/runtime'
import { speechString, speechText } from '../audio/tts-common'

function dialogueFrom(params: JsonObject): JsonObject[] {
  if (Array.isArray(params.kieElevenDialogue)) {
    const items = params.kieElevenDialogue.filter((item): item is JsonObject => {
      return typeof item === 'object' && item !== null && !Array.isArray(item)
        && typeof item.text === 'string' && item.text.trim().length > 0
        && typeof item.voice === 'string' && item.voice.trim().length > 0
    })
    if (items.length > 0) return items
  }
  return [{ text: speechText(params), voice: speechString(params.kieElevenDialogueVoice) ?? 'EkK5I93UQWFDigLMpZcX' }]
}

export const kieElevenV3DialogueModel = defineModel({
  meta: {
    id: 'kie-eleven-v3-dialogue', canonicalModelId: 'eleven-v3-dialogue', provider: 'kie', type: 'audio',
    tags: ['text-to-audio', 'provider-kie'],
    polling: { interval: 3000, maxAttempts: 120, expectedAttempts: 20 },
  },
  inputLimits: { images: { max: 0 }, videos: { max: 0 } },
  params: [
    { id: 'kieElevenDialogueVoice', type: 'composite', valueType: 'string', order: 1, default: 'EkK5I93UQWFDigLMpZcX' },
  ],
  endpoints: '/api/v1/jobs/createTask',
  request: {
    builder: (params): JsonObject => ({
      model: 'elevenlabs/text-to-dialogue-v3',
      input: { dialogue: dialogueFrom(params) },
    }),
  },
  pricing: {
    currency: '$',
    calculator: params => {
      const dialogue = Array.isArray(params.kieElevenDialogue)
        ? params.kieElevenDialogue.filter((item): item is JsonObject => typeof item === 'object' && item !== null && !Array.isArray(item))
        : []
      const total = dialogue.length > 0
        ? dialogue.reduce((sum, item) => sum + (typeof item.text === 'string' ? Array.from(item.text).length : 0), 0)
        : Array.from(typeof params.text === 'string' ? params.text : typeof params.prompt === 'string' ? params.prompt : '').length
      return total * 0.07 / 1000
    },
    description: '$0.07/千字符',
  },
})

export default kieElevenV3DialogueModel
