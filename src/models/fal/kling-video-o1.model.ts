/**
 * Kling Video O1 视频生成模型
 */

import { defineModel } from '@/core'

export const klingVideoO1Model = defineModel({
  meta: {
    id: 'fal-ai-kling-video-o1',
    provider: 'fal',
    type: 'video',
    name: 'Kling Video O1',
    description: 'Kling Video O1 视频生成模型',
    tags: ['video', 'text-to-video', 'image-to-video']
  },
  params: [],
  linkages: [],
  endpoints: {
    selector: async (params) => {
      const images = params.images || []
      return images.length > 0
        ? 'fal-ai/kling-video/o1/image-to-video'
        : 'fal-ai/kling-video/o1/text-to-video'
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

export default klingVideoO1Model;
