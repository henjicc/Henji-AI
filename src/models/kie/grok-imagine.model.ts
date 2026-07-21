/**
 * KIE Grok Imagine 图片生成模型
 */

import { defineModel, sharedFieldText } from '@/core'

const KIE_CREATE_TASK_ENDPOINT = '/api/v1/jobs/createTask'

export const kieGrokImagineModel = defineModel({
  meta: {
    id: 'kie-grok-imagine',
    provider: 'kie',
    type: 'image',
        i18nScope: 'models.defs.kie-grok-imagine',
    name: { key: 'meta.name', fallback: 'Grok Imagine' },
    description: { key: 'meta.description', fallback: 'KIE Grok Imagine text-to-image model' },
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
      name: sharedFieldText('aspectRatio'),
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

      const input: DynamicValueMap = { prompt }

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
