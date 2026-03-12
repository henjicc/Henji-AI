/**
 * Sora 2 视频生成模型
 */

import { defineModel } from '@/core'

export const sora2Model = defineModel({
  meta: {
    id: 'fal-ai-sora-2',
    provider: 'fal',
    type: 'video',
        i18nScope: 'models.defs.fal-ai-sora-2',
    name: { key: 'meta.name', fallback: 'Sora 2' },
    description: 'Sora 2 视频生成模型',
    tags: ['video', 'text-to-video', 'image-to-video']
  },
  inputLimits: {
    images: { max: 1 },
    videos: { max: 0 }
  },
  params: [
    {
      id: 'falSora2Mode',
      order: 1,
      type: 'dropdown',
      name: { key: 'auto.1', fallback: 'Mode' },
      default: 'standard',
      options: [
        { value: 'standard', label: { key: 'auto.2', fallback: 'Standard' } },
        { value: 'pro', label: { key: 'auto.3', fallback: 'Pro' } }
      ]
    },
    {
      id: 'falSora2Duration',
      order: 2,
      type: 'dropdown',
      name: { key: 'auto.4', fallback: 'Duration' },
      default: 4,
      options: [
        { value: 4, label: '4s' },
        { value: 6, label: '6s' },
        { value: 8, label: '8s' }
      ]
    },
    {
      id: 'falSora2AspectRatio',
      order: 3,
      type: 'dropdown',
      name: { key: 'auto.5', fallback: 'Aspect Ratio' },
      default: '16:9',
      options: [
        { value: 'smart', label: { key: 'auto.6', fallback: 'Smart' } },
        { value: 'auto', label: { key: 'auto.7', fallback: 'Auto' } },
        { value: '16:9', label: '16:9' },
        { value: '9:16', label: '9:16' }
      ]
    },
    {
      id: 'falSora2Resolution',
      order: 4,
      type: 'dropdown',
      name: { key: 'auto.8', fallback: 'Resolution' },
      default: '720p',
      options: [
        { value: '720p', label: '720p' },
        { value: '1080p', label: '1080p' }
      ]
    }
  ],
  linkages: [],
  endpoints: {
    selector: async (params) => {
      const images = params.images || []
      const mode = params.falSora2Mode || 'standard'

      if (images.length > 0) {
        return mode === 'pro'
          ? 'fal-ai/sora-2/image-to-video/pro'
          : 'fal-ai/sora-2/image-to-video'
      }

      return mode === 'pro'
        ? 'fal-ai/sora-2/text-to-video/pro'
        : 'fal-ai/sora-2/text-to-video'
    }
  },
  request: {
    builder: (params) => {
      const images = params.images || []
      const prompt = params.prompt || ''
      const duration = params.falSora2Duration || 4
      const aspectRatio = params.falSora2AspectRatio
      const resolution = params.falSora2Resolution

      const requestData: any = {
        prompt,
        duration,
        delete_video: true
      }

      if (images.length > 0) {
        if (aspectRatio && aspectRatio !== 'smart') {
          requestData.aspect_ratio = aspectRatio
        }
        if (resolution) {
          requestData.resolution = resolution
        }
        requestData.image_url = images[0]
      } else {
        const safeAspect = aspectRatio && aspectRatio !== 'smart' && aspectRatio !== 'auto'
          ? aspectRatio
          : '16:9'
        requestData.aspect_ratio = safeAspect
        requestData.resolution = resolution || '720p'
      }

      return requestData
    }
  },
  pricing: {
    currency: '$',
    calculator: () => 0.2,
    description: '基础价格 $0.2/次'
  }
})

export default sora2Model;
