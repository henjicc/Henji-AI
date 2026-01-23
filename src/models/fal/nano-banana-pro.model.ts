/**
 * Nano Banana Pro 图片生成模型
 */

import { defineModel } from '@/core'

export const nanoBananaProModel = defineModel({
  meta: {
    id: 'fal-ai-nano-banana-pro',
    provider: 'fal',
    type: 'image',
    name: 'Nano Banana Pro',
    description: 'Nano Banana Pro 高质量图片生成模型',
    tags: ['image', 'text-to-image', 'image-to-image', 'high-quality']
  },
  params: [
    // 1. 生成数量
    {
      id: 'falNanoBananaProNumImages',
      order: 1,
      type: 'number',
      name: { zh: '生成数量', en: 'Number of Images' },
      default: 1,
      min: 1,
      max: 4
    },
    // 2. 分辨率
    {
      id: 'falNanoBananaProResolution',
      order: 2,
      type: 'dropdown',
      name: { zh: '分辨率', en: 'Resolution' },
      default: '1024x1024',
      options: [
        { value: '512x512', label: '512x512' },
        { value: '1024x1024', label: '1024x1024' },
        { value: '2048x2048', label: '2048x2048' }
      ]
    }
  ],
  linkages: [],
  endpoints: {
    selector: async (params) => {
      const images = params.images || []
      return images.length > 0 ? 'fal-ai/nano-banana-pro/edit' : 'fal-ai/nano-banana-pro'
    }
  },
  request: {
    builder: (params) => {
      const images = params.images || []
      const prompt = params.prompt || ''

      const requestData: any = { prompt }

      if (params.num_images !== undefined) {
        requestData.num_images = params.num_images
      }

      if (params.resolution !== undefined) {
        requestData.resolution = params.resolution
      }

      if (params.aspect_ratio && params.aspect_ratio !== 'auto' && params.aspect_ratio !== 'smart') {
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
      const numImages = params.falNanoBananaProNumImages || 1
      return 0.01 * numImages
    },
    description: '基础价格 $0.01/张'
  }
})

export default nanoBananaProModel;
