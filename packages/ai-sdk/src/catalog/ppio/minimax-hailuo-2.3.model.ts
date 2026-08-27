/**
 * Minimax Hailuo 2.3 视频生成模型（运行时契约）
 *
 * Minimax 海螺 2.3 视频生成模型，支持文生视频和图生视频
 */

import { defineModel } from '../defineModel'
import { hasUploadedImage, resolvePpioImageSources } from './mediaSources'
import type { JsonObject } from '../../types/runtime'

export const minimaxHailuo23Model = defineModel({
  meta: {
    id: 'ppio-minimax-hailuo-2.3',
    canonicalModelId: 'hailuo-2.3',
    seriesId: 'hailuo',
    seriesRank: 2.3,
    provider: 'ppio',
    type: 'video',
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
      default: 6,
      options: [
        { value: 6 },
        { value: 10 }
      ],
      apiField: 'duration'
    },
    // 2. 分辨率
    {
      id: 'ppioHailuo23VideoResolution',
      type: 'dropdown',
      order: 2,
      default: '768P',
      options: [
        { value: '768P' },
        { value: '1080P' }
      ],
      apiField: 'resolution'
    },
    // 3. 快速模式（仅图生视频）
    {
      id: 'ppioHailuo23FastMode',
      type: 'switch',
      order: 3,
      default: false,
      apiField: 'fast_mode'
    },
    // 4. 提示词扩展
    {
      id: 'ppioHailuo23PromptExtend',
      type: 'switch',
      order: 4,
      default: true,
      apiField: 'enable_prompt_expansion'
    }
  ],
  endpoints: {
    selector: async (params) => {
      const images = resolvePpioImageSources(params)
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
      const images = resolvePpioImageSources(params)
      const durationInput = params.ppioHailuo23VideoDuration || params.duration
      const duration = durationInput === 10 ? 10 : 6

      const resInput = String(params.ppioHailuo23VideoResolution || params.resolution || '').toUpperCase()
      const resolution = duration === 10 ? '768P' : (resInput === '1080P' ? '1080P' : '768P')
      const enable = params.ppioHailuo23PromptExtend === undefined ? (params.enable_prompt_expansion === undefined ? true : params.enable_prompt_expansion) : params.ppioHailuo23PromptExtend
      const prompt = typeof params.prompt === 'string' ? params.prompt : ''

      const requestData: JsonObject = {
        prompt,
        duration,
        resolution,
        enable_prompt_expansion: (enable ?? true) as boolean
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
      const duration = params.ppioHailuo23VideoDuration === 10 ? 10 : 6
      // 10 秒档固定回落到 768P（与 builder 的分辨率强制规则一致），1080P 只在 6 秒档存在
      const resolution = duration === 10
        ? '768P'
        : (params.ppioHailuo23VideoResolution === '1080P' ? '1080P' : '768P')
      const isFast = params.ppioHailuo23FastMode === true && hasUploadedImage(params)
      const standardPrices: Record<string, number> = { '6-768P': 2.0, '10-768P': 4.0, '6-1080P': 3.5 }
      const fastPrices: Record<string, number> = { '6-768P': 1.35, '10-768P': 2.25, '6-1080P': 2.3 }
      const key = `${duration}-${resolution}`
      return (isFast ? fastPrices : standardPrices)[key] ?? standardPrices['6-768P']
    },
    description: '标准：6s768P ¥2、10s768P ¥4、6s1080P ¥3.5；快速模式（仅图生视频）：6s768P ¥1.35、10s768P ¥2.25、6s1080P ¥2.3'
  }
})

export default minimaxHailuo23Model
