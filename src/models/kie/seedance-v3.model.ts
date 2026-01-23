/**
 * KIE Seedance V3 视频生成模型
 */

import { defineModel } from '@/core'

export const kieSeedanceV3Model = defineModel({
  meta: {
    id: 'kie-seedance-v3',
    provider: 'kie',
    type: 'video',
    name: 'Seedance V3',
    description: 'Seedance V3 视频生成模型',
    tags: ['video', 'text-to-video', 'image-to-video']
  },
  params: [],
  linkages: [],
  endpoints: {
    selector: async (params) => {
      const images = params.images || []
      return images.length > 0
        ? 'seedance/v3-image-to-video'
        : 'seedance/v3-text-to-video'
    }
  },
  request: {
    builder: (params) => {
      const images = params.images || []
      const hasImages = images.length > 0
      const model = hasImages ? 'seedance/v3-image-to-video' : 'seedance/v3-text-to-video'

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

export default kieSeedanceV3Model;
