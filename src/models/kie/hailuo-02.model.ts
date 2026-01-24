/**
 * KIE Hailuo 02 视频生成模型
 */

import { defineModel } from '@/core'

const KIE_CREATE_TASK_ENDPOINT = '/api/v1/jobs/createTask'

export const kieHailuo02Model = defineModel({
  meta: {
    id: 'kie-hailuo-02',
    provider: 'kie',
    type: 'video',
    name: { zh: '海螺 02', en: 'Hailuo 02' },
    description: { zh: 'KIE Hailuo 02 视频生成模型', en: 'KIE Hailuo 02 video generation model' },
    tags: ['text-to-video', 'image-to-video', 'provider-kie'],
    aliases: ['hailuo-02-kie'],
    polling: {
      interval: 3000,
      maxAttempts: 120,
      expectedAttempts: 40
    }
  },
  params: [
    {
      id: 'kieHailuo02Duration',
      type: 'dropdown',
      order: 1,
      name: { zh: '时长', en: 'Duration' },
      default: 6,
      options: [
        { value: 6, label: '6s' },
        { value: 10, label: '10s' }
      ]
    },
    {
      id: 'kieHailuo02Resolution',
      type: 'dropdown',
      order: 2,
      name: { zh: '分辨率', en: 'Resolution' },
      default: '768P',
      options: [
        { value: '512P', label: '512P' },
        { value: '768P', label: '768P' },
        { value: '1080P', label: '1080P' }
      ]
    },
    {
      id: 'kieHailuo02PromptOptimizer',
      type: 'switch',
      order: 3,
      name: { zh: '提示词优化', en: 'Prompt Optimizer' },
      default: true
    }
  ],
  linkages: [
    {
      trigger: ['kieHailuo02Resolution', 'kieHailuo02Duration'],
      effect: 'autoSwitch',
      target: 'kieHailuo02Duration',
      condition: (_: unknown, allParams: Record<string, unknown>) => {
        return allParams.kieHailuo02Resolution === '1080P' && allParams.kieHailuo02Duration !== 6
      },
      value: 6
    },
    {
      trigger: ['kieHailuo02Duration', 'kieHailuo02Resolution'],
      effect: 'autoSwitch',
      target: 'kieHailuo02Resolution',
      condition: (_: unknown, allParams: Record<string, unknown>) => {
        return allParams.kieHailuo02Duration === 10 && allParams.kieHailuo02Resolution === '1080P'
      },
      value: '768P'
    }
  ],
  endpoints: KIE_CREATE_TASK_ENDPOINT,
  request: {
    builder: (params) => {
      const images = params.images || []
      const prompt = params.prompt || ''
      const duration = params.kieHailuo02Duration || params.duration || 6
      const resolution = params.kieHailuo02Resolution || params.resolution || '768P'
      const promptOptimizer = params.kieHailuo02PromptOptimizer ?? params.prompt_optimizer ?? false

      const usePro = duration === 6 && resolution === '1080P'

      let model: string
      if (images.length === 0) {
        model = usePro
          ? 'hailuo/02-text-to-video-pro'
          : 'hailuo/02-text-to-video-standard'
      } else {
        model = usePro
          ? 'hailuo/02-image-to-video-pro'
          : 'hailuo/02-image-to-video-standard'
      }

      const input: Record<string, unknown> = { prompt }

      if (images.length > 0) {
        input.image_url = images[0]
        if (images.length > 1) {
          input.end_image_url = images[1]
        }
      }

      if (!usePro) {
        input.duration = String(duration)
        if (images.length > 0) {
          input.resolution = resolution
        }
      }

      if (promptOptimizer) {
        input.prompt_optimizer = true
      }

      return {
        model,
        input
      }
    }
  },
  pricing: {
    currency: '¥',
    calculator: () => 0.12,
    description: '基础价格 ¥0.12/次'
  }
})

export default kieHailuo02Model
