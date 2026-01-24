/**
 * Minimax Hailuo 2.3 视频生成模型
 *
 * Minimax 海螺 2.3 视频生成模型，支持文生视频和图生视频
 */

import { defineModel } from '@/core'

export const minimaxHailuo23Model = defineModel({
  meta: {
    id: 'minimax-hailuo-2.3',
    provider: 'ppio',
    type: 'video',
    name: 'Minimax Hailuo 2.3',
    description: 'Minimax 海螺 2.3 视频生成模型，支持文生视频和图生视频',
    tags: ['video', 'text-to-video', 'image-to-video']
  },
  inputLimits: {
    images: { max: 1 },
    videos: { max: 0 }
  },
  params: [
    // 1. 时长
    {
      id: 'ppioHailuo23VideoDuration',
      type: 'dropdown',
      order: 1,
      name: { zh: '时长', en: 'Duration' },
      default: 6,
      options: [
        { value: 6, label: '6s' },
        { value: 10, label: '10s' }
      ],
      apiField: 'duration'
    },
    // 2. 分辨率
    {
      id: 'ppioHailuo23VideoResolution',
      type: 'dropdown',
      order: 2,
      name: { zh: '分辨率', en: 'Resolution' },
      default: '768P',
      options: [
        { value: '768P', label: '768P' },
        { value: '1080P', label: '1080P' }
      ],
      apiField: 'resolution'
    },
    // 3. 快速模式（仅图生视频）
    {
      id: 'ppioHailuo23FastMode',
      type: 'switch',
      order: 3,
      name: { zh: '快速模式', en: 'Fast Mode' },
      default: false,
      apiField: 'fast_mode'
    },
    // 4. 提示词扩展
    {
      id: 'ppioHailuo23PromptExtend',
      type: 'switch',
      order: 4,
      name: { zh: '提示词扩展', en: 'Prompt Extension' },
      default: true,
      apiField: 'enable_prompt_expansion'
    }
  ],
  linkages: [
    // Hide fast mode when no images uploaded
    {
      trigger: 'uploadedImages',
      effect: 'hide',
      targets: ['ppioHailuo23FastMode'],
      condition: (images) => (images?.length || 0) === 0
    },
    // Disable 1080P when duration is 10s
    {
      trigger: 'ppioHailuo23VideoDuration',
      effect: 'filterOptions',
      target: 'ppioHailuo23VideoResolution',
      filter: (duration, options) => {
        if (duration === 10) {
          return options.filter(opt => opt.value !== '1080P')
        }
        return options
      }
    },
    // Auto-switch to 768P if 1080P is selected and duration changes to 10s
    {
      trigger: 'ppioHailuo23VideoDuration',
      effect: 'autoSwitch',
      target: 'ppioHailuo23VideoResolution',
      condition: (duration, allParams) => {
        const resolution = allParams.ppioHailuo23VideoResolution
        return duration === 10 && resolution === '1080P'
      },
      value: '768P'
    }
  ],
  endpoints: {
    selector: async (params) => {
      const images = params.images || []
      const isFast = params.ppioHailuo23FastMode && images.length > 0

      if (images.length > 0) {
        return isFast ? '/async/minimax-hailuo-2.3-fast-i2v' : '/async/minimax-hailuo-2.3-i2v'
      } else {
        return '/async/minimax-hailuo-2.3-t2v'
      }
    }
  },
  request: {
    builder: (params) => {
      const images = params.images || []
      const durationInput = params.ppioHailuo23VideoDuration || params.duration
      const duration = durationInput === 10 ? 10 : 6

      const resInput = (params.ppioHailuo23VideoResolution || params.resolution || '').toUpperCase()
      const resolution = duration === 10 ? '768P' : (resInput === '1080P' ? '1080P' : '768P')
      const enable = params.ppioHailuo23PromptExtend === undefined ? (params.enable_prompt_expansion === undefined ? true : params.enable_prompt_expansion) : params.ppioHailuo23PromptExtend
      const prompt = params.prompt || ''

      const requestData: any = {
        prompt,
        duration,
        resolution,
        enable_prompt_expansion: enable
      }

      if (images.length > 0) {
        requestData.image = images[0]
      }

      return requestData
    }
  },
  pricing: {
    currency: '¥',
    calculator: (params) => {
      const duration = params.ppioHailuo23VideoDuration || 6
      const resolution = params.ppioHailuo23VideoResolution || '768P'
      const basePrice = 0.4
      const durationMultiplier = duration / 6
      const resolutionMultiplier = resolution === '1080P' ? 1.5 : 1
      return basePrice * durationMultiplier * resolutionMultiplier
    },
    description: '基础价格 ¥0.4/6秒（768P），1080P价格1.5倍'
  }
})

export default minimaxHailuo23Model;
