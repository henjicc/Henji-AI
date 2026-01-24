/**
 * Seedream V4 图片生成模型
 */

import { defineModel } from '@/core'

export const seedreamV4Model = defineModel({
  meta: {
    id: 'fal-ai-bytedance-seedream-v4',
    provider: 'fal',
    type: 'image',
    name: 'Seedream V4',
    description: 'Bytedance Seedream V4 图片生成模型',
    tags: ['image', 'text-to-image', 'image-to-image']
  },
  params: [
    {
      id: 'falSeedream40NumImages',
      order: 1,
      type: 'number',
      name: { zh: '生成数量', en: 'Number of Images' },
      default: 1,
      min: 1,
      max: 6
    },
    {
      id: 'imageSize',
      order: 2,
      type: 'text',
      name: { zh: '尺寸', en: 'Image Size' },
      default: '2048*2048'
    }
  ],
  linkages: [],
  endpoints: {
    selector: async (params) => {
      const images = params.images || []
      return images.length > 0
        ? 'fal-ai/bytedance/seedream/v4/edit'
        : 'fal-ai/bytedance/seedream/v4/text-to-image'
    }
  },
  request: {
    builder: (params) => {
      const images = params.images || []
      const prompt = params.prompt || ''

      let imageSize = { width: 2048, height: 2048 }
      if (params.imageSize) {
        const [width, height] = params.imageSize.split('*').map(Number)
        imageSize = { width, height }
      }

      const requestData: any = {
        prompt,
        image_size: imageSize,
        num_images: params.falSeedream40NumImages || 1,
        enable_safety_checker: false
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
      const numImages = params.falSeedream40NumImages || 1
      return 0.015 * numImages
    },
    description: '基础价格 $0.015/张'
  }
})

export default seedreamV4Model;
