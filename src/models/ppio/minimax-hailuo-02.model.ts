/**
 * Minimax Hailuo 02 视频生成模型
 */

import { defineModel } from '@/core'
import { resolvePpioImageSources } from './mediaSources'

export const minimaxHailuo02Model = defineModel({
  meta: {
    id: 'ppio-minimax-hailuo-02',
    provider: 'ppio',
    type: 'video',
        i18nScope: 'models.defs.ppio-minimax-hailuo-02',
    name: { key: 'meta.name', fallback: 'Minimax Hailuo 02' },
    description: 'Minimax 海螺 02 视频生成模型',
    tags: ['video', 'text-to-video', 'image-to-video']
  },
  inputLimits: {
    images: { max: 2 },
    videos: { max: 0 }
  },
  params: [
    // 1. 时长
    {
      id: 'ppioHailuo02Duration',
      type: 'dropdown',
      order: 1,
      name: { key: 'auto.1', fallback: 'Duration' },
      default: 6,
      options: [
        { value: 6, label: '6s' },
        { value: 10, label: '10s' }
      ],
      apiField: 'duration'
    },
    // 2. 分辨率
    {
      id: 'ppioHailuo02Resolution',
      type: 'dropdown',
      order: 2,
      name: { key: 'auto.2', fallback: 'Resolution' },
      default: '768P',
      options: [
        { value: '768P', label: '768P' },
        { value: '1080P', label: '1080P' }
      ],
      apiField: 'resolution'
    },
    // 3. 提示词优化
    {
      id: 'ppioHailuo02PromptExtend',
      type: 'switch',
      order: 3,
      name: { key: 'auto.3', fallback: 'Prompt Optimizer' },
      default: true,
      apiField: 'enable_prompt_expansion'
    }
  ],
  linkages: [
    // Disable 1080P when duration is 10s
    {
      trigger: 'ppioHailuo02Duration',
      effect: 'filterOptions',
      target: 'ppioHailuo02Resolution',
      filter: (duration, options) => {
        if (duration === 10) {
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
      const images = resolvePpioImageSources(params)
      // Inline normalizeHailuo logic
      const durationInput = params.ppioHailuo02Duration || params.duration
      const duration = durationInput === 10 ? 10 : 6

      const resInput = (params.ppioHailuo02Resolution || params.resolution || '').toUpperCase()
      const resolution = duration === 10 ? '768P' : (resInput === '1080P' ? '1080P' : '768P')
      const enable = params.ppioHailuo02PromptExtend === undefined ? (params.enable_prompt_expansion === undefined ? true : params.enable_prompt_expansion) : params.ppioHailuo02PromptExtend
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
      const duration = params.ppioHailuo02Duration || 6
      const resolution = params.ppioHailuo02Resolution || '768P'
      const basePrice = 0.4
      const durationMultiplier = duration === 10 ? 10 / 6 : 1
      const resolutionMultiplier = resolution === '1080P' ? 1.5 : 1
      return basePrice * durationMultiplier * resolutionMultiplier
    },
    description: '基础价格 ¥0.4/6秒（768P），1080P价格1.5倍'
  }
})

export default minimaxHailuo02Model;
