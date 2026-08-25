/**
 * Wan 2.5 Preview 视频生成模型
 */

import { defineModel, sharedFieldText } from '@/core'

export const wan25PreviewModel = defineModel({
  meta: {
    id: 'fal-ai-wan-25-preview',
    canonicalModelId: 'wan-2.5-preview',
    seriesId: 'wan',
    seriesRank: 2.5,
    provider: 'fal',
    type: 'video',
        i18nScope: 'models.defs.fal-ai-wan-25-preview',
    name: { key: 'meta.name', fallback: 'Wan 2.5 Preview' },
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
      name: sharedFieldText('duration'),
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
      name: sharedFieldText('aspectRatio'),
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
      name: sharedFieldText('resolution'),
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
      name: sharedFieldText('promptExpansion'),
      default: true
    }
  ],
  linkages: [],
  endpoints: {
    selector: async (params) => {
      const filterSources = (value: DynamicValue): string[] =>
        Array.isArray(value)
          ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
          : []
      const uploaded = filterSources(params.uploadedFilePaths)
      const images = uploaded.length > 0 ? uploaded : filterSources(params.images)
      return images.length > 0
        ? 'fal-ai/wan-25-preview/image-to-video'
        : 'fal-ai/wan-25-preview/text-to-video'
    }
  },
  request: {
    builder: (params) => {
      const filterSources = (value: DynamicValue): string[] =>
        Array.isArray(value)
          ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
          : []
      const uploaded = filterSources(params.uploadedFilePaths)
      const images = uploaded.length > 0 ? uploaded : filterSources(params.images)
      const prompt = params.prompt || ''
      const duration = params.falWan25VideoDuration || 5
      const aspectRatio = params.falWan25AspectRatio
      const resolution = params.falWan25Resolution
      const promptExpansion = params.falWan25PromptExpansion

      const requestData: DynamicValue = {
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
    calculator: (params) => {
      const duration = Number(params.falWan25VideoDuration) || 5
      const rate: Record<string, number> = { '480p': 0.05, '720p': 0.1, '1080p': 0.15 }
      return (rate[params.falWan25Resolution as string] ?? rate['1080p']) * duration
    },
    description: '480P $0.05/秒，720P $0.10/秒，1080P $0.15/秒'
  }
})

export default wan25PreviewModel;
