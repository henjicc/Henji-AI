import { describe, expect, it } from 'vitest'
import { ttsPresentation } from './tts'
import { TTS_VOICE_SELECTORS } from './ttsVoiceCatalog'

describe('TTS voice selection', () => {
  it('offers the complete official Qwen 3.1 and Seed-TTS 2.0 catalogs', () => {
    const qwen = TTS_VOICE_SELECTORS['bailian-qwen-audio-3.1-tts-flash'].voices
    const volc = TTS_VOICE_SELECTORS['volcengine-seed-tts-2.0'].voices
    expect(qwen).toHaveLength(68)
    expect(volc).toHaveLength(230)
    expect(new Set(qwen.map((voice) => voice.id)).size).toBe(qwen.length)
    expect(new Set(volc.map((voice) => voice.id)).size).toBe(volc.length)
    expect(qwen.some((voice) => voice.id === 'longanhuan_v3.1')).toBe(true)
    expect(volc.some((voice) => voice.id === 'zh_female_vv_uranus_bigtts')).toBe(true)
  })

  it('routes each TTS voice field to the shared selector', () => {
    const fields: Record<string, string> = {
      'fal-minimax-speech-2.8': 'falMinimaxSpeechVoice',
      'fal-eleven-v3-tts': 'falElevenV3Voice',
      'bailian-minimax-speech-2.8': 'bailianMinimaxSpeechVoice',
      'bailian-qwen-audio-3.1-tts-flash': 'bailianQwenTtsVoice',
      'bailian-cosyvoice-v3.5': 'bailianCosyVoiceId',
      'kie-eleven-turbo-2.5-tts': 'kieElevenTurboVoice',
      'kie-eleven-v3-dialogue': 'kieElevenDialogueVoice',
      'kie-gemini-3.1-flash-tts': 'kieGeminiTtsVoice',
      'siliconflow-cosyvoice2-tts': 'siliconflowCosyVoice',
      'siliconflow-moss-ttsd-0.5': 'siliconflowMossVoice',
      'volcengine-seed-tts-2.0': 'volcSeedTtsSpeaker',
      'volcengine-seed-icl-2.0': 'volcSeedIclSpeaker',
    }
    for (const [modelId, fieldId] of Object.entries(fields)) {
      const param = ttsPresentation[modelId]?.params[fieldId]
      expect(param?.panel, modelId).toBe('voice-selector')
      expect(param?.config, modelId).toMatchObject(TTS_VOICE_SELECTORS[modelId])
    }
  })
})
