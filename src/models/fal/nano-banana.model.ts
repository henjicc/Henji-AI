/**
 * Nano Banana 图片生成模型
 */

import { defineModel, sharedFieldText, sharedOptionText } from '@/core'

export const nanoBananaModel = defineModel({
  meta: {
    id: 'fal-ai-nano-banana',
    seriesId: 'nano-banana',
    seriesRank: 1,
    provider: 'fal',
    type: 'image',
        i18nScope: 'models.defs.fal-ai-nano-banana',
    name: { key: 'meta.name', fallback: 'Nano Banana' },
    description: 'Nano Banana 快速图片生成模型',
    tags: ['image', 'text-to-image', 'image-to-image']
  },
  params: [
    // 1. 生成数量
    {
      id: 'falNanoBananaNumImages',
      order: 1,
      type: 'number',
      name: sharedFieldText('numberOfImages'),
      default: 1,
      min: 1,
      max: 4
    },
    // 2. 宽高比
    {
      id: 'falNanoBananaAspectRatio',
      order: 2,
      type: 'dropdown',
      name: sharedFieldText('aspectRatio'),
      default: '1:1',
      options: [
        { value: 'smart', label: sharedOptionText('smart') },
        { value: '1:1', label: '1:1' },
        { value: '16:9', label: '16:9' },
        { value: '9:16', label: '9:16' },
        { value: '21:9', label: '21:9' },
        { value: '3:2', label: '3:2' },
        { value: '2:3', label: '2:3' },
        { value: '4:3', label: '4:3' },
        { value: '3:4', label: '3:4' },
        { value: '5:4', label: '5:4' },
        { value: '4:5', label: '4:5' }
      ]
    }
  ],
  linkages: [
  ],
  endpoints: {
    selector: async (params) => {
      const images = params.images || []
      return images.length > 0 ? 'fal-ai/nano-banana/edit' : 'fal-ai/nano-banana'
    }
  },
  request: {
    builder: (params) => {
      const images = params.images || []
      const prompt = params.prompt || ''

      const requestData: DynamicValue = {
        prompt
      }

      if (params.falNanoBananaNumImages !== undefined) {
        requestData.num_images = params.falNanoBananaNumImages
      }

      const aspectRatio = params.falNanoBananaAspectRatio
      if (aspectRatio && aspectRatio !== 'auto' && aspectRatio !== 'smart') {
        requestData.aspect_ratio = aspectRatio
      }

      if (images.length > 0) {
        requestData.image_urls = images
      }

      return requestData
    }
  },
  pricing: {
    currency: '$',
    calculator: (params) => {
      const numImages = params.falNanoBananaNumImages || 1
      return 0.005 * numImages
    },
    description: '基础价格 $0.005/张'
  }
})

export default nanoBananaModel;
