/**
 * PixVerse V5.5 视频生成模型
 */

import { defineModel } from '@/core'

export const pixverseV55Model = defineModel({
  meta: {
    id: 'fal-ai-pixverse-v5.5',
    provider: 'fal',
    type: 'video',
        i18nScope: 'models.defs.fal-ai-pixverse-v5.5',
    name: { key: 'meta.name', fallback: 'PixVerse V5.5' },
    description: 'PixVerse V5.5 视频生成模型',
    tags: ['video', 'text-to-video', 'image-to-video']
  },
  inputLimits: {
    images: { max: 2 },
    videos: { max: 0 }
  },
  params: [
    {
      id: 'pixverseAspectRatio',
      order: 1,
      type: 'dropdown',
      name: { key: 'auto.1', fallback: 'Aspect Ratio' },
      default: '16:9',
      options: [
        { value: 'smart', label: { key: 'auto.2', fallback: 'Smart' } },
        { value: '16:9', label: '16:9' },
        { value: '4:3', label: '4:3' },
        { value: '1:1', label: '1:1' },
        { value: '3:4', label: '3:4' },
        { value: '9:16', label: '9:16' }
      ]
    },
    {
      id: 'pixverseResolution',
      order: 2,
      type: 'dropdown',
      name: { key: 'auto.3', fallback: 'Resolution' },
      default: '720p',
      options: [
        { value: '720p', label: '720p' },
        { value: '1080p', label: '1080p' }
      ]
    },
    {
      id: 'falPixverse55VideoDuration',
      order: 3,
      type: 'dropdown',
      name: { key: 'auto.4', fallback: 'Duration' },
      default: 5,
      options: [
        { value: 5, label: '5s' },
        { value: 10, label: '10s' }
      ]
    },
    {
      id: 'pixverseStyle',
      order: 4,
      type: 'dropdown',
      name: { key: 'auto.5', fallback: 'Style' },
      default: 'none',
      options: [
        { value: 'none', label: { key: 'auto.6', fallback: 'Default' } },
        { value: 'realistic', label: { key: 'auto.7', fallback: 'Realistic' } },
        { value: 'anime', label: { key: 'auto.8', fallback: 'Anime' } }
      ]
    },
    {
      id: 'pixverseThinkingType',
      order: 5,
      type: 'dropdown',
      name: { key: 'auto.9', fallback: 'Thinking Type' },
      default: 'normal',
      options: [
        { value: 'normal', label: { key: 'auto.10', fallback: 'Normal' } },
        { value: 'enhanced', label: { key: 'auto.11', fallback: 'Enhanced' } }
      ]
    },
    {
      id: 'pixverseGenerateAudio',
      order: 6,
      type: 'switch',
      name: { key: 'auto.12', fallback: 'Generate Audio' },
      default: false
    },
    {
      id: 'pixverseMultiClip',
      order: 7,
      type: 'switch',
      name: { key: 'auto.13', fallback: 'Multi Clip' },
      default: false
    }
  ],
  linkages: [],
  endpoints: {
    selector: async (params) => {
      const images = params.images || []
      if (images.length === 0) {
        return 'fal-ai/pixverse/v5.5/text-to-video'
      }
      if (images.length === 1) {
        return 'fal-ai/pixverse/v5.5/image-to-video'
      }
      return 'fal-ai/pixverse/v5.5/transition'
    }
  },
  request: {
    builder: (params) => {
      const images = params.images || []
      const prompt = params.prompt || ''
      const aspectRatio = params.pixverseAspectRatio
      const resolution = params.pixverseResolution
      const duration = params.falPixverse55VideoDuration || 5

      const requestData: any = { prompt }

      if (aspectRatio && aspectRatio !== 'smart' && aspectRatio !== 'auto') {
        requestData.aspect_ratio = aspectRatio
      }

      if (resolution) {
        requestData.resolution = resolution
      }

      requestData.duration = String(duration)

      if (params.pixverseStyle && params.pixverseStyle !== 'none') {
        requestData.style = params.pixverseStyle
      }

      if (params.pixverseThinkingType) {
        requestData.thinking_type = params.pixverseThinkingType
      }

      if (params.pixverseGenerateAudio !== undefined) {
        requestData.generate_audio_switch = params.pixverseGenerateAudio
      }

      if (params.pixverseMultiClip !== undefined) {
        requestData.generate_multi_clip_switch = params.pixverseMultiClip
      }

      if (images.length === 1) {
        requestData.image_url = images[0]
      } else if (images.length >= 2) {
        requestData.first_image_url = images[0]
        requestData.end_image_url = images[1]
      }

      return requestData
    }
  },
  pricing: {
    currency: '$',
    calculator: () => 0.09,
    description: '基础价格 $0.09/次'
  }
})

export default pixverseV55Model;
