/**
 * Wan 2.5 Preview 视频生成模型
 */

import { defineModel } from '@/core'

export const wan25PreviewModel = defineModel({
  meta: {
    id: 'fal-ai-wan-25-preview',
    provider: 'fal',
    type: 'video',
        i18nScope: 'models.defs.fal-ai-wan-25-preview',
    name: 'Wan 2.5 Preview',
    description: 'Wan 2.5 Preview 视频生成模型',
    tags: ['video', 'text-to-video', 'image-to-video'],
    aliases: ['fal-ai-wan-2.5-preview', 'wan-25-preview']
  },
  inputLimits: {
    images: { max: 1 },
    videos: { max: 0 }
  },
  params: [
    {
      id: 'falWan25VideoDuration',
      order: 1,
      type: 'dropdown',
      name: { key: 'auto.1', fallback: 'Duration' },
      default: 5,
      options: [
        { value: 5, label: '5s' },
        { value: 10, label: '10s' }
      ]
    },
    {
      id: 'falWan25AspectRatio',
      order: 2,
      type: 'dropdown',
      name: { key: 'auto.2', fallback: 'Aspect Ratio' },
      default: '16:9',
      options: [
        { value: '16:9', label: '16:9' },
        { value: '9:16', label: '9:16' },
        { value: '1:1', label: '1:1' }
      ]
    },
    {
      id: 'falWan25Resolution',
      order: 3,
      type: 'dropdown',
      name: { key: 'auto.3', fallback: 'Resolution' },
      default: '1080p',
      options: [
        { value: '480p', label: '480p' },
        { value: '720p', label: '720p' },
        { value: '1080p', label: '1080p' }
      ]
    },
    {
      id: 'falWan25PromptExpansion',
      order: 4,
      type: 'switch',
      name: { key: 'auto.4', fallback: 'Prompt Expansion' },
      default: true
    }
  ],
  linkages: [],
  endpoints: {
    selector: async (params) => {
      const images = params.images || []
      return images.length > 0
        ? 'fal-ai/wan-25-preview/image-to-video'
        : 'fal-ai/wan-25-preview/text-to-video'
    }
  },
  request: {
    builder: (params) => {
      const images = params.images || []
      const prompt = params.prompt || ''
      const duration = params.falWan25VideoDuration || 5
      const aspectRatio = params.falWan25AspectRatio
      const resolution = params.falWan25Resolution
      const promptExpansion = params.falWan25PromptExpansion

      const requestData: any = {
        prompt,
        enable_safety_checker: false,
        duration: `${duration}`
      }

      if (promptExpansion !== undefined) {
        requestData.enable_prompt_expansion = promptExpansion
      }

      if (images.length > 0) {
        requestData.image_url = images[0]
        if (resolution) {
          requestData.resolution = resolution.toLowerCase()
        }
      } else {
        if (aspectRatio && aspectRatio !== 'smart' && aspectRatio !== 'auto') {
          requestData.aspect_ratio = aspectRatio
        }
        if (resolution) {
          requestData.resolution = resolution.toLowerCase()
        }
      }

      return requestData
    }
  },
  pricing: {
    currency: '$',
    calculator: () => 0.13,
    description: '基础价格 $0.13/次'
  }
})

export default wan25PreviewModel;
