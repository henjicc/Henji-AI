/**
 * KIE Seedream 4.5 图片生成模型
 */

import { defineModel } from '@/core'

export const kieSeedream45Model = defineModel({
  meta: {
    id: 'kie-seedream-4.5',
    provider: 'kie',
    type: 'image',
    name: 'Seedream 4.5',
    description: 'Seedream 4.5 图片生成模型',
    tags: ['image', 'text-to-image', 'image-to-image']
  },
  params: [
    {
      id: 'kieSeedreamAspectRatio',
      type: 'dropdown',
      order: 1,
      label: { zh: '宽高比', en: 'Aspect Ratio' },
      defaultValue: '1:1',
      options: [
        { value: 'smart', label: '智能' },
        { value: '1:1', label: '1:1' },
        { value: '4:3', label: '4:3' },
        { value: '3:4', label: '3:4' },
        { value: '16:9', label: '16:9' },
        { value: '9:16', label: '9:16' }
      ]
    },
    {
      id: 'kieSeedreamQuality',
      type: 'dropdown',
      order: 2,
      label: { zh: '质量', en: 'Quality' },
      defaultValue: '2K',
      options: [
        { value: '2K', label: '高清 2K' },
        { value: '4K', label: '超清 4K' }
      ]
    }
  ],
  linkages: [
    {
      trigger: 'uploadedImages',
      effect: 'autoSwitch',
      target: 'kieSeedreamAspectRatio',
      condition: (images) => images?.length > 0,
      value: 'smart'
    }
  ],
  endpoints: {
    selector: async (params) => {
      const images = params.images || []
      return images.length === 0
        ? 'seedream/4.5-text-to-image'
        : 'seedream/4.5-edit'
    }
  },
  request: {
    builder: (params) => {
      const images = params.images || []
      const modelName = images.length === 0
        ? 'seedream/4.5-text-to-image'
        : 'seedream/4.5-edit'

      const requestData: any = {
        model: modelName,
        input: {
          prompt: params.prompt || ''
        }
      }

      if (params.aspect_ratio && params.aspect_ratio !== 'smart' && params.aspect_ratio !== 'auto') {
        requestData.input.aspect_ratio = params.aspect_ratio
      }

      if (params.quality) {
        requestData.input.quality = params.quality === '2K' ? 'basic' : 'high'
      }

      if (images.length > 0) {
        requestData.input.image_urls = images
      }

      return requestData
    }
  },
  pricing: {
    currency: '¥',
    calculator: (params) => {
      const quality = params.kieSeedreamQuality || '2K'
      return quality === '4K' ? 0.3 : 0.15
    },
    description: '2K: ¥0.15/张, 4K: ¥0.3/张'
  }
})

export default kieSeedream45Model;
