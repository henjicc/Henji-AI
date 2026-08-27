/** APIMart Kling 3.0 Omni 多模态视频模型（运行时契约） */

import { defineModel } from '../defineModel'
import type { JsonValue, JsonObject } from '../../types/runtime'

export const apimartKling30OmniModel = defineModel({
  meta: {
    id: 'apimart-kling-3.0-omni', canonicalModelId: 'kling-video-3.0-omni', seriesId: 'kling-video', seriesRank: 3.2,
    provider: 'apimart', type: 'video',
    tags: ['text-to-video', 'image-to-video', 'video-to-video', 'supports-video-editing', 'reference-mode', 'mixed-upload-mode', 'supports-audio-generation', 'supports-4k', 'provider-apimart'],
    aliases: ['kling-v3-omni-apimart'], polling: { interval: 3000, maxAttempts: 300, expectedAttempts: 80 }
  },
  inputLimits: {
    images: { max: 2 }, videos: { max: 1 },
    rules: [
      { when: 'apimartKling30OmniMode === "reference-to-video"', images: { max: 7 }, videos: { max: 1 } },
      { videoConstraints: { minDurationSec: 3, maxDurationSec: 10, maxSizeMB: 200, trim: { maxClipSeconds: 10 } } }
    ]
  },
  params: [
    {
      id: 'apimartKling30OmniMode', type: 'dropdown', order: 1,
      default: 'text-image-to-video',
      options: [
        { value: 'text-image-to-video' },
        { value: 'reference-to-video' }
      ]
    },
    {
      id: 'apimartKling30OmniAspectRatio', type: 'dropdown', order: 2,
      default: 'smart',
      options: [{ value: 'smart' }, ...['16:9', '9:16', '1:1'].map((ratio) => ({ value: ratio }))]
    },
    {
      id: 'apimartKling30OmniResolution', type: 'dropdown', order: 3,
      default: '720p',
      options: ['720p', '1080p', '4K'].map((value) => ({ value }))
    },
    {
      id: 'apimartKling30OmniDuration', type: 'number', order: 4,
      default: 5, min: 3, max: 15, step: 1
    },
    {
      id: 'apimartKling30OmniAudio', type: 'switch', order: 5,
      default: false
    },
    {
      id: 'apimartKling30OmniKeepOriginalSound', type: 'switch', order: 6,
      default: false
    },
    {
      id: 'apimartKling30OmniVideoReferenceType', type: 'dropdown', order: 7,
      default: 'base',
      options: [
        { value: 'base' },
        { value: 'feature' }
      ]
    }
  ],
  endpoints: '/v1/videos/generations',
  request: {
    builder: (params) => {
      const filterSources = (value: JsonValue): string[] => Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : []
      const pickSources = (primary: JsonValue, fallback: JsonValue): string[] => {
        const preferred = filterSources(primary)
        return preferred.length > 0 ? preferred : filterSources(fallback)
      }
      const images = pickSources(params.uploadedFilePaths, params.images)
      const videos = pickSources(params.uploadedVideoFilePaths, params.videos)
      const raw = String(params.apimartKling30OmniAspectRatio || 'smart')
      const resolution = String(params.apimartKling30OmniResolution || '720p')
      const body: JsonObject = {
        model: 'kling-v3-omni', prompt: typeof params.prompt === 'string' ? params.prompt : '',
        mode: resolution === '4K' ? '4k' : (resolution === '1080p' ? 'pro' : 'std'),
        duration: Math.min(15, Math.max(3, Math.round(Number(params.apimartKling30OmniDuration || 5)))),
        aspect_ratio: ['16:9', '9:16', '1:1'].includes(raw) ? raw : '16:9'
      }
      if (videos.length > 0) {
        const referenceType = params.apimartKling30OmniVideoReferenceType === 'feature' ? 'feature' : 'base'
        body.video_list = [{
          video_url: videos[0], refer_type: referenceType,
          keep_original_sound: params.apimartKling30OmniKeepOriginalSound === true ? 'yes' : 'no'
        }]
        if (referenceType === 'feature' && images.length > 0) body.image_urls = images.slice(0, 1)
      } else {
        if (images.length > 0) {
          if (params.apimartKling30OmniMode === 'reference-to-video') body.image_urls = images.slice(0, 7)
          else body.image_with_roles = images.slice(0, 2).map((url, index) => ({
            url,
            role: index === 0 ? 'first_frame' : 'last_frame'
          }))
        }
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
        : (resolution === '1080p' ? (hasVideo ? 0.1344 : (audio ? 0.112 : 0.0896)) : (hasVideo ? 0.1008 : (audio ? 0.0896 : 0.0672)))
      const sourceDuration = typeof params.__firstVideoDurationSeconds === 'number' && params.__firstVideoDurationSeconds > 0
        ? params.__firstVideoDurationSeconds
        : duration
      const billedDuration = hasVideo && params.apimartKling30OmniVideoReferenceType !== 'feature' ? sourceDuration : duration
      return billedDuration * rate
    },
    description: '基础每秒 720p $0.0672、1080p $0.0896、4K $0.42856；视频参考档为 720p $0.1008、1080p $0.1344，base 编辑按源视频时长计费'
  }
})

export default apimartKling30OmniModel
