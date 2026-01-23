/**
 * KIE Grok Imagine 图片生成模型
 */

import { defineModel } from '@/core'

export const kieGrokImagineModel = defineModel({
  meta: {
    id: 'kie-grok-imagine',
    provider: 'kie',
    type: 'image',
    name: 'Grok Imagine',
    description: 'Grok Imagine 图片生成模型',
    tags: ['image', 'text-to-image']
  },
  params: [
    {
      id: 'kieGrokImagineAspectRatio',
      type: 'dropdown',
      order: 1,
      label: { zh: '宽高比', en: 'Aspect Ratio' },
      defaultValue: '1:1',
      options: [
        { value: '1:1', label: '1:1' },
        { value: '2:3', label: '2:3' },
        { value: '3:2', label: '3:2' }
      ]
    }
  ],
  linkages: [],
  endpoints: {
    selector: async () => 'grok-imagine/text-to-image'
  },
  request: {
    builder: (params) => {
      const requestData: any = {
        model: 'grok-imagine/text-to-image',
        input: {
          prompt: params.prompt || ''
        }
      }

      if (params.aspect_ratio && params.aspect_ratio !== 'smart' && params.aspect_ratio !== 'auto') {
        requestData.input.aspect_ratio = params.aspect_ratio
      }

      return requestData
    }
  },
  pricing: {
    currency: '¥',
    calculator: () => 0.05,
    description: '基础价格 ¥0.05/张'
  }
})

export default kieGrokImagineModel;
