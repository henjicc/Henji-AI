/**
 * Sora 2 视频生成模型
 */

import { defineModel } from '@/core'

export const sora2Model = defineModel({
  meta: {
    id: 'fal-ai-sora-2',
    provider: 'fal',
    type: 'video',
    name: 'Sora 2',
    description: 'Sora 2 视频生成模型',
    tags: ['video', 'text-to-video', 'image-to-video']
  },
  params: [],
  linkages: [],
  endpoints: {
    selector: async (params) => {
      const images = params.images || []
      return images.length > 0
        ? 'fal-ai/sora/v2/image-to-video'
        : 'fal-ai/sora/v2'
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
    calculator: () => 0.2,
    description: '基础价格 $0.2/次'
  }
})

export default sora2Model;
