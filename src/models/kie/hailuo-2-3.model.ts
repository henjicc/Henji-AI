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
        i18nScope: 'models.defs.kie-hailuo-2-3',
    name: { key: 'meta.name', fallback: 'Hailuo 2.3' },
    description: { key: 'meta.description', fallback: 'KIE Hailuo 2.3 image-to-video model' },
    tags: ['image-to-video', 'provider-kie'],
    aliases: ['hailuo-2-3-kie'],
    polling: {
      interval: 3000,
      maxAttempts: 120,
      expectedAttempts: 40
    }
  },
  inputLimits: {
    images: { exact: 1 },
    videos: { max: 0 }
  },
  requirements: [
    {
      id: 'hailuo-2-3-image',
      require: { images: { exact: 1 } },
      message: {
        title: '图片必需',
        message: '海螺 2.3 是图生视频模型，必须上传1张图片才能生成',
        type: 'warning'
      }
    },
    {
      id: 'hailuo-2-3-prompt',
      require: { prompt: true },
      message: {
        title: '提示词必需',
        message: '请输入提示词描述期望的视频效果',
        type: 'warning'
      }
    }
  ],
  params: [
    {
      id: 'kieHailuo23Mode',
      type: 'dropdown',
      order: 1,
      name: { key: 'auto.1', fallback: 'Mode' },
      default: 'standard',
      options: [
        { value: 'standard', label: { key: 'auto.2', fallback: 'Standard' } },
        { value: 'pro', label: { key: 'auto.3', fallback: 'Pro' } }
      ]
    },
    {
      id: 'kieHailuo23Duration',
      type: 'dropdown',
      order: 2,
      name: { key: 'auto.4', fallback: 'Duration' },
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
      name: { key: 'auto.5', fallback: 'Resolution' },
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
