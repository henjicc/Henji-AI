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
        i18nScope: 'models.defs.kie-hailuo-02',
    name: { key: 'meta.name', fallback: 'Hailuo 02' },
    description: { key: 'meta.description', fallback: 'KIE Hailuo 02 video generation model' },
    tags: ['text-to-video', 'image-to-video', 'provider-kie'],
    aliases: ['hailuo-02-kie'],
    polling: {
      interval: 3000,
      maxAttempts: 120,
      expectedAttempts: 40
    }
  },
  inputLimits: {
    images: { max: 2 },
    videos: { max: 0 }
  },
  params: [
    {
      id: 'kieHailuo02Duration',
      type: 'dropdown',
      order: 1,
      name: { key: 'auto.1', fallback: 'Duration' },
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
      name: { key: 'auto.2', fallback: 'Resolution' },
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
      name: { key: 'auto.3', fallback: 'Prompt Optimizer' },
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
