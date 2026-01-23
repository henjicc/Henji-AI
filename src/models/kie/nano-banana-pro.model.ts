/**
 * KIE Nano Banana Pro 图片生成模型
 */

import { defineModel } from '@/core'

export const kieNanoBananaProModel = defineModel({
  meta: {
    id: 'kie-nano-banana-pro',
    provider: 'kie',
    type: 'image',
    name: 'Nano Banana Pro',
    description: 'Nano Banana Pro 图片生成模型',
    tags: ['image', 'text-to-image', 'image-to-image']
  },
  params: [
    {
      id: 'kieNanoBananaProAspectRatio',
      type: 'dropdown',
      order: 1,
      label: { zh: '宽高比', en: 'Aspect Ratio' },
      defaultValue: '1:1',
      options: [
        { value: '1:1', label: '1:1' },
        { value: '16:9', label: '16:9' },
        { value: '9:16', label: '9:16' }
      ]
    },
    {
      id: 'kieNanoBananaProResolution',
      type: 'dropdown',
      order: 2,
      label: { zh: '分辨率', en: 'Resolution' },
      defaultValue: 'standard',
      options: [
        { value: 'standard', label: '标准' },
        { value: 'high', label: '高清' }
      ]
    }
  ],
  linkages: [],
  endpoints: {
    selector: async () => 'nano-banana-pro'
  },
  request: {
    builder: (params) => {
      const images = params.images || []
      const requestData: any = {
        model: 'nano-banana-pro',
        input: {
          prompt: params.prompt || ''
        }
      }

      if (params.aspect_ratio && params.aspect_ratio !== 'smart' && params.aspect_ratio !== 'auto') {
        requestData.input.aspect_ratio = params.aspect_ratio
      }

      if (params.resolution) {
        requestData.input.resolution = params.resolution
      }

      if (images.length > 0) {
        requestData.input.image_input = images
      }

      return requestData
    }
  },
  pricing: {
    currency: '¥',
    calculator: () => 0.04,
    description: '基础价格 ¥0.04/张'
  }
})

export default kieNanoBananaProModel;
