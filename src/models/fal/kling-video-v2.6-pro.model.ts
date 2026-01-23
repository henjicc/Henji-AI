/**
 * Kling Video V2.6 Pro 视频生成模型
 */

import { defineModel } from '@/core'

export const klingVideoV26ProModel = defineModel({
  meta: {
    id: 'fal-ai-kling-video-v2.6-pro',
    provider: 'fal',
    type: 'video',
    name: 'Kling Video V2.6 Pro',
    description: 'Kling Video V2.6 Pro 视频生成模型',
    tags: ['video', 'text-to-video', 'image-to-video']
  },
  params: [],
  linkages: [],
  endpoints: {
    selector: async (params) => {
      const images = params.images || []
      return images.length > 0
        ? 'fal-ai/kling-video/v2.6/pro/image-to-video'
        : 'fal-ai/kling-video/v2.6/pro/text-to-video'
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
    calculator: () => 0.12,
    description: '基础价格 $0.12/次'
  }
})

export default klingVideoV26ProModel;
