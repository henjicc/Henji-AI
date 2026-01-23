/**
 * KIE Sora 2 视频生成模型
 */

import { defineModel } from '@/core'

export const kieSora2Model = defineModel({
  meta: {
    id: 'kie-sora2',
    provider: 'kie',
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
        ? 'sora/2-image-to-video'
        : 'sora/2-text-to-video'
    }
  },
  request: {
    builder: (params) => {
      const images = params.images || []
      const hasImages = images.length > 0
      const model = hasImages ? 'sora/2-image-to-video' : 'sora/2-text-to-video'

      const requestData: any = {
        model,
        input: {
          prompt: params.prompt || ''
        }
      }

      if (hasImages) {
        requestData.input.image_urls = images
      }

      return requestData
    }
  },
  pricing: {
    currency: '¥',
    calculator: () => 0.2,
    description: '基础价格 ¥0.2/次'
  }
})

export default kieSora2Model;
