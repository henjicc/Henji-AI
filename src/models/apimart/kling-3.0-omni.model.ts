/** APIMart Kling 3.0 Omni 多模态视频模型 */

import { defineModel, sharedFieldText, sharedOptionText } from '@/core'

export const apimartKling30OmniModel = defineModel({
  meta: {
    id: 'apimart-kling-3.0-omni', canonicalModelId: 'kling-video-3.0-omni', seriesId: 'kling-video', seriesRank: 3.2,
    provider: 'apimart', type: 'video', i18nScope: 'models.defs.apimart-kling-3.0-omni',
    name: { key: 'meta.name', fallback: 'Kling 3.0 Omni' },
    tags: ['text-to-video', 'image-to-video', 'video-to-video', 'supports-video-editing', 'reference-mode', 'mixed-upload-mode', 'supports-audio-generation', 'supports-4k', 'provider-apimart'],
    aliases: ['kling-v3-omni-apimart'], polling: { interval: 3000, maxAttempts: 300, expectedAttempts: 80 }
  },
  inputLimits: {
    images: { max: 7 }, videos: { max: 1 },
    rules: [{ videoConstraints: { minDurationSec: 3, maxDurationSec: 10, maxSizeMB: 200, trim: { maxClipSeconds: 10 } } }]
  },
  params: [
    {
      id: 'apimartKling30OmniAspectRatio', type: 'dropdown', order: 1,
      name: sharedFieldText('aspectRatio'), default: 'smart',
      options: [{ value: 'smart', label: sharedOptionText('smart') }, ...['16:9', '9:16', '1:1'].map((ratio) => ({ value: ratio, label: ratio }))]
    },
    {
      id: 'apimartKling30OmniResolution', type: 'dropdown', order: 2,
      name: sharedFieldText('resolution'), default: '720p',
      options: ['720p', '1080p', '4K'].map((value) => ({ value, label: value }))
    },
    {
      id: 'apimartKling30OmniDuration', type: 'number', order: 3,
      name: sharedFieldText('duration'), default: 5, min: 3, max: 15, step: 1
    },
    {
      id: 'apimartKling30OmniAudio', type: 'switch', order: 4,
      name: sharedFieldText('generateAudio'), default: false
    },
    {
      id: 'apimartKling30OmniKeepOriginalSound', type: 'switch', order: 5,
      name: { zh: '保留视频原声', en: 'Keep Original Sound' }, default: false
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
      const raw = String(params.apimartKling30OmniAspectRatio || 'smart')
      const resolution = String(params.apimartKling30OmniResolution || '720p')
      const body: DynamicValueMap = {
        model: 'kling-v3-omni', prompt: typeof params.prompt === 'string' ? params.prompt : '',
        mode: resolution === '4K' ? '4k' : (resolution === '1080p' ? 'pro' : 'std'),
        duration: Math.min(15, Math.max(3, Math.round(Number(params.apimartKling30OmniDuration || 5)))),
        aspect_ratio: ['16:9', '9:16', '1:1'].includes(raw) ? raw : '16:9'
      }
      if (videos.length > 0) {
        body.video_list = [{
          video_url: videos[0], refer_type: 'base',
          keep_original_sound: params.apimartKling30OmniKeepOriginalSound === true ? 'yes' : 'no'
        }]
      } else {
        if (images.length > 0) body.image_urls = images.slice(0, 7)
        body.audio = params.apimartKling30OmniAudio === true
      }
      return body
    }
  },
  pricing: {
    currency: '$',
    calculator: (params) => {
      const duration = Math.min(15, Math.max(3, Math.round(Number(params.apimartKling30OmniDuration || 5))))
      const resolution = String(params.apimartKling30OmniResolution || '720p')
      const hasVideo = (Array.isArray(params.uploadedVideoFilePaths) && params.uploadedVideoFilePaths.length > 0)
        || (Array.isArray(params.videos) && params.videos.length > 0)
      const audio = params.apimartKling30OmniAudio === true
      const rate = resolution === '4K'
        ? 0.42856
        : (resolution === '1080p' ? (hasVideo ? 0.1792 : (audio ? 0.112 : 0.0896)) : (hasVideo ? 0.1344 : (audio ? 0.0896 : 0.0672)))
      return duration * rate
    },
    description: '基础每秒 720p $0.0672、1080p $0.0896、4K $0.42856；音频或视频参考使用对应附加档位'
  }
})

export default apimartKling30OmniModel
