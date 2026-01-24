/**
 * PixVerse V5.5 视频生成模型
 */

import { defineModel } from '@/core'

export const pixverseV55Model = defineModel({
  meta: {
    id: 'fal-ai-pixverse-v5.5',
    provider: 'fal',
    type: 'video',
    name: 'PixVerse V5.5',
    description: 'PixVerse V5.5 视频生成模型',
    tags: ['video', 'text-to-video', 'image-to-video']
  },
  params: [
    {
      id: 'pixverseAspectRatio',
      order: 1,
      type: 'dropdown',
      name: { zh: '比例', en: 'Aspect Ratio' },
      default: '16:9',
      options: [
        { value: 'smart', label: { zh: '智能', en: 'Smart' } },
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
      name: { zh: '分辨率', en: 'Resolution' },
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
      name: { zh: '时长', en: 'Duration' },
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
      name: { zh: '风格', en: 'Style' },
      default: 'none',
      options: [
        { value: 'none', label: { zh: '默认', en: 'Default' } },
        { value: 'realistic', label: { zh: '写实', en: 'Realistic' } },
        { value: 'anime', label: { zh: '动漫', en: 'Anime' } }
      ]
    },
    {
      id: 'pixverseThinkingType',
      order: 5,
      type: 'dropdown',
      name: { zh: '思考模式', en: 'Thinking Type' },
      default: 'normal',
      options: [
        { value: 'normal', label: { zh: 'Normal', en: 'Normal' } },
        { value: 'enhanced', label: { zh: 'Enhanced', en: 'Enhanced' } }
      ]
    },
    {
      id: 'pixverseGenerateAudio',
      order: 6,
      type: 'switch',
      name: { zh: '生成音频', en: 'Generate Audio' },
      default: false
    },
    {
      id: 'pixverseMultiClip',
      order: 7,
      type: 'switch',
      name: { zh: '多镜头', en: 'Multi Clip' },
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
