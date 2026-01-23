/**
 * Nano Banana 图片生成模型
 */

import { defineModel } from '@/core'

export const nanoBananaModel = defineModel({
  meta: {
    id: 'fal-ai-nano-banana',
    provider: 'fal',
    type: 'image',
    name: 'Nano Banana',
    description: 'Nano Banana 快速图片生成模型',
    tags: ['image', 'text-to-image', 'image-to-image']
  },
  params: [
    // 1. 生成数量
    {
      id: 'falNanoBananaNumImages',
      order: 1,
      type: 'number',
      name: { zh: '生成数量', en: 'Number of Images' },
      default: 1,
      min: 1,
      max: 4
    }
  ],
  linkages: [
  ],
  endpoints: {
    selector: async (params) => {
      const images = params.images || []
      return images.length > 0 ? 'fal-ai/nano-banana/edit' : 'fal-ai/nano-banana'
    }
  },
  request: {
    builder: (params) => {
      const images = params.images || []
      const prompt = params.prompt || ''

      const requestData: any = {
        prompt
      }

      if (params.num_images !== undefined) {
        requestData.num_images = params.num_images
      }

      if (params.aspect_ratio &&
          params.aspect_ratio !== 'auto' &&
          params.aspect_ratio !== 'smart') {
        requestData.aspect_ratio = params.aspect_ratio
      }

      if (images.length > 0) {
        requestData.image_urls = images
      }

      return requestData
    }
  },
  pricing: {
    currency: '$',
    calculator: (params) => {
      const numImages = params.falNanoBananaNumImages || 1
      return 0.005 * numImages
    },
    description: '基础价格 $0.005/张'
  }
})

export default nanoBananaModel;
