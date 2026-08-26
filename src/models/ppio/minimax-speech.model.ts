import { defineModel, sharedFieldText } from '@/core'
import type { CompositePanelDef } from '@/core/types/ParamDef'
import type { CompositePanelConfig } from '@/core/types/CompositePanel'
import type { VoiceSelectorConfig } from '@/core/types/PanelTypes'
import { buildVoiceFeatureTags } from '@/core/voice/voiceFeatureTags'
import minimaxSpeechVoicesCatalog from './data/minimax-speech-voices.json'

const EMOTION_OPTIONS = [
  { value: '', label: { zh: '自动', en: 'Auto' } },
  { value: 'happy', label: { zh: '开心', en: 'Happy' } },
  { value: 'sad', label: { zh: '悲伤', en: 'Sad' } },
  { value: 'angry', label: { zh: '愤怒', en: 'Angry' } },
  { value: 'fearful', label: { zh: '害怕', en: 'Fearful' } },
  { value: 'disgusted', label: { zh: '厌恶', en: 'Disgusted' } },
  { value: 'surprised', label: { zh: '惊讶', en: 'Surprised' } },
  { value: 'calm', label: { zh: '中性', en: 'Calm' } },
  { value: 'fluent', label: { zh: '生动', en: 'Fluent' } },
  { value: 'whisper', label: { zh: '低语', en: 'Whisper' } },
]

const LANGUAGE_BOOST_OPTIONS = [
  { value: 'auto', label: { zh: '自动', en: 'Auto' } },
  { value: 'Chinese', label: { zh: '中文 (普通话)', en: 'Chinese (Mandarin)' } },
  { value: 'Chinese,Yue', label: { zh: '中文 (粤语)', en: 'Chinese (Cantonese)' } },
  { value: 'English', label: { zh: '英语', en: 'English' } },
  { value: 'Arabic', label: { zh: '阿拉伯语', en: 'Arabic' } },
  { value: 'Russian', label: { zh: '俄语', en: 'Russian' } },
  { value: 'Spanish', label: { zh: '西班牙语', en: 'Spanish' } },
  { value: 'French', label: { zh: '法语', en: 'French' } },
  { value: 'Portuguese', label: { zh: '葡萄牙语', en: 'Portuguese' } },
  { value: 'German', label: { zh: '德语', en: 'German' } },
  { value: 'Turkish', label: { zh: '土耳其语', en: 'Turkish' } },
  { value: 'Dutch', label: { zh: '荷兰语', en: 'Dutch' } },
  { value: 'Ukrainian', label: { zh: '乌克兰语', en: 'Ukrainian' } },
  { value: 'Vietnamese', label: { zh: '越南语', en: 'Vietnamese' } },
  { value: 'Indonesian', label: { zh: '印尼语', en: 'Indonesian' } },
  { value: 'Japanese', label: { zh: '日语', en: 'Japanese' } },
  { value: 'Italian', label: { zh: '意大利语', en: 'Italian' } },
  { value: 'Korean', label: { zh: '韩语', en: 'Korean' } },
  { value: 'Thai', label: { zh: '泰语', en: 'Thai' } },
  { value: 'Polish', label: { zh: '波兰语', en: 'Polish' } },
  { value: 'Romanian', label: { zh: '罗马尼亚语', en: 'Romanian' } },
  { value: 'Greek', label: { zh: '希腊语', en: 'Greek' } },
  { value: 'Czech', label: { zh: '捷克语', en: 'Czech' } },
  { value: 'Finnish', label: { zh: '芬兰语', en: 'Finnish' } },
  { value: 'Hindi', label: { zh: '印地语', en: 'Hindi' } },
  { value: 'Bulgarian', label: { zh: '保加利亚语', en: 'Bulgarian' } },
  { value: 'Danish', label: { zh: '丹麦语', en: 'Danish' } },
  { value: 'Hebrew', label: { zh: '希伯来语', en: 'Hebrew' } },
  { value: 'Malay', label: { zh: '马来语', en: 'Malay' } },
  { value: 'Persian', label: { zh: '波斯语', en: 'Persian' } },
  { value: 'Slovak', label: { zh: '斯洛伐克语', en: 'Slovak' } },
  { value: 'Swedish', label: { zh: '瑞典语', en: 'Swedish' } },
  { value: 'Croatian', label: { zh: '克罗地亚语', en: 'Croatian' } },
  { value: 'Filipino', label: { zh: '菲律宾语', en: 'Filipino' } },
  { value: 'Hungarian', label: { zh: '匈牙利语', en: 'Hungarian' } },
  { value: 'Norwegian', label: { zh: '挪威语', en: 'Norwegian' } },
  { value: 'Slovenian', label: { zh: '斯洛文尼亚语', en: 'Slovenian' } },
  { value: 'Catalan', label: { zh: '加泰罗尼亚语', en: 'Catalan' } },
  { value: 'Nynorsk', label: { zh: '新挪威语', en: 'Nynorsk' } },
  { value: 'Tamil', label: { zh: '泰米尔语', en: 'Tamil' } },
  { value: 'Afrikaans', label: { zh: '南非荷兰语', en: 'Afrikaans' } },
]

