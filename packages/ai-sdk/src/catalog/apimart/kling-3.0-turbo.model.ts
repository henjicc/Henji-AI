/** APIMart Kling 3.0 Turbo 视频模型（运行时契约） */

import { defineModel } from '../defineModel'
import type { JsonValue, JsonObject } from '../../types/runtime'

export const apimartKling30TurboModel = defineModel({
  meta: {
    id: 'apimart-kling-3.0-turbo', canonicalModelId: 'kling-video-3.0-turbo', seriesId: 'kling-video', seriesRank: 3.1,
    provider: 'apimart', type: 'video',
    tags: ['text-to-video', 'image-to-video', 'max-images-1', 'turbo-mode', 'provider-apimart'],
    aliases: ['kling-3-turbo-apimart'], polling: { interval: 3000, maxAttempts: 300, expectedAttempts: 70 }
  },
  inputLimits: { images: { max: 1 }, videos: { max: 0 } },
  params: [
    {
      id: 'apimartKling30TurboAspectRatio', type: 'dropdown', order: 1,
      default: 'smart',
      options: [{ value: 'smart' }, ...['16:9', '9:16', '1:1'].map((ratio) => ({ value: ratio }))]
    },
    {
      id: 'apimartKling30TurboResolution', type: 'dropdown', order: 2,
      default: '720p',
      options: ['720p', '1080p'].map((value) => ({ value }))
    },
    {
      id: 'apimartKling30TurboDuration', type: 'number', order: 3,
      default: 5, min: 3, max: 15, step: 1
    }
  ],
  endpoints: '/v1/videos/generations',
  request: {
    builder: (params) => {
      const filterSources = (value: JsonValue): string[] => Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : []
      const uploaded = filterSources(params.uploadedFilePaths)
      const images = uploaded.length > 0 ? uploaded : filterSources(params.images)
      const raw = String(params.apimartKling30TurboAspectRatio || 'smart')
      const body: JsonObject = {
        model: 'kling-3.0-turbo', prompt: typeof params.prompt === 'string' ? params.prompt.slice(0, 3072) : '',
        resolution: params.apimartKling30TurboResolution === '1080p' ? '1080p' : '720p',
        duration: Math.min(15, Math.max(3, Math.round(Number(params.apimartKling30TurboDuration || 5))))
      }
      if (images.length > 0) body.first_frame_image = images[0]
      else body.aspect_ratio = ['16:9', '9:16', '1:1'].includes(raw) ? raw : '16:9'
      return body
    }
  },
  pricing: {
    currency: '$',
    calculator: (params) => Math.min(15, Math.max(3, Math.round(Number(params.apimartKling30TurboDuration || 5))))
      * (params.apimartKling30TurboResolution === '1080p' ? 0.1432 : 0.1144),
    description: '720p $0.1144/秒，1080p $0.1432/秒'
  }
})

export default apimartKling30TurboModel
