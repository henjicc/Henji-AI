/**
 * KIE Z-Image 图片生成模型
 */

import { defineModel, sharedFieldText } from '@/core'

const KIE_CREATE_TASK_ENDPOINT = '/api/v1/jobs/createTask'

export const kieZImageModel = defineModel({
  meta: {
    id: 'kie-z-image',
    provider: 'kie',
    type: 'image',
        i18nScope: 'models.defs.kie-z-image',
    name: { key: 'meta.name', fallback: 'Z-Image' },
    description: { key: 'meta.description', fallback: 'KIE Z-Image text-to-image model' },
    tags: ['text-to-image', 'provider-kie'],
    aliases: ['z-image-kie']
  },
  params: [
    {
      id: 'kieZImageAspectRatio',
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
      const aspectRatio = params.kieZImageAspectRatio || params.aspect_ratio

      const input: DynamicValueMap = { prompt }

      if (aspectRatio && aspectRatio !== 'smart' && aspectRatio !== 'auto') {
        input.aspect_ratio = aspectRatio
      }

      return {
        model: 'z-image',
        input
      }
    }
  },
  pricing: {
    currency: '¥',
    calculator: () => 0.01,
    description: '基础价格 ¥0.01/张'
  }
})

export default kieZImageModel
