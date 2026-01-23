/**
 * LTX 2 视频生成模型
 */

import { defineModel } from '@/core'

export const ltx2Model = defineModel({
  meta: {
    id: 'fal-ai-ltx-2',
    provider: 'fal',
    type: 'video',
    name: 'LTX 2',
    description: 'LTX 2 视频生成模型',
    tags: ['video', 'text-to-video', 'image-to-video']
  },
  params: [],
  linkages: [],
  endpoints: {
    selector: async (params) => {
      const images = params.images || []
      return images.length > 0
        ? 'fal-ai/ltx/video/v2/image-to-video'
        : 'fal-ai/ltx/video/v2'
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
    calculator: () => 0.07,
    description: '基础价格 $0.07/次'
  }
})

export default ltx2Model;
