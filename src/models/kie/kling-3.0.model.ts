/**
 * KIE Kling 3.0 标准视频模型
 */

import { defineModel, sharedFieldText, sharedOptionText } from '@/core'

const KIE_CREATE_TASK_ENDPOINT = '/api/v1/jobs/createTask'

export const kieKling30Model = defineModel({
  meta: {
    id: 'kie-kling-3.0',
    canonicalModelId: 'kling-video-3.0',
    seriesId: 'kling-video',
    seriesRank: 3,
    provider: 'kie',
    type: 'video',
    i18nScope: 'models.defs.kie-kling-3.0',
    name: { key: 'meta.name', fallback: 'Kling 3.0' },
    tags: [
      'text-to-video',
      'image-to-video',
      'start-end-frame',
      'supports-audio-generation',
      'supports-4k',
      'provider-kie'
    ],
    polling: { interval: 3000, maxAttempts: 300, expectedAttempts: 90 }
  },
  inputLimits: {
    images: { max: 2 },
    videos: { max: 0 }
  },
  params: [
    {
      id: 'kieKling30AspectRatio',
      type: 'dropdown',
      order: 1,
      name: sharedFieldText('aspectRatio'),
      default: 'smart',
      options: [
        { value: 'smart', label: sharedOptionText('smart') },
        { value: '16:9', label: '16:9' },
        { value: '9:16', label: '9:16' },
        { value: '1:1', label: '1:1' }
      ]
    },
    {
      id: 'kieKling30Resolution',
      type: 'dropdown',
      order: 2,
      name: sharedFieldText('resolution'),
      default: '720p',
      options: [
        { value: '720p', label: '720p' },
        { value: '1080p', label: '1080p' },
        { value: '4K', label: '4K' }
      ]
    },
    {
      id: 'kieKling30Duration',
      type: 'dropdown',
      order: 3,
      name: sharedFieldText('duration'),
      default: '5',
      options: Array.from({ length: 13 }, (_, index) => {
        const value = String(index + 3)
        return { value, label: `${value}s` }
      })
    },
    {
      id: 'kieKling30Sound',
      type: 'switch',
      order: 4,
      name: sharedFieldText('generateAudio'),
      default: false
    }
  ],
  linkages: [],
  endpoints: KIE_CREATE_TASK_ENDPOINT,
  request: {
    builder: (params) => {
      const filterSources = (value: DynamicValue): string[] => Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : []
      const uploadedImages = filterSources(params.uploadedFilePaths)
      const images = uploadedImages.length > 0 ? uploadedImages : filterSources(params.images)
      const aspectRatios = ['16:9', '9:16', '1:1']
      const rawAspectRatio = String(params.kieKling30AspectRatio || 'smart')
      const ratioHint = typeof params.__firstImageRatio === 'number' && Number.isFinite(params.__firstImageRatio) && params.__firstImageRatio > 0
        ? params.__firstImageRatio
        : 16 / 9
      let aspectRatio = aspectRatios.includes(rawAspectRatio) ? rawAspectRatio : '16:9'
      if (rawAspectRatio === 'smart' || rawAspectRatio === 'auto') {
        let bestDiff = Number.POSITIVE_INFINITY
        for (const candidate of aspectRatios) {
          const pair = candidate.split(':').map(Number)
          const difference = Math.abs(pair[0] / pair[1] - ratioHint)
          if (difference < bestDiff) {
            bestDiff = difference
            aspectRatio = candidate
          }
        }
      }
      const resolution = params.kieKling30Resolution === '4K' || params.kieKling30Resolution === '1080p'
        ? params.kieKling30Resolution
        : '720p'
      const input: DynamicValueMap = {
        prompt: typeof params.prompt === 'string' ? params.prompt.slice(0, 2500) : '',
        sound: params.kieKling30Sound === true,
        duration: String(params.kieKling30Duration || '5'),
        aspect_ratio: aspectRatio,
        mode: resolution === '4K' ? '4K' : (resolution === '1080p' ? 'pro' : 'std'),
        multi_shots: false
      }
      if (images.length > 0) input.image_urls = images.slice(0, 2)
      return { model: 'kling-3.0/video', input }
    }
  },
  pricing: {
    currency: '$',
    calculator: (params) => {
      const duration = Math.min(15, Math.max(3, Number(params.kieKling30Duration || 5)))
      const resolution = String(params.kieKling30Resolution || '720p')
      const sound = params.kieKling30Sound === true
      if (resolution === '4K') return duration * 0.335
      if (resolution === '1080p') return duration * (sound ? 0.135 : 0.09)
      return duration * (sound ? 0.10 : 0.07)
    },
    description: '720p 无/有音频 $0.07/$0.10 每秒；1080p $0.09/$0.135；4K $0.335'
  }
})

export default kieKling30Model
