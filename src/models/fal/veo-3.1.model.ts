/**
 * Veo 3.1 视频生成模型
 */

import { defineModel } from '@/core'

export const veo31Model = defineModel({
  meta: {
    id: 'fal-ai-veo-3.1',
    provider: 'fal',
    type: 'video',
    name: 'Veo 3.1',
    description: 'Veo 3.1 视频生成模型',
    tags: ['video', 'text-to-video', 'image-to-video']
  },
  params: [],
  linkages: [],
  endpoints: {
    selector: async (params) => {
      const images = params.images || []
      return images.length > 0
        ? 'fal-ai/veo/v3.1/image-to-video'
        : 'fal-ai/veo/v3.1'
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
    calculator: () => 0.15,
    description: '基础价格 $0.15/次'
  }
})

export default veo31Model;
