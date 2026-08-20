/** APIMart Seedance 2.0 Mini 多模态视频模型 */

import { defineModel, sharedFieldText, sharedModeText, sharedOptionText } from '@/core'

export const apimartSeedance20MiniModel = defineModel({
  meta: {
    id: 'apimart-seedance-2.0-mini', canonicalModelId: 'seedance-2.0-mini', seriesId: 'seedance', seriesRank: 2.05,
    provider: 'apimart', type: 'video', i18nScope: 'models.defs.apimart-seedance-2.0-mini',
    name: { key: 'meta.name', fallback: 'Seedance 2.0 Mini' },
    tags: ['text-to-video', 'image-to-video', 'start-end-frame', 'reference-mode', 'multi-mode-switch', 'mixed-upload-mode', 'supports-audio-generation', 'fast-mode', 'provider-apimart'],
    aliases: ['seedance-2-mini-apimart'], polling: { interval: 3000, maxAttempts: 300, expectedAttempts: 70 }
  },
  inputLimits: {
    images: { max: 2 }, videos: { max: 0 }, audios: { max: 0 },
    rules: [{ when: 'apimartSeedance20MiniMode === "reference-to-video"', images: { max: 9 }, videos: { max: 3 }, audios: { max: 3 } }]
  },
  params: [
    {
      id: 'apimartSeedance20MiniMode', type: 'dropdown', order: 1,
      name: sharedFieldText('mode'), default: 'reference-to-video',
      options: [
        { value: 'text-image-to-video', label: sharedModeText('textImageToVideo') },
        { value: 'reference-to-video', label: sharedModeText('referenceToVideo') }
      ]
    },
    {
      id: 'apimartSeedance20MiniAspectRatio', type: 'dropdown', order: 2,
      name: sharedFieldText('aspectRatio'), default: 'smart',
      options: [{ value: 'smart', label: sharedOptionText('smart') }, ...['1:1', '4:3', '3:4', '16:9', '9:16', '21:9'].map((ratio) => ({ value: ratio, label: ratio }))]
    },
    {
      id: 'apimartSeedance20MiniResolution', type: 'dropdown', order: 3,
      name: sharedFieldText('resolution'), default: '720p',
      options: ['480p', '720p'].map((value) => ({ value, label: value }))
    },
    {
      id: 'apimartSeedance20MiniDuration', type: 'number', order: 4,
      name: sharedFieldText('duration'), default: 5, min: 4, max: 15, step: 1
    },
    {
      id: 'apimartSeedance20MiniGenerateAudio', type: 'switch', order: 5,
      name: sharedFieldText('generateAudio'), default: true
    },
    {
      id: 'apimartSeedance20MiniReturnLastFrame', type: 'switch', order: 6,
      name: { zh: '返回尾帧', en: 'Return Last Frame' }, default: false
    }
  ],
  linkages: [], endpoints: '/v1/videos/generations',
  request: {
    builder: (params) => {
      const filterSources = (value: DynamicValue): string[] => Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : []
      const pickSources = (primary: DynamicValue, fallback: DynamicValue): string[] => {
        const preferred = filterSources(primary)
        return preferred.length > 0 ? preferred : filterSources(fallback)
      }
      const images = pickSources(params.uploadedFilePaths, params.images)
      const videos = pickSources(params.uploadedVideoFilePaths, params.videos)
      const audios = pickSources(params.uploadedAudioFilePaths, params.audios)
      const ratios = ['1:1', '4:3', '3:4', '16:9', '9:16', '21:9']
      const raw = String(params.apimartSeedance20MiniAspectRatio || 'smart')
      const size = ratios.includes(raw) ? raw : '16:9'
      const body: DynamicValueMap = {
        model: 'seedance-2.0-mini', prompt: typeof params.prompt === 'string' ? params.prompt : '',
        duration: Math.min(15, Math.max(4, Math.round(Number(params.apimartSeedance20MiniDuration || 5)))),
        size, resolution: params.apimartSeedance20MiniResolution === '480p' ? '480p' : '720p',
        generate_audio: params.apimartSeedance20MiniGenerateAudio !== false,
        return_last_frame: params.apimartSeedance20MiniReturnLastFrame === true
      }
      if (params.apimartSeedance20MiniMode === 'reference-to-video') {
        if (images.length > 0) body.image_urls = images.slice(0, 9)
        if (videos.length > 0) body.video_urls = videos.slice(0, 3)
        if (audios.length > 0) body.audio_urls = audios.slice(0, 3)
      } else if (images.length > 0) {
        body.image_with_roles = images.slice(0, 2).map((url, index) => ({ url, role: index === 0 ? 'first_frame' : 'last_frame' }))
      }
      return body
    }
  },
  pricing: {
    currency: '$',
    calculator: (params) => Math.min(15, Math.max(4, Math.round(Number(params.apimartSeedance20MiniDuration || 5))))
      * (params.apimartSeedance20MiniResolution === '480p' ? 0.01056 : 0.02288),
    description: '输出每秒：480p $0.01056，720p $0.02288；参考输入另计'
  }
})

export default apimartSeedance20MiniModel
