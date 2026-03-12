/**
 * Kling Image O1 图片生成模型
 */

import { defineModel } from '@/core'

export const klingImageO1Model = defineModel({
  meta: {
    id: 'fal-ai-kling-image-o1',
    provider: 'fal',
    type: 'image',
        i18nScope: 'models.defs.fal-ai-kling-image-o1',
    name: { key: 'meta.name', fallback: 'Kling Image O1' },
    description: 'Kling Image O1 高质量图片生成模型',
    tags: ['image', 'text-to-image', 'image-to-image']
  },
  params: [
    // 1. 生成数量
    {
      id: 'falKlingImageO1NumImages',
      order: 1,
      type: 'number',
      name: { key: 'auto.1', fallback: 'Number of Images' },
      default: 1,
      min: 1,
      max: 9
    },
    // 2. 宽高比
    {
      id: 'falKlingImageO1AspectRatio',
      order: 2,
      type: 'dropdown',
      name: { key: 'auto.2', fallback: 'Aspect Ratio' },
      default: '1:1',
      options: [
        { value: 'auto', label: { key: 'auto.3', fallback: 'Auto' } },
        { value: '1:1', label: '1:1' },
        { value: '16:9', label: '16:9' },
        { value: '9:16', label: '9:16' },
        { value: '4:3', label: '4:3' },
        { value: '3:4', label: '3:4' },
        { value: '3:2', label: '3:2' },
        { value: '2:3', label: '2:3' },
        { value: '21:9', label: '21:9' }
      ]
    },
    // 3. 分辨率
    {
      id: 'falKlingImageO1Resolution',
      order: 3,
      type: 'text',
      name: { key: 'auto.4', fallback: 'Resolution' },
      default: '2K'
    }
  ],
  linkages: [
  ],
  endpoints: {
    selector: async () => 'fal-ai/kling-image/o1'
  },
  request: {
    builder: (params) => {
      const images = params.images || []
      const prompt = params.prompt || ''

      const requestData: any = {
        prompt,
        image_urls: images
      }

      if (params.falKlingImageO1NumImages !== undefined && params.falKlingImageO1NumImages > 0) {
        requestData.num_images = params.falKlingImageO1NumImages
      }

      const aspectRatio = params.falKlingImageO1AspectRatio
      if (aspectRatio && aspectRatio !== 'auto') {
        requestData.aspect_ratio = aspectRatio
      }

      const resolution = params.falKlingImageO1Resolution
      if (resolution) {
        requestData.resolution = resolution
      }

      return requestData
    }
  },
  pricing: {
    currency: '$',
    calculator: (params) => {
      const numImages = params.falKlingImageO1NumImages || 1
      return 0.02 * numImages
    },
    description: '基础价格 $0.02/张'
  }
})

export default klingImageO1Model;
