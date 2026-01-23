/**
 * Kling Image O1 图片生成模型
 */

import { defineModel } from '@/core'

export const klingImageO1Model = defineModel({
  meta: {
    id: 'fal-ai-kling-image-o1',
    provider: 'fal',
    type: 'image',
    name: 'Kling Image O1',
    description: 'Kling Image O1 高质量图片生成模型',
    tags: ['image', 'text-to-image', 'image-to-image']
  },
  params: [
    // 1. 生成数量
    {
      id: 'falKlingImageO1NumImages',
      order: 1,
      type: 'number',
      name: { zh: '生成数量', en: 'Number of Images' },
      default: 1,
      min: 1,
      max: 4
    },
    // 2. 分辨率
    {
      id: 'falKlingImageO1Resolution',
      order: 2,
      type: 'text',
      name: { zh: '分辨率', en: 'Resolution' },
      default: '1024x1024'
    }
  ],
  linkages: [
  ],
  endpoints: {
    selector: async () => 'fal-ai/kling-image/o1'
  },
  request: {
    builder: (params) => {
      const images = params.images || []
      const prompt = params.prompt || ''

      const requestData: any = {
        prompt,
        image_urls: images
      }

      if (params.num_images !== undefined && params.num_images > 0) {
        requestData.num_images = params.num_images
      }

      return requestData
    }
  },
  pricing: {
    currency: '$',
    calculator: (params) => {
      const numImages = params.falKlingImageO1NumImages || 1
      return 0.02 * numImages
    },
    description: '基础价格 $0.02/张'
  }
})

export default klingImageO1Model;
