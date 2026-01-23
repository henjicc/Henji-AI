/**
 * Hailuo 2.3 视频生成模型
 */

import { defineModel } from '@/core'

export const hailuo23Model = defineModel({
  meta: {
    id: 'fal-ai-hailuo-2.3',
    provider: 'fal',
    type: 'video',
    name: 'Hailuo 2.3',
    description: 'Hailuo 2.3 视频生成模型',
    tags: ['video', 'text-to-video', 'image-to-video']
  },
  params: [],
  linkages: [],
  endpoints: {
    selector: async (params) => {
      const images = params.images || []
      return images.length > 0
        ? 'fal-ai/hailuo/video/v2.3/image-to-video'
        : 'fal-ai/hailuo/video/v2.3'
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
    calculator: () => 0.08,
    description: '基础价格 $0.08/次'
  }
})

export default hailuo23Model;
