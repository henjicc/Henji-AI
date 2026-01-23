/**
 * KIE Grok Imagine Video 视频生成模型
 */

import { defineModel } from '@/core'

export const kieGrokImagineVideoModel = defineModel({
  meta: {
    id: 'kie-grok-imagine-video',
    provider: 'kie',
    type: 'video',
    name: 'Grok Imagine Video',
    description: 'Grok Imagine Video 视频生成模型',
    tags: ['video', 'text-to-video', 'image-to-video']
  },
  params: [],
  linkages: [],
  endpoints: {
    selector: async (params) => {
      const images = params.images || []
      return images.length > 0
        ? 'grok-imagine/image-to-video'
        : 'grok-imagine/text-to-video'
    }
  },
  request: {
    builder: (params) => {
      const images = params.images || []
      const hasImages = images.length > 0
      const model = hasImages ? 'grok-imagine/image-to-video' : 'grok-imagine/text-to-video'

      const requestData: any = {
        model,
        input: {
          prompt: params.prompt || ''
        }
      }

      if (!hasImages && params.aspect_ratio) {
        requestData.input.aspect_ratio = params.aspect_ratio
      }

      if (hasImages) {
        requestData.input.image_urls = [images[0]]
      }

      if (params.mode) {
        requestData.input.mode = hasImages && params.mode === 'spicy' ? 'normal' : params.mode
      }

      return requestData
    }
  },
  pricing: {
    currency: '¥',
    calculator: () => 0.08,
    description: '基础价格 ¥0.08/次'
  }
})

export default kieGrokImagineVideoModel;
