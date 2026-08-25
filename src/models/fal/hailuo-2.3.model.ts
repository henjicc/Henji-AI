/**
 * Hailuo 2.3 视频生成模型
 */

import { defineModel, sharedFieldText } from '@/core'

export const hailuo23Model = defineModel({
  meta: {
    id: 'fal-ai-minimax-hailuo-2.3',
    canonicalModelId: 'hailuo-2.3',
    seriesId: 'hailuo',
    seriesRank: 2.3,
    provider: 'fal',
    type: 'video',
        i18nScope: 'models.defs.fal-ai-minimax-hailuo-2.3',
    name: { key: 'meta.name', fallback: 'MiniMax Hailuo 2.3' },
    tags: ['video', 'text-to-video', 'image-to-video'],
    aliases: ['fal-ai-hailuo-2.3', 'minimax-hailuo-2.3-fal']
  },
  inputLimits: {
    images: { max: 1 },
    videos: { max: 0 }
  },
  params: [
    {
      id: 'falHailuo23Version',
      order: 1,
      type: 'dropdown',
      name: sharedFieldText('version'),
      default: 'standard',
      options: [
        { value: 'standard', label: 'Standard' },
        { value: 'pro', label: 'Pro' }
      ]
    },
    {
      id: 'falHailuo23Duration',
      order: 2,
      type: 'dropdown',
      name: sharedFieldText('duration'),
      default: '6',
      options: [
        { value: '6', label: '6s' },
        { value: '10', label: '10s' }
      ]
    },
    {
      id: 'falHailuo23FastMode',
      order: 3,
      type: 'switch',
      name: sharedFieldText('fastMode'),
      default: true
    },
    {
      id: 'falHailuo23PromptOptimizer',
      order: 4,
      type: 'switch',
      name: sharedFieldText('promptOptimizer'),
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
      const version = params.falHailuo23Version || 'standard'
      const fastMode = params.falHailuo23FastMode !== false

      if (images.length > 0) {
        if (fastMode) {
          return version === 'pro'
            ? 'fal-ai/minimax/hailuo-2.3-fast/pro/image-to-video'
            : 'fal-ai/minimax/hailuo-2.3-fast/standard/image-to-video'
        }

        return version === 'pro'
          ? 'fal-ai/minimax/hailuo-2.3/pro/image-to-video'
          : 'fal-ai/minimax/hailuo-2.3/standard/image-to-video'
      }

      return version === 'pro'
        ? 'fal-ai/minimax/hailuo-2.3/pro/text-to-video'
        : 'fal-ai/minimax/hailuo-2.3/standard/text-to-video'
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
      const version = params.falHailuo23Version || 'standard'
      const duration = params.falHailuo23Duration || '6'
      const promptOptimizer = params.falHailuo23PromptOptimizer !== false

      const requestData: DynamicValue = { prompt }

      if (promptOptimizer !== undefined) {
        requestData.prompt_optimizer = promptOptimizer
      }

      if (version === 'standard') {
        requestData.duration = duration
      }

      if (images.length > 0) {
        requestData.image_url = images[0]
      }

      return requestData
    }
  },
  pricing: {
    currency: '$',
    calculator: (params) => {
      const duration = params.falHailuo23Duration === '10' ? 10 : 6
      const version = params.falHailuo23Version === 'pro' ? 'pro' : 'standard'
      const fastMode = params.falHailuo23FastMode !== false
      if (version === 'pro') return fastMode ? 0.33 : 0.49
      return fastMode
        ? (duration === 10 ? 0.32 : 0.19)
        : (duration === 10 ? 0.56 : 0.28)
    },
    description: 'Standard：6s $0.28、10s $0.56；Standard 快速：6s $0.19、10s $0.32；Pro：$0.49/次；Pro 快速：$0.33/次'
  }
})

export default hailuo23Model;
