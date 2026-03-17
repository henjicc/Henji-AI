/**
 * Minimax Speech 2.6 音频生成模型
 */

import { defineModel } from '@/core'

export const minimaxSpeech26Model = defineModel({
  meta: {
    id: 'ppio-minimax-speech-2.6',
    provider: 'ppio',
    type: 'audio',
        i18nScope: 'models.defs.ppio-minimax-speech-2.6',
    name: { key: 'meta.name', fallback: 'Minimax Speech 2.6' },
    description: 'Minimax Speech 2.6 音频生成模型，支持高质量语音合成',
    tags: ['audio', 'text-to-speech', 'voice-synthesis']
  },
  inputLimits: {
    images: { max: 0 },
    videos: { max: 0 }
  },
  params: [
    // 1. 音频规格
    {
      id: 'minimaxAudioSpec',
      type: 'dropdown',
      order: 1,
      name: { key: 'auto.1', fallback: 'Audio Spec' },
      default: 'hd',
      options: [
        { value: 'hd', label: 'HD' },
        { value: 'turbo', label: 'Turbo' }
      ],
      apiField: 'spec'
    },
    // 2. 音色ID
    {
      id: 'minimaxVoiceId',
      type: 'text',
      order: 2,
      name: { key: 'auto.2', fallback: 'Voice ID' },
      default: 'male-qn-qingse',
      apiField: 'voice_id'
    },
    // 3. 语速
    {
      id: 'minimaxAudioSpeed',
      type: 'number',
      order: 3,
      name: { key: 'auto.3', fallback: 'Speed' },
      default: 1.0,
      min: 0.5,
      max: 2.0,
      step: 0.1,
      apiField: 'speed'
    },
    // 4. 音量
    {
      id: 'minimaxAudioVol',
      type: 'number',
      order: 4,
      name: { key: 'auto.4', fallback: 'Volume' },
      default: 1.0,
      min: 0.1,
      max: 10.0,
      step: 0.1,
      apiField: 'vol'
    },
    // 5. 音调
    {
      id: 'minimaxAudioPitch',
      type: 'number',
      order: 5,
      name: { key: 'auto.5', fallback: 'Pitch' },
      default: 0,
      min: -12,
      max: 12,
      step: 1,
      apiField: 'pitch'
    },
    // 6. 情感
    {
      id: 'minimaxAudioEmotion',
      type: 'text',
      order: 6,
      name: { key: 'auto.6', fallback: 'Emotion' },
      default: '',
      apiField: 'emotion'
    },
    // 7. 采样率
    {
      id: 'minimaxAudioSampleRate',
      type: 'dropdown',
      order: 7,
      name: { key: 'auto.7', fallback: 'Sample Rate' },
      default: 32000,
      options: [
        { value: 16000, label: '16000 Hz' },
        { value: 24000, label: '24000 Hz' },
        { value: 32000, label: '32000 Hz' }
      ],
      apiField: 'sample_rate'
    },
    // 8. 比特率
    {
      id: 'minimaxAudioBitrate',
      type: 'dropdown',
      order: 8,
      name: { key: 'auto.8', fallback: 'Bitrate' },
      default: 128000,
      options: [
        { value: 64000, label: '64 kbps' },
        { value: 128000, label: '128 kbps' },
        { value: 256000, label: '256 kbps' }
      ],
      apiField: 'bitrate'
    },
    // 9. 音频格式
    {
      id: 'minimaxAudioFormat',
      type: 'dropdown',
      order: 9,
      name: { key: 'auto.9', fallback: 'Audio Format' },
      default: 'mp3',
      options: [
        { value: 'mp3', label: 'MP3' },
        { value: 'wav', label: 'WAV' },
        { value: 'pcm', label: 'PCM' },
        { value: 'flac', label: 'FLAC' }
      ],
      apiField: 'format'
    },
    // 10. 声道
    {
      id: 'minimaxAudioChannel',
      type: 'dropdown',
      order: 10,
      name: { key: 'auto.10', fallback: 'Channel' },
      default: 1,
      options: [
        { value: 1, label: '单声道' },
        { value: 2, label: '立体声' }
      ],
      apiField: 'channel'
    }
  ],
  linkages: [
  ],
  endpoints: {
    selector: async (params) => {
      const spec = params.minimaxAudioSpec || params.spec || 'hd'
      return spec === 'turbo' ? '/minimax-speech-2.6-turbo' : '/minimax-speech-2.6-hd'
    }
  },
  request: {
    builder: (params) => {
      const text = params.text || params.prompt || ''

      const requestData: any = {
        text,
        output_format: params.output_format || 'url'
      }

      // Build voice_setting
      const voice_setting: any = {}
      const voiceId = params.minimaxVoiceId || params.voice_id
      if (voiceId) voice_setting.voice_id = voiceId
      if (params.minimaxAudioSpeed !== undefined) voice_setting.speed = params.minimaxAudioSpeed
      if (params.minimaxAudioVol !== undefined) voice_setting.vol = params.minimaxAudioVol
      if (params.minimaxAudioPitch !== undefined) voice_setting.pitch = params.minimaxAudioPitch
      if (params.minimaxAudioEmotion) voice_setting.emotion = params.minimaxAudioEmotion
      requestData.voice_setting = voice_setting

      // Build audio_setting
      const audio_setting: any = {}
      if (params.minimaxAudioSampleRate !== undefined) audio_setting.sample_rate = params.minimaxAudioSampleRate
      if (params.minimaxAudioBitrate !== undefined) audio_setting.bitrate = params.minimaxAudioBitrate
      if (params.minimaxAudioFormat) audio_setting.format = params.minimaxAudioFormat
      if (params.minimaxAudioChannel !== undefined) audio_setting.channel = params.minimaxAudioChannel
      if (Object.keys(audio_setting).length > 0) {
        requestData.audio_setting = audio_setting
      }

      return requestData
    }
  },
  pricing: {
    currency: '¥',
    calculator: (params) => {
      const spec = params.minimaxAudioSpec || 'hd'
      const basePrice = spec === 'turbo' ? 0.02 : 0.05
      return basePrice
    },
    description: '基础价格 HD ¥0.05/次，Turbo ¥0.02/次'
  }
})

export default minimaxSpeech26Model;
