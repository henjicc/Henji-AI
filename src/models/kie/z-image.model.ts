/**
 * KIE Z-Image 图片生成模型
 */

import { defineModel } from '@/core'

export const kieZImageModel = defineModel({
  meta: {
    id: 'kie-z-image',
    provider: 'kie',
    type: 'image',
    name: 'Z-Image',
    description: 'Z-Image 图片生成模型',
    tags: ['image', 'text-to-image']
  },
  params: [
    {
      id: 'kieZImageAspectRatio',
      type: 'dropdown',
      order: 1,
      label: { zh: '宽高比', en: 'Aspect Ratio' },
      defaultValue: '1:1',
      options: [
        { value: '1:1', label: '1:1' },
        { value: '16:9', label: '16:9' },
        { value: '9:16', label: '9:16' }
      ]
    }
  ],
  linkages: [],
  endpoints: {
    selector: async () => 'z-image'
  },
  request: {
    builder: (params) => {
      const requestData: any = {
        model: 'z-image',
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
    calculator: () => 0.03,
    description: '基础价格 ¥0.03/张'
  }
})

export default kieZImageModel;