const CLONE_PREVIEW_MODEL_OPTIONS = [
  { value: 'speech-2.6-hd', label: 'speech-2.6-hd' },
  { value: 'speech-2.6-turbo', label: 'speech-2.6-turbo' },
  { value: 'speech-2.8-hd', label: 'speech-2.8-hd' },
  { value: 'speech-2.8-turbo', label: 'speech-2.8-turbo' },
]

interface MinimaxVoiceCatalogItem {
  voice_id?: DynamicValue
  description?: DynamicValue
  voice_name?: DynamicValue
}

interface MinimaxVoiceCatalog {
  system_voice?: MinimaxVoiceCatalogItem[]
}

function normalizeVoiceText(value: DynamicValue): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeVoiceDescription(value: DynamicValue): string | null {
  if (typeof value === 'string') {
    return normalizeVoiceText(value)
  }
  if (!Array.isArray(value)) {
    return null
  }
  for (const item of value) {
    const description = normalizeVoiceText(item)
    if (description) {
      return description
    }
  }
  return null
}

function buildVoiceSelectorVoices(source: DynamicValue): VoiceSelectorConfig['voices'] {
  if (!source || typeof source !== 'object') {
    return []
  }
  const catalog = source as MinimaxVoiceCatalog
  const systemVoices = Array.isArray(catalog.system_voice) ? catalog.system_voice : []
  const seenIds = new Set<string>()
  const voices: VoiceSelectorConfig['voices'] = []

  for (const voice of systemVoices) {
    const voiceId = normalizeVoiceText(voice.voice_id)
    const voiceName = normalizeVoiceText(voice.voice_name)
    if (!voiceId || !voiceName || seenIds.has(voiceId)) {
      continue
    }
    seenIds.add(voiceId)
    const description = normalizeVoiceDescription(voice.description)
    voices.push({
      id: voiceId,
      name: voiceName,
      description: description ?? undefined,
      tags: buildVoiceFeatureTags({
        voiceId,
        voiceName,
        description: description ?? undefined,
        source: 'system',
      }),
    })
  }

  return voices
}

const MINIMAX_SELECTOR_VOICES = buildVoiceSelectorVoices(minimaxSpeechVoicesCatalog)

const VOICE_SELECTOR_CONFIG: VoiceSelectorConfig = {
  allowSearch: true,
  voices: MINIMAX_SELECTOR_VOICES,
  voiceLibrary: {
    providerId: 'ppio',
    modelId: 'ppio-minimax-speech',
    allowDelete: true,
  },
}

const DEFAULT_VOICE_ID = MINIMAX_SELECTOR_VOICES[0]?.id ?? 'male-qn-qingse'

const ADVANCED_PANEL_CONFIG: CompositePanelConfig = {
  layout: 'grid',
  gap: 12,
  gridColumns: 3,
  components: [
    { id: 'audioVol', type: 'number-input', label: sharedFieldText('volume'), config: { min: 0.1, max: 10, step: 0.1 } },
    { id: 'audioPitch', type: 'number-input', label: sharedFieldText('pitch'), config: { min: -12, max: 12, step: 1 } },
    { id: 'audioSpeed', type: 'number-input', label: sharedFieldText('speed'), config: { min: 0.5, max: 2, step: 0.1 } },
    {
      id: 'audioSampleRate',
      type: 'dropdown',
      label: sharedFieldText('sampleRate'),
      config: {
        options: [
          { value: 8000, label: '8000 Hz' },
          { value: 16000, label: '16000 Hz' },
          { value: 22050, label: '22050 Hz' },
          { value: 24000, label: '24000 Hz' },
          { value: 32000, label: '32000 Hz' },
          { value: 44100, label: '44100 Hz' },
        ],
      },
    },
    {
      id: 'bitrate',
      type: 'dropdown',
      label: sharedFieldText('bitrate'),
      config: {
        options: [
          { value: 32000, label: '32 kbps' },
          { value: 64000, label: '64 kbps' },
          { value: 128000, label: '128 kbps' },
          { value: 256000, label: '256 kbps' },
        ],
      },
    },
    {
      id: 'format',
      type: 'dropdown',
      label: sharedFieldText('audioFormat'),
      config: {
        options: [
          { value: 'mp3', label: 'MP3' },
          { value: 'pcm', label: 'PCM' },
          { value: 'flac', label: 'FLAC' },
        ],
      },
    },
    {
      id: 'channel',
      type: 'dropdown',
      label: sharedFieldText('channel'),
      config: {
        options: [
          { value: 1, label: { zh: '单声道', en: 'Mono' } },
          { value: 2, label: { zh: '立体声', en: 'Stereo' } },
        ],
      },
    },
    {
      id: 'englishNormalization',
      type: 'switch',
      label: { zh: '英文规范化', en: 'English Normalization' },
      config: {},
    },
    {
      id: 'continuousSound',
      type: 'switch',
      label: { zh: '自然衔接', en: 'Continuous Sound' },
      config: {},
    },
  ],
}

