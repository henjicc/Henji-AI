/** APIMart MiniMax H3 文生、首尾帧与多模态参考视频模型 */

import { defineModel, sharedFieldText, sharedModeText, sharedOptionText } from '@/core'

export const apimartMiniMaxH3Model = defineModel({
  meta: {
    id: 'apimart-minimax-h3', canonicalModelId: 'minimax-h3', seriesId: 'minimax-video', seriesRank: 3,
    provider: 'apimart', type: 'video', i18nScope: 'models.defs.apimart-minimax-h3',
    name: { key: 'meta.name', fallback: 'MiniMax H3' },
    tags: ['text-to-video', 'image-to-video', 'start-end-frame', 'reference-mode', 'multi-mode-switch', 'mixed-upload-mode', 'provider-apimart'],
    aliases: ['minimax-h3-apimart'], polling: { interval: 5000, maxAttempts: 180, expectedAttempts: 60 }
  },
  inputLimits: {
    images: { max: 2 }, videos: { max: 0 }, audios: { max: 0 },
    rules: [{
      when: 'apimartMiniMaxH3Mode === "reference-to-video"',
      images: { max: 9 }, videos: { max: 3 }, audios: { max: 3 }
    }]
  },
  params: [
    {
      id: 'apimartMiniMaxH3Mode', type: 'dropdown', order: 1,
      name: sharedFieldText('mode'), default: 'text-image-to-video',
      options: [
        { value: 'text-image-to-video', label: sharedModeText('textImageToVideo') },
        { value: 'reference-to-video', label: sharedModeText('referenceToVideo') }
      ]
    },
    {
      id: 'apimartMiniMaxH3AspectRatio', type: 'dropdown', order: 2,
      name: sharedFieldText('aspectRatio'), default: 'smart',
      options: [
        { value: 'smart', label: sharedOptionText('smart') },
        ...['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'].map((ratio) => ({ value: ratio, label: ratio }))
      ]
    },
    {
      id: 'apimartMiniMaxH3Resolution', type: 'dropdown', order: 3,
      name: sharedFieldText('resolution'), default: '768P',
      options: ['768P', '2K'].map((value) => ({ value, label: value }))
    },
    {
      id: 'apimartMiniMaxH3Duration', type: 'number', order: 4,
      name: sharedFieldText('duration'), default: 5, min: 4, max: 15, step: 1
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
      const supported = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16']
      const raw = String(params.apimartMiniMaxH3AspectRatio || 'smart')
      const hint = typeof params.__firstImageRatio === 'number' && Number.isFinite(params.__firstImageRatio) && params.__firstImageRatio > 0 ? params.__firstImageRatio : 16 / 9
      let aspectRatio = supported.includes(raw) ? raw : '16:9'
      if (raw === 'smart' || raw === 'auto') {
        let difference = Number.POSITIVE_INFINITY
        for (const candidate of supported) {
          const pair = candidate.split(':').map(Number)
          const next = Math.abs(pair[0] / pair[1] - hint)
          if (next < difference) { difference = next; aspectRatio = candidate }
        }
      }
      const body: DynamicValueMap = {
        model: 'MiniMax-H3', prompt: typeof params.prompt === 'string' ? params.prompt : '',
        duration: Math.min(15, Math.max(4, Math.round(Number(params.apimartMiniMaxH3Duration || 5)))),
        resolution: params.apimartMiniMaxH3Resolution === '2K' ? '2K' : '768P',
        aspect_ratio: aspectRatio
      }
      if (params.apimartMiniMaxH3Mode === 'reference-to-video') {
        if (images.length > 0) body.image_urls = images.slice(0, 9)
        if (videos.length > 0) body.video_urls = videos.slice(0, 3)
        if (audios.length > 0) body.audio_urls = audios.slice(0, 3)
      } else if (images.length > 0) {
        body.first_frame_image = images[0]
        if (images[1]) body.last_frame_image = images[1]
      }
      return body
    }
  },
  pricing: {
    currency: '$',
    calculator: (params) => {
      const duration = Math.min(15, Math.max(4, Math.round(Number(params.apimartMiniMaxH3Duration || 5))))
      const rate = params.apimartMiniMaxH3Resolution === '2K' ? 0.09144 : 0.05712
      const images = Array.isArray(params.uploadedFilePaths) ? params.uploadedFilePaths.length : (Array.isArray(params.images) ? params.images.length : 0)
      return duration * rate + Math.max(0, images - 5) * 0.02288
    },
    description: '768P $0.05712/秒，2K $0.09144/秒；参考图前 5 张免费，之后 $0.02288/张'
  }
})

export default apimartMiniMaxH3Model
