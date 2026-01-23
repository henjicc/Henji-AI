/**
 * PixVerse V5.5 视频生成模型
 */

import { defineModel } from '@/core'

export const pixverseV55Model = defineModel({
  meta: {
    id: 'fal-ai-pixverse-v5.5',
    provider: 'fal',
    type: 'video',
    name: 'PixVerse V5.5',
    description: 'PixVerse V5.5 视频生成模型',
    tags: ['video', 'text-to-video', 'image-to-video']
  },
  params: [],
  linkages: [],
  endpoints: {
    selector: async (params) => {
      const images = params.images || []
      return images.length > 0
        ? 'fal-ai/pixverse/v5.5/image-to-video'
        : 'fal-ai/pixverse/v5.5'
    }
  },
  request: {
    builder: (params) => {
      const images = params.images || []
      const prompt = params.prompt || ''
      const requestData: any = { prompt }
      if (images.length > 0) {
        requestData.image_urls = images
      }
      return requestData
    }
  },
  pricing: {
    currency: '$',
    calculator: () => 0.09,
    description: '基础价格 $0.09/次'
  }
})

export default pixverseV55Model;