const MINIMAX_VOICE_CLONE_PANEL_CONFIG = {
  providerId: 'ppio',
  modelId: 'ppio-minimax-speech',
  previewModels: CLONE_PREVIEW_MODEL_OPTIONS,
}

export const minimaxSpeechModel = defineModel({
  meta: {
    id: 'ppio-minimax-speech',
    canonicalModelId: 'minimax-speech-2.8',
    provider: 'ppio',
    type: 'audio',
    i18nScope: 'models.defs.ppio-minimax-speech',
    name: { key: 'meta.name', fallback: 'Minimax Speech 2.8' },
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
      role: 'mode',
      name: { zh: '版本', en: 'Version' },
      default: 'hd',
      options: [
        { value: 'hd', label: 'HD' },
        { value: 'turbo', label: 'Turbo' },
      ],
      apiField: 'spec',
    },
    {
      id: 'minimaxVoiceId',
      type: 'composite',
      valueType: 'string',
      order: 2,
      name: sharedFieldText('voiceId'),
      default: DEFAULT_VOICE_ID,
      panel: 'voice-selector',
      config: {
        ...VOICE_SELECTOR_CONFIG,
        width: 720,
      },
    } as CompositePanelDef,
    {
      id: 'minimaxAudioEmotion',
      type: 'dropdown',
      order: 3,
      name: sharedFieldText('emotion'),
      default: '',
      options: EMOTION_OPTIONS,
      apiField: 'emotion',
    },
    {
      id: 'minimaxLanguageBoost',
      type: 'dropdown',
      order: 4,
      name: { zh: '语言增强', en: 'Language Boost' },
      default: 'auto',
      options: LANGUAGE_BOOST_OPTIONS,
      apiField: 'language_boost',
    },
    {
      id: 'minimaxAdvancedSettings',
      type: 'composite',
      valueType: 'object',
      order: 6,
      name: { zh: '高级选项', en: 'Advanced Options' },
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
      panel: 'composite',
      config: {
        ...ADVANCED_PANEL_CONFIG,
        width: 576,
      },
    } as CompositePanelDef,
    {
      id: 'minimaxVoiceClonePanel',
      type: 'composite',
      valueType: 'object',
      order: 7,
      name: { zh: '音色克隆', en: 'Voice Clone' },
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
      panel: 'minimax-voice-clone',
      config: {
        ...MINIMAX_VOICE_CLONE_PANEL_CONFIG,
        width: 860,
      },
    } as CompositePanelDef,
  ],
  linkages: [],
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

      const pickString = (...values: DynamicValue[]): string | undefined => {
        for (const value of values) {
          if (typeof value === 'string' && value.trim().length > 0) {
            return value.trim()
          }
        }
        return undefined
      }

      const pickNumber = (...values: DynamicValue[]): number | undefined => {
        for (const value of values) {
          const parsed = typeof value === 'number' ? value : Number(value)
          if (Number.isFinite(parsed)) {
            return parsed
          }
        }
        return undefined
      }

      const pickBoolean = (...values: DynamicValue[]): boolean | undefined => {
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
          ? (params.minimaxVoiceClonePanel as DynamicValueMap)
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

        const requestData: DynamicValueMap = {
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
        ? (params.minimaxAdvancedSettings as DynamicValueMap)
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

      const requestData: DynamicValueMap = {}
      if (text.length > 0) {
        requestData.text = text
      }

      const voiceSetting: DynamicValueMap = {}
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

      const audioSetting: DynamicValueMap = {}
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
          ? (params.minimaxVoiceClonePanel as DynamicValueMap)
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
