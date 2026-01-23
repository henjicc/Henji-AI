/**
 * Seedance 视频生成模型
 */

import { defineModel } from '@/core'

export const seedanceModel = defineModel({
  meta: {
    id: 'fal-ai-bytedance-seedance',
    provider: 'fal',
    type: 'video',
    name: 'Seedance',
    description: 'Bytedance Seedance 视频生成模型',
    tags: ['video', 'text-to-video', 'image-to-video']
  },
  params: [],
  linkages: [],
  endpoints: {
    selector: async (params) => {
      const images = params.images || []
      return images.length > 0
        ? 'fal-ai/bytedance/seedance/image-to-video'
        : 'fal-ai/bytedance/seedance/text-to-video'
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

export default seedanceModel;
