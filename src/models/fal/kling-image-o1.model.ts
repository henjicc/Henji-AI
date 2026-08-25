/**
 * Kling Image O1 图片生成模型
 */

import { defineModel, sharedFieldText, sharedOptionText } from '@/core'

export const klingImageO1Model = defineModel({
  meta: {
    id: 'fal-ai-kling-image-o1',
    canonicalModelId: 'kling-image-o1',
    provider: 'fal',
    type: 'image',
        i18nScope: 'models.defs.fal-ai-kling-image-o1',
    name: { key: 'meta.name', fallback: 'Kling Image O1' },
    tags: ['image', 'image-to-image', 'supports-image-editing', 'supports-multi-image', 'max-images-10', 'provider-fal']
  },
  inputLimits: {
    images: { min: 1, max: 10 },
    videos: { max: 0 }
  },
  params: [
    // 1. 生成数量
    {
      id: 'falKlingImageO1NumImages',
      order: 1,
      type: 'number',
      name: sharedFieldText('numberOfImages'),
      default: 1,
      min: 1,
      max: 9
    },
    // 2. 宽高比
    {
      id: 'falKlingImageO1AspectRatio',
      order: 2,
      type: 'dropdown',
      name: sharedFieldText('aspectRatio'),
      default: '1:1',
      options: [
        { value: 'auto', label: sharedOptionText('auto') },
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
      type: 'dropdown',
      name: sharedFieldText('resolution'),
      default: '1K',
      options: [
        { value: '1K', label: '1K' },
        { value: '2K', label: '2K' }
      ]
    }
  ],
  linkages: [
  ],
  endpoints: {
    selector: async () => 'fal-ai/kling-image/o1'
  },
  request: {
    builder: (params) => {
      const filterSources = (value: DynamicValue): string[] =>
        Array.isArray(value)
          ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
          : []
      const uploaded = filterSources(params.uploadedFilePaths)
      const images = uploaded.length > 0 ? uploaded : filterSources(params.images)
      const prompt = params.prompt || ''

      const requestData: DynamicValue = {
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
      return 0.028 * numImages
    },
    description: '$0.028/张'
  }
})

export default klingImageO1Model;
