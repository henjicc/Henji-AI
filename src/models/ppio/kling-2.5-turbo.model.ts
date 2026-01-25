/**
 * Kling 2.5 Turbo 视频生成模型
 *
 * 可灵 2.5 Turbo 版本，支持文生视频和图生视频
 */

import { defineModel } from '@/core'

export const kling25TurboModel = defineModel({
  meta: {
    id: 'ppio-kling-2.5-turbo',
    provider: 'ppio',
    type: 'video',
        i18nScope: 'models.defs.ppio-kling-2.5-turbo',
    name: 'Kling 2.5 Turbo',
    description: '可灵 2.5 Turbo 视频生成模型，支持文生视频和图生视频',
    tags: ['video', 'text-to-video', 'image-to-video']
  },
  inputLimits: {
    images: { max: 1 },
    videos: { max: 0 }
  },
  params: [
    // 1. 时长
    {
      id: 'ppioKling25TurboDuration',
      type: 'dropdown',
      order: 1,
      name: { key: 'auto.1', fallback: 'Duration' },
      default: 5,
      options: [
        { value: 5, label: '5秒' },
        { value: 10, label: '10秒' }
      ],
      apiField: 'duration'
    },
    // 2. 宽高比
    {
      id: 'ppioKling25TurboAspectRatio',
      type: 'dropdown',
      order: 2,
      name: { key: 'auto.2', fallback: 'Aspect Ratio' },
      default: '16:9',
      options: [
        { value: '16:9', label: '16:9 横屏' },
        { value: '9:16', label: '9:16 竖屏' },
        { value: '1:1', label: '1:1 方形' }
      ],
      apiField: 'aspect_ratio'
    },
    // 3. CFG Scale
    {
      id: 'ppioKling25TurboCfgScale',
      type: 'slider',
      order: 3,
      name: { key: 'auto.3', fallback: 'CFG Scale' },
      default: 0.5,
      min: 0,
      max: 1,
      step: 0.1,
      apiField: 'cfg_scale'
    },
    // 4. 模式
    {
      id: 'ppioKling25TurboMode',
      type: 'dropdown',
      order: 4,
      name: { key: 'auto.4', fallback: 'Generation Mode' },
      default: 'pro',
      options: [
        { value: 'pro', label: 'Pro 模式' }
      ],
      apiField: 'mode'
    },
    // 5. 负面提示词
    {
      id: 'ppioKling25TurboNegativePrompt',
      type: 'textarea',
      order: 5,
      name: { key: 'auto.5', fallback: 'Negative Prompt' },
      default: '',
      apiField: 'negative_prompt'
    }
  ],
  linkages: [],
  endpoints: {
    selector: async (params) => {
      const images = params.images || []
      return images.length > 0 ? '/async/kling-2.5-turbo-i2v' : '/async/kling-2.5-turbo-t2v'
    }
  },
  request: {
    builder: (params) => {
      const images = params.images || []
      const duration = params.ppioKling25TurboDuration || params.duration || 5
      const cfgScale = params.ppioKling25TurboCfgScale ?? params.cfg_scale ?? 0.5
      const mode = params.ppioKling25TurboMode || params.mode || 'pro'
      const prompt = (params.prompt || '').slice(0, 2500)
      const negativePrompt = params.ppioKling25TurboNegativePrompt
        ? String(params.ppioKling25TurboNegativePrompt).slice(0, 2500)
        : (params.negative_prompt ? String(params.negative_prompt).slice(0, 2500) : undefined)

      const requestData: any = {
        prompt,
        duration: String(duration),
        cfg_scale: cfgScale,
        mode
      }

      if (negativePrompt) {
        requestData.negative_prompt = negativePrompt
      }

      if (images.length > 0) {
        // 图生视频
        requestData.image = images[0]
      } else {
        // 文生视频
        const aspectRatio = params.ppioKling25TurboAspectRatio || params.aspect_ratio || '16:9'
        requestData.aspect_ratio = aspectRatio
      }

      return requestData
    }
  },
  pricing: {
    currency: '¥',
    calculator: (params) => {
      const duration = params.ppioKling25TurboDuration || 5
      const basePrice = 0.5
      const durationMultiplier = duration / 5
      return basePrice * durationMultiplier
    },
    description: '基础价格 ¥0.5/5秒'
  }
})

export default kling25TurboModel;
