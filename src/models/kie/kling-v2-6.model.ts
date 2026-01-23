/**
 * KIE Kling V2.6 视频生成模型
 */

import { defineModel } from '@/core'

export const kieKlingV26Model = defineModel({
  meta: {
    id: 'kie-kling-v2-6',
    provider: 'kie',
    type: 'video',
    name: 'Kling V2.6',
    description: 'Kling V2.6 视频生成模型',
    tags: ['video', 'text-to-video', 'image-to-video']
  },
  params: [],
  linkages: [],
  endpoints: {
    selector: async (params) => {
      const images = params.images || []
      return images.length > 0
        ? 'kling/v2.6-image-to-video'
        : 'kling/v2.6-text-to-video'
    }
  },
  request: {
    builder: (params) => {
      const images = params.images || []
      const hasImages = images.length > 0
      const model = hasImages ? 'kling/v2.6-image-to-video' : 'kling/v2.6-text-to-video'

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
    calculator: () => 0.12,
    description: '基础价格 ¥0.12/次'
  }
})

export default kieKlingV26Model;
