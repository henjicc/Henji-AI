/**
 * Vidu Q2 视频生成模型
 */

import { defineModel } from '@/core'

export const viduQ2Model = defineModel({
  meta: {
    id: 'fal-ai-vidu-q2',
    provider: 'fal',
    type: 'video',
    name: 'Vidu Q2',
    description: 'Vidu Q2 视频生成模型',
    tags: ['video', 'text-to-video', 'image-to-video']
  },
  params: [],
  linkages: [],
  endpoints: {
    selector: async (params) => {
      const images = params.images || []
      return images.length > 0
        ? 'fal-ai/vidu/q2/image-to-video'
        : 'fal-ai/vidu/q2'
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
    calculator: () => 0.11,
    description: '基础价格 $0.11/次'
  }
})

export default viduQ2Model;
