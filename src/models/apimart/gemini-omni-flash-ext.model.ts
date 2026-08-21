/** APIMart Omni Flash Ext 多规格视频模型 */

import { defineModel, sharedFieldText } from '@/core'

export const apimartGeminiOmniFlashExtModel = defineModel({
  meta: {
    id: 'apimart-gemini-omni-flash-ext',
    canonicalModelId: 'gemini-omni-video',
    seriesId: 'gemini-omni',
    seriesRank: 1.1,
    provider: 'apimart',
    type: 'video',
    i18nScope: 'models.defs.apimart-gemini-omni-flash-ext',
    name: { key: 'meta.name', fallback: 'Gemini Omni Flash Ext' },
    tags: ['text-to-video', 'image-to-video', 'video-to-video', 'supports-multi-image', 'mixed-upload-mode', 'supports-4k', 'provider-apimart'],
    aliases: ['omni-flash-ext', 'gemini-omni-flash-ext-apimart'],
    polling: { interval: 5000, maxAttempts: 180, expectedAttempts: 60 }
  },
  inputLimits: { images: { max: 3 }, videos: { max: 1 } },
  params: [
    {
      id: 'apimartGeminiOmniFlashExtGenerationType',
      type: 'dropdown',
      order: 1,
      name: { zh: '图片生成方式', en: 'Image Generation Type' },
      default: 'reference',
      options: [
        { value: 'reference', label: { zh: '参考融合', en: 'Reference' } },
        { value: 'frame', label: { zh: '首帧动画', en: 'First Frame' } }
      ]
    },
    {
      id: 'apimartGeminiOmniFlashExtAspectRatio',
      type: 'dropdown',
      order: 2,
      name: sharedFieldText('aspectRatio'),
      default: '16:9',
      options: [{ value: '16:9', label: '16:9' }, { value: '9:16', label: '9:16' }]
    },
    {
      id: 'apimartGeminiOmniFlashExtResolution',
      type: 'dropdown',
      order: 3,
      name: sharedFieldText('resolution'),
      default: '720p',
      options: ['720p', '1080p', '4k'].map((value) => ({ value, label: value === '4k' ? '4K' : value }))
    },
    {
      id: 'apimartGeminiOmniFlashExtDuration',
      type: 'dropdown',
      order: 4,
      name: sharedFieldText('duration'),
      default: '6',
      options: ['4', '6', '8', '10'].map((value) => ({ value, label: `${value}s` }))
    }
  ],
  linkages: [],
  endpoints: '/v1/videos/generations',
  request: {
    builder: (params) => {
      const clean = (value: DynamicValue): string[] => Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : []
      const pick = (primary: DynamicValue, fallback: DynamicValue): string[] => {
        const preferred = clean(primary)
        return preferred.length > 0 ? preferred : clean(fallback)
      }
      const images = pick(params.uploadedFilePaths, params.images)
      const videos = pick(params.uploadedVideoFilePaths, params.videos)
      const prompt = typeof params.prompt === 'string' ? params.prompt.trim() : ''
      if (!prompt) throw new Error('Gemini Omni Flash Ext 的提示词不能为空')
      if (images.length === 2 || images.length > 3) {
        throw new Error('Gemini Omni Flash Ext 只支持 0、1 或 3 张图片')
      }
      const generationType = params.apimartGeminiOmniFlashExtGenerationType === 'frame' ? 'frame' : 'reference'
      if (generationType === 'frame' && images.length > 1) {
        throw new Error('Gemini Omni Flash Ext 的首帧模式只能传入 1 张图片')
      }
      const resolution = params.apimartGeminiOmniFlashExtResolution === '1080p' || params.apimartGeminiOmniFlashExtResolution === '4k'
        ? params.apimartGeminiOmniFlashExtResolution
        : '720p'
      const duration = ['4', '6', '8', '10'].includes(String(params.apimartGeminiOmniFlashExtDuration))
        ? Number(params.apimartGeminiOmniFlashExtDuration)
        : 6
      const body: DynamicValueMap = {
        model: 'Omni-Flash-Ext',
        prompt,
        resolution,
        aspect_ratio: params.apimartGeminiOmniFlashExtAspectRatio === '9:16' ? '9:16' : '16:9',
        nsfw_check: false
      }
      if (videos.length === 0) body.duration = duration
      if (images.length > 0) {
        body.generation_type = generationType
        body.image_urls = images
      }
      if (videos.length > 0) body.video_urls = videos.slice(0, 1)
      return body
    }
  },
  pricing: {
    currency: '$',
    calculator: (params) => {
      const resolution = params.apimartGeminiOmniFlashExtResolution === '4k' ? '4k' : 'standard'
      const hasVideo = (Array.isArray(params.uploadedVideoFilePaths) && params.uploadedVideoFilePaths.length > 0)
        || (Array.isArray(params.videos) && params.videos.length > 0)
      if (hasVideo) return resolution === '4k' ? 0.24 : 0.08
      const duration = ['4', '6', '8', '10'].includes(String(params.apimartGeminiOmniFlashExtDuration))
        ? String(params.apimartGeminiOmniFlashExtDuration)
        : '6'
      const standard: Record<string, number> = { '4': 0.25, '6': 0.3, '8': 0.35, '10': 0.4 }
      const high4k: Record<string, number> = { '4': 0.75, '6': 0.8, '8': 0.85, '10': 0.9 }
      return (resolution === '4k' ? high4k : standard)[duration]
    },
    description: '720p/1080p 按次 $0.25/$0.30/$0.35/$0.40（4/6/8/10s），4K 为 $0.75/$0.80/$0.85/$0.90；视频参考档为 $0.08，4K 为 $0.24'
  }
})

export default apimartGeminiOmniFlashExtModel
