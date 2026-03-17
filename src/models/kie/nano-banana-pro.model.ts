/**
 * KIE Nano Banana Pro 图片生成模型
 */

import { defineModel, sharedFieldText, sharedOptionText } from '@/core'

const KIE_CREATE_TASK_ENDPOINT = '/api/v1/jobs/createTask'

export const kieNanoBananaProModel = defineModel({
  meta: {
    id: 'kie-nano-banana-pro',
    provider: 'kie',
    type: 'image',
        i18nScope: 'models.defs.kie-nano-banana-pro',
    name: { key: 'meta.name', fallback: 'Nano Banana Pro' },
    description: { key: 'meta.description', fallback: 'KIE Nano Banana Pro image generation model' },
    tags: ['text-to-image', 'image-to-image', 'provider-kie'],
    aliases: ['nano-banana-pro-kie']
  },
  params: [
    {
      id: 'kieNanoBananaAspectRatio',
      type: 'dropdown',
      order: 1,
      name: sharedFieldText('aspectRatio'),
      default: '1:1',
      options: [
        { value: '1:1', label: '1:1' },
        { value: '4:3', label: '4:3' },
        { value: '3:4', label: '3:4' },
        { value: '16:9', label: '16:9' },
        { value: '9:16', label: '9:16' },
        { value: 'smart', label: sharedOptionText('smart') }
      ]
    },
    {
      id: 'kieNanoBananaResolution',
      type: 'dropdown',
      order: 2,
      name: sharedFieldText('resolution'),
      default: '2K',
      options: [
        { value: '1K', label: '1K' },
        { value: '2K', label: '2K' },
        { value: '4K', label: '4K' }
      ]
    },
    {
      id: 'kieNanoBananaOutputFormat',
      type: 'dropdown',
      order: 3,
      name: sharedFieldText('outputFormat'),
      default: 'png',
      options: [
        { value: 'png', label: 'PNG' },
        { value: 'jpg', label: 'JPG' },
        { value: 'webp', label: 'WEBP' }
      ]
    }
  ],
  linkages: [],
  endpoints: KIE_CREATE_TASK_ENDPOINT,
  request: {
    builder: (params) => {
      const images = params.images || []
      const prompt = params.prompt || ''
      const aspectRatio = params.kieNanoBananaAspectRatio || params.aspect_ratio
      const resolution = params.kieNanoBananaResolution || params.resolution

      const input: Record<string, unknown> = { prompt }

      if (aspectRatio && aspectRatio !== 'smart' && aspectRatio !== 'auto') {
        input.aspect_ratio = aspectRatio
      }

      if (resolution) {
        input.resolution = resolution
      }

      if (images.length > 0) {
        input.image_input = images
      }

      return {
        model: 'nano-banana-pro',
        input
      }
    }
  },
  pricing: {
    currency: '¥',
    calculator: () => 0.12,
    description: '基础价格 ¥0.12/次'
  }
})

export default kieNanoBananaProModel
