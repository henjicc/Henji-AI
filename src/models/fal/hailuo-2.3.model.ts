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
      const images = params.images || []
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
      const images = params.images || []
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
    calculator: () => 0.08,
    description: '基础价格 $0.08/次'
  }
})

export default hailuo23Model;
