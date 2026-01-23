/**
 * KIE Seedream 4.0 图片生成模型
 */

import { defineModel } from '@/core'

export const kieSeedream40Model = defineModel({
  meta: {
    id: 'kie-seedream-4.0',
    provider: 'kie',
    type: 'image',
    name: 'Seedream 4.0',
    description: 'Seedream 4.0 图片生成模型',
    tags: ['image', 'text-to-image', 'image-to-image']
  },
  params: [
    {
      id: 'kieSeedream40AspectRatio',
      type: 'dropdown',
      order: 1,
      label: { zh: '宽高比', en: 'Aspect Ratio' },
      defaultValue: '1:1',
      options: [
        { value: 'smart', label: '智能' },
        { value: '1:1', label: '1:1' },
        { value: '16:9', label: '16:9' },
        { value: '9:16', label: '9:16' }
      ]
    }
  ],
  linkages: [
    {
      trigger: 'uploadedImages',
      effect: 'autoSwitch',
      target: 'kieSeedream40AspectRatio',
      condition: (images) => images?.length > 0,
      value: 'smart'
    }
  ],
  endpoints: {
    selector: async (params) => {
      const images = params.images || []
      return images.length === 0
        ? 'seedream/4.0-text-to-image'
        : 'seedream/4.0-edit'
    }
  },
  request: {
    builder: (params) => {
      const images = params.images || []
      const modelName = images.length === 0
        ? 'seedream/4.0-text-to-image'
        : 'seedream/4.0-edit'

      const requestData: any = {
        model: modelName,
        input: {
          prompt: params.prompt || ''
        }
      }

      if (params.aspect_ratio && params.aspect_ratio !== 'smart' && params.aspect_ratio !== 'auto') {
        requestData.input.aspect_ratio = params.aspect_ratio
      }

      if (images.length > 0) {
        requestData.input.image_urls = images
      }

      return requestData
    }
  },
  pricing: {
    currency: '¥',
    calculator: () => 0.12,
    description: '基础价格 ¥0.12/张'
  }
})

export default kieSeedream40Model;
