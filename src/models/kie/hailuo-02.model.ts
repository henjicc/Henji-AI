/**
 * KIE Hailuo 02 视频生成模型
 */

import { defineModel } from '@/core'

export const kieHailuo02Model = defineModel({
  meta: {
    id: 'kie-hailuo-02',
    provider: 'kie',
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
        ? 'hailuo/02-image-to-video'
        : 'hailuo/02-text-to-video'
    }
  },
  request: {
    builder: (params) => {
      const images = params.images || []
      const hasImages = images.length > 0
      const model = hasImages ? 'hailuo/02-image-to-video' : 'hailuo/02-text-to-video'

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
    calculator: () => 0.1,
    description: '基础价格 ¥0.1/次'
  }
})

export default kieHailuo02Model;
