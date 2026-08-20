/** APIMart Kling 3.0 标准视频模型 */

import { defineModel, sharedFieldText, sharedOptionText } from '@/core'

export const apimartKling30Model = defineModel({
  meta: {
    id: 'apimart-kling-3.0', canonicalModelId: 'kling-video-3.0', seriesId: 'kling-video', seriesRank: 3,
    provider: 'apimart', type: 'video', i18nScope: 'models.defs.apimart-kling-3.0',
    name: { key: 'meta.name', fallback: 'Kling 3.0' },
    tags: ['text-to-video', 'image-to-video', 'start-end-frame', 'supports-audio-generation', 'supports-4k', 'provider-apimart'],
    aliases: ['kling-v3-apimart'], polling: { interval: 3000, maxAttempts: 300, expectedAttempts: 80 }
  },
  inputLimits: { images: { max: 2 }, videos: { max: 0 } },
  params: [
    {
      id: 'apimartKling30AspectRatio', type: 'dropdown', order: 1,
      name: sharedFieldText('aspectRatio'), default: 'smart',
      options: [{ value: 'smart', label: sharedOptionText('smart') }, ...['16:9', '9:16', '1:1'].map((ratio) => ({ value: ratio, label: ratio }))]
    },
    {
      id: 'apimartKling30Resolution', type: 'dropdown', order: 2,
      name: sharedFieldText('resolution'), default: '720p',
      options: ['720p', '1080p', '4K'].map((value) => ({ value, label: value }))
    },
    {
      id: 'apimartKling30Duration', type: 'number', order: 3,
      name: sharedFieldText('duration'), default: 5, min: 3, max: 15, step: 1
    },
    {
      id: 'apimartKling30Audio', type: 'switch', order: 4,
      name: sharedFieldText('generateAudio'), default: false
    }
  ],
  linkages: [], endpoints: '/v1/videos/generations',
  request: {
    builder: (params) => {
      const filterSources = (value: DynamicValue): string[] => Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : []
      const uploaded = filterSources(params.uploadedFilePaths)
      const images = uploaded.length > 0 ? uploaded : filterSources(params.images)
      const raw = String(params.apimartKling30AspectRatio || 'smart')
      const aspectRatio = ['16:9', '9:16', '1:1'].includes(raw) ? raw : '16:9'
      const resolution = String(params.apimartKling30Resolution || '720p')
      const body: DynamicValueMap = {
        model: 'kling-v3', prompt: typeof params.prompt === 'string' ? params.prompt : '',
        mode: resolution === '4K' ? '4k' : (resolution === '1080p' ? 'pro' : 'std'),
        duration: Math.min(15, Math.max(3, Math.round(Number(params.apimartKling30Duration || 5)))),
        aspect_ratio: aspectRatio,
        audio: params.apimartKling30Audio === true
      }
      if (images.length > 0) body.image_urls = images.slice(0, 2)
      return body
    }
  },
  pricing: {
    currency: '$',
    calculator: (params) => {
      const duration = Math.min(15, Math.max(3, Math.round(Number(params.apimartKling30Duration || 5))))
      const resolution = String(params.apimartKling30Resolution || '720p')
      const audio = params.apimartKling30Audio === true
      const rate = resolution === '4K' ? 0.42856 : (resolution === '1080p' ? (audio ? 0.1344 : 0.0896) : (audio ? 0.1008 : 0.0672))
      return duration * rate
    },
    description: '720p 无/有音频 $0.0672/$0.1008 每秒；1080p $0.0896/$0.1344；4K $0.42856'
  }
})

export default apimartKling30Model
