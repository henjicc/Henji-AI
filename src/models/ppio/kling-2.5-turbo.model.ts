/**
 * Kling 2.5 Turbo 视频生成模型
 *
 * 可灵 2.5 Turbo 版本，支持文生视频和图生视频
 */

import { defineModel, sharedFieldText } from '@/core'
import { resolvePpioImageSources } from './mediaSources'

export const kling25TurboModel = defineModel({
  meta: {
    id: 'ppio-kling-2.5-turbo',
    seriesId: 'kling-video',
    seriesRank: 2.5,
    provider: 'ppio',
    type: 'video',
        i18nScope: 'models.defs.ppio-kling-2.5-turbo',
    name: { key: 'meta.name', fallback: 'Kling 2.5 Turbo' },
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
      name: sharedFieldText('duration'),
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
      name: sharedFieldText('aspectRatio'),
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
      type: 'number',
      order: 3,
      name: sharedFieldText('cfgScale'),
      default: 0.5,
      min: 0,
      max: 1,
      step: 0.1,
      apiField: 'cfg_scale'
    }
  ],
  linkages: [],
  endpoints: {
    selector: async (params) => {
      const images = resolvePpioImageSources(params)
      return images.length > 0 ? '/async/kling-2.5-turbo-i2v' : '/async/kling-2.5-turbo-t2v'
    }
  },
  request: {
    builder: (params) => {
      const images = resolvePpioImageSources(params)
      const duration = params.ppioKling25TurboDuration || params.duration || 5
      const cfgScale = params.ppioKling25TurboCfgScale ?? params.cfg_scale ?? 0.5
      const prompt = (params.prompt || '').slice(0, 2500)

      const requestData: DynamicValue = {
        prompt,
        duration: String(duration),
        cfg_scale: cfgScale,
        mode: 'pro'
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
