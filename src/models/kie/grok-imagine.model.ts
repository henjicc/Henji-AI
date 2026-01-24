/**
 * KIE Grok Imagine 图片生成模型
 */

import { defineModel } from '@/core'

const KIE_CREATE_TASK_ENDPOINT = '/api/v1/jobs/createTask'

export const kieGrokImagineModel = defineModel({
  meta: {
    id: 'kie-grok-imagine',
    provider: 'kie',
    type: 'image',
    name: { zh: 'Grok Imagine', en: 'Grok Imagine' },
    description: { zh: 'KIE Grok Imagine 文生图模型', en: 'KIE Grok Imagine text-to-image model' },
    tags: ['text-to-image', 'provider-kie'],
    aliases: ['grok-imagine-kie']
  },
  inputLimits: {
    images: { max: 0 },
    videos: { max: 0 }
  },
  params: [
    {
      id: 'kieGrokImagineAspectRatio',
      type: 'dropdown',
      order: 1,
      name: { zh: '宽高比', en: 'Aspect Ratio' },
      default: '1:1',
      options: [
        { value: '1:1', label: '1:1' },
        { value: '2:3', label: '2:3' },
        { value: '3:2', label: '3:2' }
      ]
    }
  ],
  linkages: [],
  endpoints: KIE_CREATE_TASK_ENDPOINT,
  request: {
    builder: (params) => {
      const prompt = params.prompt || ''
      const aspectRatio = params.kieGrokImagineAspectRatio || params.aspect_ratio

      const input: Record<string, unknown> = { prompt }

      if (aspectRatio && aspectRatio !== 'smart' && aspectRatio !== 'auto') {
        input.aspect_ratio = aspectRatio
      }

      return {
        model: 'grok-imagine/text-to-image',
        input
      }
    }
  },
  pricing: {
    currency: '¥',
    calculator: () => 0.05,
    description: '基础价格 ¥0.05/张'
  }
})

export default kieGrokImagineModel
