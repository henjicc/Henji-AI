/**
 * Hailuo 02 视频生成模型
 */

import { defineModel, sharedFieldText } from '@/core'

export const hailuo02Model = defineModel({
  meta: {
    id: 'fal-ai-minimax-hailuo-02',
    provider: 'fal',
    type: 'video',
        i18nScope: 'models.defs.fal-ai-minimax-hailuo-02',
    name: { key: 'meta.name', fallback: 'MiniMax Hailuo 02' },
    description: 'MiniMax Hailuo 02 视频生成模型',
    tags: ['video', 'text-to-video', 'image-to-video'],
    aliases: ['fal-ai-hailuo-02', 'minimax-hailuo-02-fal']
  },
  inputLimits: {
    images: { max: 2 },
    videos: { max: 0 },
    rules: [
      {
        when: 'falHailuo02FastMode === true',
        images: { max: 1 }
      }
    ]
  },
  params: [
    {
      id: 'falHailuo02Version',
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
      id: 'falHailuo02Duration',
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
      id: 'falHailuo02Resolution',
      order: 3,
      type: 'dropdown',
      name: sharedFieldText('resolution'),
      default: '768P',
      options: [
        { value: '512P', label: '512P' },
        { value: '768P', label: '768P' },
        { value: '1080P', label: '1080P' }
      ]
    },
    {
      id: 'falHailuo02FastMode',
      order: 4,
      type: 'switch',
      name: sharedFieldText('fastMode'),
      default: false
    },
    {
      id: 'falHailuo02PromptOptimizer',
      order: 5,
      type: 'switch',
      name: sharedFieldText('promptOptimizer'),
      default: true
    }
  ],
  linkages: [],
  endpoints: {
    selector: async (params) => {
      const images = params.images || []
      const imageCount = images.length
      const version = params.falHailuo02Version || 'standard'
      const fastMode = params.falHailuo02FastMode === true

      if (imageCount === 0) {
        return version === 'pro'
          ? 'fal-ai/minimax/hailuo-02/pro/text-to-video'
          : 'fal-ai/minimax/hailuo-02/standard/text-to-video'
      }

      if (imageCount === 1 && fastMode) {
        return 'fal-ai/minimax/hailuo-02-fast/image-to-video'
      }

      if (version === 'pro') {
        return 'fal-ai/minimax/hailuo-02/pro/image-to-video'
      }

      return 'fal-ai/minimax/hailuo-02/standard/image-to-video'
    }
  },
  request: {
    builder: (params) => {
      const images = params.images || []
      const prompt = params.prompt || ''
      const version = params.falHailuo02Version || 'standard'
      const resolution = params.falHailuo02Resolution || '768P'
      const duration = params.falHailuo02Duration || '6'
      const promptOptimizer = params.falHailuo02PromptOptimizer !== false

      const requestData: DynamicValue = { prompt }

      if (promptOptimizer !== undefined) {
        requestData.prompt_optimizer = promptOptimizer
      }

      if (version === 'standard') {
        requestData.duration = duration
      }

      if (version === 'standard' && images.length > 0 && params.falHailuo02FastMode !== true) {
        requestData.resolution = resolution
      }

      if (images.length === 1) {
        requestData.image_url = images[0]
      } else if (images.length >= 2) {
        requestData.first_frame_image_url = images[0]
        requestData.last_frame_image_url = images[1]
      }

      return requestData
    }
  },
  pricing: {
    currency: '$',
    calculator: () => 0.1,
    description: '基础价格 $0.1/次'
  }
})

export default hailuo02Model;
