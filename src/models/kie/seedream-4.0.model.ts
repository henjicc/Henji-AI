/**
 * KIE Seedream 4.0 图片生成模型
 */

import { defineModel, sharedFieldText, sharedOptionText } from '@/core'

const KIE_CREATE_TASK_ENDPOINT = '/api/v1/jobs/createTask'

export const kieSeedream40Model = defineModel({
  meta: {
    id: 'kie-seedream-4.0',
    provider: 'kie',
    type: 'image',
        i18nScope: 'models.defs.kie-seedream-4.0',
    name: { key: 'meta.name', fallback: 'Seedream 4.0' },
    description: { key: 'meta.description', fallback: 'KIE Seedream 4.0 image generation model' },
    tags: ['text-to-image', 'image-to-image', 'supports-4k', 'provider-kie'],
    aliases: ['seedream-4.0-kie']
  },
  params: [
    {
      id: 'kieSeedream40AspectRatio',
      type: 'dropdown',
      order: 1,
      name: sharedFieldText('aspectRatio'),
      default: '1:1',
      options: [
        { value: 'smart', label: sharedOptionText('smart') },
        { value: '1:1', label: '1:1' },
        { value: '4:3', label: '4:3' },
        { value: '3:4', label: '3:4' },
        { value: '3:2', label: '3:2' },
        { value: '2:3', label: '2:3' },
        { value: '16:9', label: '16:9' },
        { value: '9:16', label: '9:16' },
        { value: '21:9', label: '21:9' }
      ]
    },
    {
      id: 'kieSeedream40Resolution',
      type: 'dropdown',
      order: 2,
      name: sharedFieldText('resolution'),
      default: '2K',
      options: [
        { value: '2K', label: '2K' },
        { value: '4K', label: '4K' }
      ]
    },
    {
      id: 'kieSeedream40MaxImages',
      type: 'number',
      order: 3,
      name: sharedFieldText('maxImages'),
      default: 1,
      min: 1,
      max: 6,
      step: 1
    }
  ],
  linkages: [],
  endpoints: KIE_CREATE_TASK_ENDPOINT,
  request: {
    builder: (params) => {
      const parseRatio = (raw: string): number | null => {
        const pair = raw.split(':').map(Number)
        if (pair.length !== 2 || !Number.isFinite(pair[0]) || !Number.isFinite(pair[1]) || pair[0] <= 0 || pair[1] <= 0) {
          return null
        }
        return pair[0] / pair[1]
      }
      const pickClosestRatio = (target: number): string => {
        const options = ['21:9', '16:9', '3:2', '4:3', '1:1', '3:4', '2:3', '9:16']
        let best = '1:1'
        let bestDiff = Number.POSITIVE_INFINITY
        for (const ratioText of options) {
          const ratio = parseRatio(ratioText)
          if (!ratio) {
            continue
          }
          const diff = Math.abs(ratio - target)
          if (diff < bestDiff) {
            best = ratioText
            bestDiff = diff
          }
        }
        return best
      }
      const mapSeedream40ImageSize = (ratio: string): string => {
        if (!ratio) return 'square_hd'
        if (ratio.includes('_')) return ratio
        if (ratio === '1:1') return 'square_hd'
        if (ratio === '4:3') return 'landscape_4_3'
        if (ratio === '3:4') return 'portrait_4_3'
        if (ratio === '3:2') return 'landscape_3_2'
        if (ratio === '2:3') return 'portrait_3_2'
        if (ratio === '16:9') return 'landscape_16_9'
        if (ratio === '9:16') return 'portrait_16_9'
        if (ratio === '21:9') return 'landscape_21_9'
        return 'square_hd'
      }

      const images = params.images || []
      const prompt = params.prompt || ''
      const aspectRatio = params.kieSeedream40AspectRatio || params.image_size || params.aspect_ratio
      const resolution = params.kieSeedream40Resolution || params.image_resolution || params.resolution
      const maxImages = params.kieSeedream40MaxImages || params.max_images || params.maxImages
      const ratioHint = typeof params.__firstImageRatio === 'number' &&
        Number.isFinite(params.__firstImageRatio) &&
        params.__firstImageRatio > 0
        ? params.__firstImageRatio
        : null

      const modelName = images.length === 0
        ? 'bytedance/seedream-v4-text-to-image'
        : 'bytedance/seedream-v4-edit'

      const input: Record<string, unknown> = { prompt }

      const aspectRatioText = typeof aspectRatio === 'string' ? aspectRatio : ''
      const normalizedAspectRatio =
        !aspectRatioText || aspectRatioText === 'smart' || aspectRatioText === 'auto'
          ? (ratioHint ? pickClosestRatio(ratioHint) : '1:1')
          : aspectRatioText
      input.image_size = mapSeedream40ImageSize(normalizedAspectRatio)

      if (resolution) {
        input.image_resolution = resolution
      }

      if (maxImages !== undefined) {
        input.max_images = maxImages
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

export default kieSeedream40Model
