/**
 * KIE Hailuo 2.3 图生视频模型
 */

import { defineModel } from '@/core'

const KIE_CREATE_TASK_ENDPOINT = '/api/v1/jobs/createTask'

export const kieHailuo23Model = defineModel({
  meta: {
    id: 'kie-hailuo-2-3',
    provider: 'kie',
    type: 'video',
    name: { zh: '海螺 2.3', en: 'Hailuo 2.3' },
    description: { zh: 'KIE Hailuo 2.3 图生视频模型', en: 'KIE Hailuo 2.3 image-to-video model' },
    tags: ['image-to-video', 'provider-kie'],
    aliases: ['hailuo-2-3-kie'],
    polling: {
      interval: 3000,
      maxAttempts: 120,
      expectedAttempts: 40
    }
  },
  params: [
    {
      id: 'kieHailuo23Mode',
      type: 'dropdown',
      order: 1,
      name: { zh: '模式', en: 'Mode' },
      default: 'standard',
      options: [
        { value: 'standard', label: { zh: '标准', en: 'Standard' } },
        { value: 'pro', label: { zh: '专业', en: 'Pro' } }
      ]
    },
    {
      id: 'kieHailuo23Duration',
      type: 'dropdown',
      order: 2,
      name: { zh: '时长', en: 'Duration' },
      default: 6,
      options: [
        { value: 6, label: '6s' },
        { value: 10, label: '10s' }
      ]
    },
    {
      id: 'kieHailuo23Resolution',
      type: 'dropdown',
      order: 3,
      name: { zh: '分辨率', en: 'Resolution' },
      default: '768P',
      options: [
        { value: '768P', label: '768P' },
        { value: '1080P', label: '1080P' }
      ]
    }
  ],
  linkages: [
    {
      trigger: ['kieHailuo23Duration', 'kieHailuo23Resolution'],
      effect: 'autoSwitch',
      target: 'kieHailuo23Resolution',
      condition: (_: unknown, allParams: Record<string, unknown>) => {
        return allParams.kieHailuo23Duration === 10 && allParams.kieHailuo23Resolution === '1080P'
      },
      value: '768P'
    }
  ],
  endpoints: KIE_CREATE_TASK_ENDPOINT,
  request: {
    builder: (params) => {
      const images = params.images || []
      const prompt = params.prompt || ''
      const mode = params.kieHailuo23Mode || params.mode || 'standard'
      const duration = params.kieHailuo23Duration || params.duration || 6
      const resolution = params.kieHailuo23Resolution || params.resolution || '768P'

      const model = mode === 'pro'
        ? 'hailuo/2-3-image-to-video-pro'
        : 'hailuo/2-3-image-to-video-standard'

      return {
        model,
        input: {
          prompt,
          image_url: images.length > 0 ? images[0] : '',
          duration: String(duration),
          resolution
        }
      }
    }
  },
  pricing: {
    currency: '¥',
    calculator: () => 0.12,
    description: '基础价格 ¥0.12/次'
  }
})

export default kieHailuo23Model
