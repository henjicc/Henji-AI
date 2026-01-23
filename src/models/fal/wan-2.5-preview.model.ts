/**
 * Wan 2.5 Preview 视频生成模型
 */

import { defineModel } from '@/core'

export const wan25PreviewModel = defineModel({
  meta: {
    id: 'fal-ai-wan-2.5-preview',
    provider: 'fal',
    type: 'video',
    name: 'Wan 2.5 Preview',
    description: 'Wan 2.5 Preview 视频生成模型',
    tags: ['video', 'text-to-video', 'image-to-video']
  },
  params: [],
  linkages: [],
  endpoints: {
    selector: async (params) => {
      const images = params.images || []
      return images.length > 0
        ? 'fal-ai/wan/v2.5-preview/image-to-video'
        : 'fal-ai/wan/v2.5-preview'
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
    calculator: () => 0.13,
    description: '基础价格 $0.13/次'
  }
})

export default wan25PreviewModel;
