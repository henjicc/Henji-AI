/**
 * Minimax Speech 2.6 音频生成模型
 */

import { defineModel } from '@/core'

export const minimaxSpeech26Model = defineModel({
  meta: {
    id: 'minimax-speech-2.6',
    provider: 'ppio',
    type: 'audio',
    name: 'Minimax Speech 2.6',
    description: 'Minimax Speech 2.6 音频生成模型，支持高质量语音合成',
    tags: ['audio', 'text-to-speech', 'voice-synthesis']
  },
  params: [
    // 1. 音频规格
    {
      id: 'minimaxAudioSpec',
      type: 'dropdown',
      order: 1,
      name: { zh: '音频规格', en: 'Audio Spec' },
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
      name: { zh: '音色ID', en: 'Voice ID' },
      default: 'male-qn-qingse',
      apiField: 'voice_id'
    },
    // 3. 语速
    {
      id: 'minimaxAudioSpeed',
      type: 'slider',
      order: 3,
      name: { zh: '语速', en: 'Speed' },
      default: 1.0,
      min: 0.5,
      max: 2.0,
      step: 0.1,
      apiField: 'speed'
    },
    // 4. 音量
    {
      id: 'minimaxAudioVol',
      type: 'slider',
      order: 4,
      name: { zh: '音量', en: 'Volume' },
      default: 1.0,
      min: 0.1,
      max: 10.0,
      step: 0.1,
      apiField: 'vol'
    },
    // 5. 音调
    {
      id: 'minimaxAudioPitch',
      type: 'slider',
      order: 5,
      name: { zh: '音调', en: 'Pitch' },
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
      name: { zh: '情感', en: 'Emotion' },
      default: '',
      apiField: 'emotion'
    },
    // 7. 采样率
    {
      id: 'minimaxAudioSampleRate',
      type: 'dropdown',
      order: 7,
      name: { zh: '采样率', en: 'Sample Rate' },
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
      name: { zh: '比特率', en: 'Bitrate' },
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
      name: { zh: '音频格式', en: 'Audio Format' },
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
      name: { zh: '声道', en: 'Channel' },
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
      const spec = params.spec || 'hd'
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
      if (params.voice_id) voice_setting.voice_id = params.voice_id
      if (params.speed !== undefined) voice_setting.speed = params.speed
      if (params.vol !== undefined) voice_setting.vol = params.vol
      if (params.pitch !== undefined) voice_setting.pitch = params.pitch
      if (params.emotion) voice_setting.emotion = params.emotion
      if (Object.keys(voice_setting).length > 0) {
        requestData.voice_setting = voice_setting
      }

      // Build audio_setting
      const audio_setting: any = {}
      if (params.sample_rate !== undefined) audio_setting.sample_rate = params.sample_rate
      if (params.bitrate !== undefined) audio_setting.bitrate = params.bitrate
      if (params.format) audio_setting.format = params.format
      if (params.channel !== undefined) audio_setting.channel = params.channel
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
