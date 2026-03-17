/**
 * KIE Seedream 4.5 图片生成模型
 */

import { defineModel, sharedFieldText, sharedOptionText } from '@/core'

const KIE_CREATE_TASK_ENDPOINT = '/api/v1/jobs/createTask'

function mapSeedream45Quality(value: string): string {
  if (value === '2K') return 'basic'
  if (value === '4K') return 'high'
  if (value === 'basic' || value === 'high') return value
  return 'basic'
}

export const kieSeedream45Model = defineModel({
  meta: {
    id: 'kie-seedream-4.5',
    provider: 'kie',
    type: 'image',
        i18nScope: 'models.defs.kie-seedream-4.5',
    name: { key: 'meta.name', fallback: 'Seedream 4.5' },
    description: { key: 'meta.description', fallback: 'KIE Seedream 4.5 image generation model' },
    tags: ['text-to-image', 'image-to-image', 'supports-4k', 'provider-kie'],
    aliases: ['seedream-4.5-kie']
  },
  params: [
    {
      id: 'kieSeedreamAspectRatio',
      type: 'dropdown',
      order: 1,
      name: sharedFieldText('aspectRatio'),
      default: '1:1',
      options: [
        { value: 'smart', label: sharedOptionText('smart') },
        { value: '1:1', label: '1:1' },
        { value: '4:3', label: '4:3' },
        { value: '3:4', label: '3:4' },
        { value: '16:9', label: '16:9' },
        { value: '9:16', label: '9:16' }
      ]
    },
    {
      id: 'kieSeedreamQuality',
      type: 'dropdown',
      order: 2,
      name: sharedFieldText('quality'),
      default: '2K',
      options: [
        { value: '2K', label: '2K' },
        { value: '4K', label: '4K' }
      ]
    }
  ],
  linkages: [],
  endpoints: KIE_CREATE_TASK_ENDPOINT,
  request: {
    builder: (params) => {
      const images = params.images || []
      const prompt = params.prompt || ''
      const aspectRatio = params.kieSeedreamAspectRatio || params.aspect_ratio
      const quality = params.kieSeedreamQuality || params.quality

      const modelName = images.length === 0
        ? 'seedream/4.5-text-to-image'
        : 'seedream/4.5-edit'

      const input: Record<string, unknown> = { prompt }

      if (aspectRatio && aspectRatio !== 'smart' && aspectRatio !== 'auto') {
        input.aspect_ratio = aspectRatio
      }

      if (quality) {
        input.quality = mapSeedream45Quality(String(quality))
      }

      if (images.length > 0) {
        input.image_urls = images
      }

      return {
        model: modelName,
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

export default kieSeedream45Model
