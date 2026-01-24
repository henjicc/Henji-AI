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
    // 2. 宽高比
    {
      id: 'falNanoBananaProAspectRatio',
      order: 2,
      type: 'dropdown',
      name: { zh: '宽高比', en: 'Aspect Ratio' },
      default: '1:1',
      options: [
        { value: 'smart', label: { zh: '智能', en: 'Smart' } },
        { value: '1:1', label: '1:1' },
        { value: '16:9', label: '16:9' },
        { value: '9:16', label: '9:16' },
        { value: '21:9', label: '21:9' },
        { value: '3:2', label: '3:2' },
        { value: '2:3', label: '2:3' },
        { value: '4:3', label: '4:3' },
        { value: '3:4', label: '3:4' },
        { value: '5:4', label: '5:4' },
        { value: '4:5', label: '4:5' }
      ]
    },
    // 3. 分辨率
    {
      id: 'falNanoBananaProResolution',
      order: 3,
      type: 'dropdown',
      name: { zh: '分辨率', en: 'Resolution' },
      default: '2K',
      options: [
        { value: '1K', label: '1K' },
        { value: '2K', label: '2K' },
        { value: '4K', label: '4K' }
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

      if (params.falNanoBananaProNumImages !== undefined) {
        requestData.num_images = params.falNanoBananaProNumImages
      }

      if (params.falNanoBananaProResolution !== undefined) {
        requestData.resolution = params.falNanoBananaProResolution
      }

      const aspectRatio = params.falNanoBananaProAspectRatio
      if (aspectRatio && aspectRatio !== 'auto' && aspectRatio !== 'smart') {
        requestData.aspect_ratio = aspectRatio
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
