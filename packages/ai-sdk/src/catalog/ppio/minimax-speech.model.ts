import { defineModel } from '../defineModel'
import type { JsonValue, JsonObject } from '../../types/runtime'

export const minimaxSpeechModel = defineModel({
  meta: {
    id: 'ppio-minimax-speech',
    canonicalModelId: 'minimax-speech-2.8',
    provider: 'ppio',
    type: 'audio',
    tags: ['audio', 'text-to-speech', 'voice-synthesis', 'voice-cloning', 'provider-ppio'],
    polling: {
      interval: 3000,
      maxAttempts: 120,
      expectedAttempts: 24,
    },
  },
  inputLimits: {
    images: { max: 0 },
    videos: { max: 0 },
  },
  requirements: [],
  params: [
    {
      id: 'minimaxAudioSpec',
      type: 'dropdown',
      order: 5,
      default: 'hd',
      options: [
        { value: 'hd' },
        { value: 'turbo' },
      ],
      apiField: 'spec',
    },
    {
      id: 'minimaxVoiceId',
      type: 'composite',
      valueType: 'string',
      order: 2,
      // 系统音色目录第一项的 voice_id，恰好与展示层的兜底值一致（见
      // src/models/presentation/ppio.ts 里 VOICE_SELECTOR_CONFIG 的注释）。
      default: 'male-qn-qingse',
    },
    {
      id: 'minimaxAudioEmotion',
      type: 'dropdown',
      order: 3,
      default: '',
      options: [
        { value: '' },
        { value: 'happy' },
        { value: 'sad' },
        { value: 'angry' },
        { value: 'fearful' },
        { value: 'disgusted' },
        { value: 'surprised' },
        { value: 'calm' },
        { value: 'fluent' },
        { value: 'whisper' },
      ],
      apiField: 'emotion',
    },
    {
      id: 'minimaxLanguageBoost',
      type: 'dropdown',
      order: 4,
      default: 'auto',
      options: [
        { value: 'auto' },
        { value: 'Chinese' },
        { value: 'Chinese,Yue' },
        { value: 'English' },
        { value: 'Arabic' },
        { value: 'Russian' },
        { value: 'Spanish' },
        { value: 'French' },
        { value: 'Portuguese' },
        { value: 'German' },
        { value: 'Turkish' },
        { value: 'Dutch' },
        { value: 'Ukrainian' },
        { value: 'Vietnamese' },
        { value: 'Indonesian' },
        { value: 'Japanese' },
        { value: 'Italian' },
        { value: 'Korean' },
        { value: 'Thai' },
        { value: 'Polish' },
        { value: 'Romanian' },
        { value: 'Greek' },
        { value: 'Czech' },
        { value: 'Finnish' },
        { value: 'Hindi' },
        { value: 'Bulgarian' },
        { value: 'Danish' },
        { value: 'Hebrew' },
        { value: 'Malay' },
        { value: 'Persian' },
        { value: 'Slovak' },
        { value: 'Swedish' },
        { value: 'Croatian' },
        { value: 'Filipino' },
        { value: 'Hungarian' },
        { value: 'Norwegian' },
        { value: 'Slovenian' },
        { value: 'Catalan' },
        { value: 'Nynorsk' },
        { value: 'Tamil' },
        { value: 'Afrikaans' },
      ],
      apiField: 'language_boost',
    },
    {
      id: 'minimaxAdvancedSettings',
      type: 'composite',
      valueType: 'object',
      order: 6,
      default: {
        audioVol: 1,
        audioPitch: 0,
        audioSpeed: 1,
        audioSampleRate: 32000,
        bitrate: 128000,
        format: 'mp3',
        channel: 2,
        englishNormalization: false,
        continuousSound: false,
      },
    },
    {
      id: 'minimaxVoiceClonePanel',
      type: 'composite',
      valueType: 'object',
      order: 7,
      default: {
        voiceName: '',
        cloneAudioFilePath: '',
        cloneAudioFileName: '',
        promptEnabled: false,
        promptAudioFilePath: '',
        promptAudioFileName: '',
        promptText: '',
        previewText: '',
        previewModel: 'speech-2.8-turbo',
        accuracy: 0.7,
        needNoiseReduction: false,
        needVolumeNormalization: false,
        lastPreviewAudioUrl: '',
        lastPreviewAudioFilePath: '',
      },
    },
  ],
  endpoints: {
    default: '/async/minimax-speech-2.8-hd',
    selector: (params) => {
      const isVoiceCloneRequest = params.minimaxCloneOperation === 'clone' || params.minimaxMode === 'voice-clone'
      if (isVoiceCloneRequest) {
        return '/minimax-voice-cloning'
      }
      const rawSpec = params.minimaxAudioSpec ?? params.spec
      const spec = rawSpec === 'turbo' ? 'turbo' : 'hd'
      return spec === 'turbo'
        ? '/async/minimax-speech-2.8-turbo'
        : '/async/minimax-speech-2.8-hd'
    },
  },
  request: {
    builder: (params) => {
      const isVoiceCloneRequest = params.minimaxCloneOperation === 'clone' || params.minimaxMode === 'voice-clone'

      const pickString = (...values: JsonValue[]): string | undefined => {
        for (const value of values) {
          if (typeof value === 'string' && value.trim().length > 0) {
            return value.trim()
          }
        }
        return undefined
      }

      const pickNumber = (...values: JsonValue[]): number | undefined => {
        for (const value of values) {
          const parsed = typeof value === 'number' ? value : Number(value)
          if (Number.isFinite(parsed)) {
            return parsed
          }
        }
        return undefined
      }

      const pickBoolean = (...values: JsonValue[]): boolean | undefined => {
        for (const value of values) {
          if (typeof value === 'boolean') {
            return value
          }
        }
        return undefined
      }

      const text = typeof params.text === 'string'
        ? params.text
        : (typeof params.prompt === 'string' ? params.prompt : '')

      if (isVoiceCloneRequest) {
        const clonePanel = params.minimaxVoiceClonePanel && typeof params.minimaxVoiceClonePanel === 'object'
          ? (params.minimaxVoiceClonePanel as JsonObject)
          : {}
        const cloneAudioUrl = pickString(
          clonePanel.cloneAudioFilePath,
          params.minimaxCloneAudioFilePath,
          params.minimaxCloneAudioUrl,
          params.audio_url
        )
        if (!cloneAudioUrl) {
          throw new Error('音色克隆需要提供复刻音频')
        }

        const requestData: JsonObject = {
          audio_url: cloneAudioUrl,
        }

        const promptEnabled = pickBoolean(clonePanel.promptEnabled, params.minimaxClonePromptEnabled) === true
        const promptAudioUrl = pickString(
          clonePanel.promptAudioFilePath,
          params.minimaxClonePromptAudioFilePath,
          params.prompt_audio_url
        )
        const promptText = pickString(clonePanel.promptText, params.prompt_text)
        const shouldAttachPrompt = promptEnabled || (promptAudioUrl !== undefined || promptText !== undefined)
        if (shouldAttachPrompt) {
          if (!promptAudioUrl || !promptText) {
            throw new Error('启用音频 Prompt 时，需要同时填写示例音频和对应文本')
          }
          requestData.clone_prompt = {
            prompt_audio_url: promptAudioUrl,
            prompt_text: promptText,
          }
        }

        const accuracy = pickNumber(clonePanel.accuracy, params.accuracy)
        if (accuracy !== undefined) {
          requestData.accuracy = Math.max(0, Math.min(1, accuracy))
        }

        const needNoiseReduction = pickBoolean(
          clonePanel.needNoiseReduction,
          params.minimaxCloneNeedNoiseReduction,
          params.need_noise_reduction
        )
        if (needNoiseReduction !== undefined) {
          requestData.need_noise_reduction = needNoiseReduction
        }
        const needVolumeNormalization = pickBoolean(
          clonePanel.needVolumeNormalization,
          params.minimaxCloneNeedVolumeNormalization,
          params.need_volume_normalization
        )
        if (needVolumeNormalization !== undefined) {
          requestData.need_volume_normalization = needVolumeNormalization
        }

        const previewText = pickString(text, clonePanel.previewText)
        if (previewText) {
          requestData.text = previewText
          const previewModel = pickString(clonePanel.previewModel, params.model)
          if (previewModel) {
            requestData.model = previewModel
          }
        }

        return requestData
      }

      const advanced = params.minimaxAdvancedSettings && typeof params.minimaxAdvancedSettings === 'object'
        ? (params.minimaxAdvancedSettings as JsonObject)
        : {}

      const voiceId = pickString(params.minimaxVoiceId, params.voice_id)
      const audioSpeed = pickNumber(advanced.audioSpeed, params.minimaxAudioSpeed, params.speed)
      const audioVol = pickNumber(advanced.audioVol, params.minimaxAudioVol, params.vol)
      const audioPitch = pickNumber(advanced.audioPitch, params.minimaxAudioPitch, params.pitch)
      const audioEmotion = pickString(params.minimaxAudioEmotion, params.emotion)
      const englishNormalization = pickBoolean(
        advanced.englishNormalization,
        params.minimaxTextNormalization,
        params.english_normalization
      )
      const continuousSound = pickBoolean(
        advanced.continuousSound,
        params.continuous_sound
      )
      const sampleRate = pickNumber(
        advanced.audioSampleRate,
        params.minimaxAudioSampleRate,
        params.audio_sample_rate
      )
      const bitrate = pickNumber(advanced.bitrate, params.minimaxAudioBitrate, params.bitrate)
      const format = pickString(advanced.format, params.minimaxAudioFormat, params.format)
      const channel = pickNumber(advanced.channel, params.minimaxAudioChannel, params.channel)
      const languageBoost = pickString(params.minimaxLanguageBoost, params.language_boost)

      const requestData: JsonObject = {}
      if (text.length > 0) {
        requestData.text = text
      }

      const voiceSetting: JsonObject = {}
      if (voiceId) voiceSetting.voice_id = voiceId
      if (audioSpeed !== undefined) voiceSetting.speed = audioSpeed
      if (audioVol !== undefined) voiceSetting.vol = audioVol
      if (audioPitch !== undefined) voiceSetting.pitch = audioPitch
      if (audioEmotion) voiceSetting.emotion = audioEmotion
      if (englishNormalization !== undefined) {
        voiceSetting.english_normalization = englishNormalization
      }
      if (Object.keys(voiceSetting).length > 0) {
        requestData.voice_setting = voiceSetting
      }

      const audioSetting: JsonObject = {}
      if (sampleRate !== undefined) audioSetting.audio_sample_rate = sampleRate
      if (bitrate !== undefined) audioSetting.bitrate = bitrate
      if (format) audioSetting.format = format
      if (channel !== undefined) audioSetting.channel = channel
      if (Object.keys(audioSetting).length > 0) {
        requestData.audio_setting = audioSetting
      }

      if (languageBoost) {
        requestData.language_boost = languageBoost
      }
      if (continuousSound === true) {
        requestData.continuous_sound = true
      }

      return requestData
    },
  },
  pricing: {
    currency: '¥',
    calculator: (params) => {
      const rawText = typeof params.text === 'string'
        ? params.text
        : (typeof params.prompt === 'string' ? params.prompt : '')
      const text = rawText.trim()

      const isVoiceCloneRequest = params.minimaxCloneOperation === 'clone' || params.minimaxMode === 'voice-clone'
      if (isVoiceCloneRequest) {
        const clonePanel = params.minimaxVoiceClonePanel && typeof params.minimaxVoiceClonePanel === 'object'
          ? (params.minimaxVoiceClonePanel as JsonObject)
          : {}
        const previewText = text.length > 0
          ? text
          : (typeof clonePanel.previewText === 'string' ? clonePanel.previewText.trim() : '')
        let total = 9.9
        if (previewText.length > 0) {
          const previewModel = typeof clonePanel.previewModel === 'string' ? clonePanel.previewModel : ''
          const rate = previewModel.includes('turbo') ? 2.0 : 3.5
          total += Math.max(0.01, (previewText.length / 10000) * rate)
        }
        return total
      }

      if (text.length === 0) {
        return 0
      }
      const rate = params.minimaxAudioSpec === 'turbo' ? 2.0 : 3.5
      const calculated = (text.length / 10000) * rate
      return calculated < 0.01 ? 0.01 : calculated
    },
    description: 'HD ¥3.5000/万字符，Turbo ¥2.0000/万字符；声音克隆 ¥9.9/音色，同时试听按所选试听模型的 HD/Turbo 单价另计',
  },
})

export default minimaxSpeechModel
