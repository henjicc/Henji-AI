/**
 * KIE Nano Banana 2 Lite 图片生成与参考图编辑模型
 */

import { defineModel, sharedFieldText, sharedOptionText } from '@/core'

const KIE_CREATE_TASK_ENDPOINT = '/api/v1/jobs/createTask'

const SUPPORTED_ASPECT_RATIOS = [
  '1:1', '1:4', '1:8', '2:3', '3:2', '3:4', '4:1', '4:3', '4:5', '5:4', '8:1', '9:16', '16:9', '21:9'
] as const

export const kieNanoBanana2LiteModel = defineModel({
  meta: {
    id: 'kie-nano-banana-2-lite',
    canonicalModelId: 'nano-banana-2-lite',
    seriesId: 'nano-banana',
    seriesRank: 2,
    provider: 'kie',
    type: 'image',
    i18nScope: 'models.defs.kie-nano-banana-2-lite',
    name: { key: 'meta.name', fallback: 'Nano Banana 2 Lite' },
    tags: ['text-to-image', 'image-to-image', 'multi-image', 'provider-kie'],
    aliases: ['nano-banana-2-lite-kie']
  },
  inputLimits: {
    images: { max: 10 },
    videos: { max: 0 }
  },
  params: [
    {
      id: 'kieNanoBanana2LiteAspectRatio',
      type: 'dropdown',
      order: 1,
      name: sharedFieldText('aspectRatio'),
      default: 'smart',
      options: [
        { value: 'smart', label: sharedOptionText('smart') },
        ...SUPPORTED_ASPECT_RATIOS.map((ratio) => ({ value: ratio, label: ratio }))
      ]
    }
  ],
  linkages: [],
  endpoints: KIE_CREATE_TASK_ENDPOINT,
  request: {
    builder: (params) => {
      const supportedAspectRatios = [
        '1:1', '1:4', '1:8', '2:3', '3:2', '3:4', '4:1', '4:3', '4:5', '5:4', '8:1', '9:16', '16:9', '21:9'
      ]
      const filterSources = (value: DynamicValue): string[] =>
        Array.isArray(value)
          ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
          : []
      const resolveImages = (): string[] => {
        const uploaded = filterSources(params.uploadedFilePaths)
        return uploaded.length > 0 ? uploaded : filterSources(params.images)
      }
      const parseRatio = (value: string): number | null => {
        const parts = value.split(':').map(Number)
        return parts.length === 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1]) && parts[0] > 0 && parts[1] > 0
          ? parts[0] / parts[1]
          : null
      }
      const resolveClosestAspectRatio = (targetRatio: number): string => {
        let closest = '1:1'
        let smallestDifference = Number.POSITIVE_INFINITY
        for (const candidate of supportedAspectRatios) {
          const candidateRatio = parseRatio(candidate)
          if (candidateRatio === null) continue
          const difference = Math.abs(candidateRatio - targetRatio)
          if (difference < smallestDifference) {
            closest = candidate
            smallestDifference = difference
          }
        }
        return closest
      }

      const rawAspectRatio = typeof params.kieNanoBanana2LiteAspectRatio === 'string'
        ? params.kieNanoBanana2LiteAspectRatio
        : typeof params.aspect_ratio === 'string' ? params.aspect_ratio : 'smart'
      const imageRatioHint = typeof params.__firstImageRatio === 'number' && Number.isFinite(params.__firstImageRatio) && params.__firstImageRatio > 0
        ? params.__firstImageRatio
        : 1
      const aspectRatio = rawAspectRatio === 'smart' || rawAspectRatio === 'auto' || rawAspectRatio.length === 0
        ? resolveClosestAspectRatio(imageRatioHint)
        : rawAspectRatio
      const images = resolveImages()
      const input: DynamicValueMap = {
        prompt: typeof params.prompt === 'string' ? params.prompt.slice(0, 20000) : '',
        aspect_ratio: supportedAspectRatios.includes(aspectRatio) ? aspectRatio : '1:1'
      }

      if (images.length > 0) input.image_urls = images.slice(0, 10)

      return { model: 'nano-banana-2-lite', input }
    }
  },
  pricing: {
    currency: '$',
    calculator: () => 0.02,
    description: '1K $0.02/张'
  }
})

export default kieNanoBanana2LiteModel
