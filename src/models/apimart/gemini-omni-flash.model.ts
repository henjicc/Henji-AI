/** APIMart Gemini Omni Flash 多模态视频模型 */

import { defineModel, sharedFieldText, sharedOptionText } from '@/core'

export const apimartGeminiOmniFlashModel = defineModel({
  meta: {
    id: 'apimart-gemini-omni-flash', canonicalModelId: 'gemini-omni-video',
    seriesId: 'gemini-omni', seriesRank: 1, provider: 'apimart', type: 'video',
    i18nScope: 'models.defs.apimart-gemini-omni-flash',
    name: { key: 'meta.name', fallback: 'Gemini Omni Flash' },
    tags: ['text-to-video', 'image-to-video', 'video-to-video', 'supports-video-editing', 'supports-multi-image', 'mixed-upload-mode', 'provider-apimart'],
    aliases: ['gemini-omni-flash-apimart'], polling: { interval: 5000, maxAttempts: 180, expectedAttempts: 60 }
  },
  inputLimits: { images: { max: 7 }, videos: { max: 1 } },
  params: [
    {
      id: 'apimartGeminiOmniFlashAspectRatio', type: 'dropdown', order: 1,
      name: sharedFieldText('aspectRatio'), default: 'smart',
      options: [
        { value: 'smart', label: sharedOptionText('smart') },
        { value: '16:9', label: '16:9' },
        { value: '9:16', label: '9:16' }
      ]
    },
    {
      id: 'apimartGeminiOmniFlashResolution', type: 'dropdown', order: 2,
      name: sharedFieldText('resolution'), default: '720p',
      options: [{ value: '720p', label: '720p' }]
    },
    {
      id: 'apimartGeminiOmniFlashDuration', type: 'number', order: 3,
      name: sharedFieldText('duration'), default: 5, min: 3, max: 10, step: 1
    },
    {
      id: 'apimartGeminiOmniFlashExtendTaskId', type: 'text', order: 4,
      name: { zh: '延续任务 ID', en: 'Extend From Task ID' }, default: ''
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
      const raw = String(params.apimartGeminiOmniFlashAspectRatio || 'smart')
      const aspectRatio = raw === '9:16' ? '9:16' : '16:9'
      const body: DynamicValueMap = {
        model: 'gemini-omni-flash-preview',
        prompt: typeof params.prompt === 'string' ? params.prompt : '',
        duration: Math.min(10, Math.max(3, Math.round(Number(params.apimartGeminiOmniFlashDuration || 5)))),
        aspect_ratio: aspectRatio,
        resolution: '720p'
      }
      if (images.length > 0) body.image_urls = images.slice(0, 7)
      if (videos.length > 0) body.video_urls = videos.slice(0, 1)
      if (typeof params.apimartGeminiOmniFlashExtendTaskId === 'string' && params.apimartGeminiOmniFlashExtendTaskId.trim()) {
        body.extend_from_task_id = params.apimartGeminiOmniFlashExtendTaskId.trim()
      }
      return body
    }
  },
  pricing: {
    currency: '$',
    calculator: (params) => Math.min(10, Math.max(3, Math.round(Number(params.apimartGeminiOmniFlashDuration || 5)))) * 0.088,
    description: '720p $0.088/秒；参考输入与延续任务以实时账单为准'
  }
})

export default apimartGeminiOmniFlashModel
