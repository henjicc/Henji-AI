/**
 * Minimax Hailuo 02 视频生成模型
 */

import { defineModel } from '@/core'
import { normalizeHailuo } from './utils'

export const minimaxHailuo02Model = defineModel({
  meta: {
    id: 'minimax-hailuo-02',
    provider: 'ppio',
    type: 'video',
    name: 'Minimax Hailuo 02',
    description: 'Minimax 海螺 02 视频生成模型',
    tags: ['video', 'text-to-video', 'image-to-video']
  },
  params: [
    // 1. 时长
    {
      id: 'falHailuo02Duration',
      type: 'dropdown',
      order: 1,
      name: { zh: '时长', en: 'Duration' },
      default: '6',
      options: [
        { value: '6', label: '6s' },
        { value: '10', label: '10s' }
      ],
      apiField: 'duration'
    },
    // 2. 分辨率
    {
      id: 'falHailuo02Resolution',
      type: 'dropdown',
      order: 2,
      name: { zh: '分辨率', en: 'Resolution' },
      default: '768P',
      options: [
        { value: '512P', label: '512P' },
        { value: '768P', label: '768P' },
        { value: '1080P', label: '1080P' }
      ],
      apiField: 'resolution'
    },
    // 3. 快速模式
    {
      id: 'falHailuo02FastMode',
      type: 'switch',
      order: 3,
      name: { zh: '快速模式', en: 'Fast Mode' },
      default: false,
      apiField: 'fast_mode'
    },
    // 4. 提示词优化
    {
      id: 'falHailuo02PromptOptimizer',
      type: 'switch',
      order: 4,
      name: { zh: '提示词优化', en: 'Prompt Optimizer' },
      default: true,
      apiField: 'enable_prompt_expansion'
    }
  ],
  linkages: [
    // Hide fast mode when not exactly 1 image
    {
      trigger: 'uploadedImages',
      effect: 'hide',
      targets: ['falHailuo02FastMode'],
      condition: (images) => (images?.length || 0) !== 1
    },
    // Disable 1080P when duration is 10s
    {
      trigger: 'falHailuo02Duration',
      effect: 'filterOptions',
      target: 'falHailuo02Resolution',
      filter: (duration, options) => {
        if (duration === '10') {
          return options.filter(opt => opt.value !== '1080P')
        }
        return options
      }
    }
  ],
  endpoints: {
    selector: async (params) => {
      return '/async/minimax-hailuo-02'
    }
  },
  request: {
    builder: (params) => {
      const images = params.images || []
      const { duration, resolution } = normalizeHailuo(
        parseInt(params.duration || '6'),
        params.resolution
      )
      const enable = params.enable_prompt_expansion === undefined ? true : params.enable_prompt_expansion
      const prompt = params.prompt || ''

      const requestData: any = {
        prompt,
        duration,
        resolution,
        enable_prompt_expansion: enable
      }

      if (images.length >= 2) {
        requestData.image = images[0]
        requestData.end_image = images[1]
      } else if (images.length === 1) {
        requestData.image = images[0]
      }

      return requestData
    }
  },
  pricing: {
    currency: '¥',
    calculator: (params) => {
      const duration = params.falHailuo02Duration || '6'
      const resolution = params.falHailuo02Resolution || '768P'
      const basePrice = 0.4
      const durationMultiplier = duration === '10' ? 10 / 6 : 1
      const resolutionMultiplier = resolution === '1080P' ? 1.5 : 1
      return basePrice * durationMultiplier * resolutionMultiplier
    },
    description: '基础价格 ¥0.4/6秒（768P），1080P价格1.5倍'
  }
})

export default minimaxHailuo02Model;
