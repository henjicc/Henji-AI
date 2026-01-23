/**
 * Hailuo 02 视频生成模型
 */

import { defineModel } from '@/core'

export const hailuo02Model = defineModel({
  meta: {
    id: 'fal-ai-hailuo-02',
    provider: 'fal',
    type: 'video',
    name: 'Hailuo 02',
    description: 'Hailuo 02 视频生成模型',
    tags: ['video', 'text-to-video', 'image-to-video']
  },
  params: [],
  linkages: [],
  endpoints: {
    selector: async (params) => {
      const images = params.images || []
      return images.length > 0
        ? 'fal-ai/hailuo/video/o2/image-to-video'
        : 'fal-ai/hailuo/video/o2'
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
    calculator: () => 0.1,
    description: '基础价格 $0.1/次'
  }
})

export default hailuo02Model;
