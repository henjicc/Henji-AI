/**
 * KIE Seedream 4.5 图片生成模型
 */

import { defineModel, sharedFieldText, sharedOptionText } from '@/core'
import { resolveKieImageSources } from './mediaSources'

const KIE_CREATE_TASK_ENDPOINT = '/api/v1/jobs/createTask'

export const kieSeedream45Model = defineModel({
  meta: {
    id: 'kie-seedream-4.5',
    seriesId: 'seedream',
    seriesRank: 4.5,
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
      const mapSeedream45Quality = (value: string): string => {
        if (value === '4K' || value === 'high') return 'high'
        return 'basic'
      }

      const images = resolveKieImageSources(params)
      const prompt = params.prompt || ''
      const aspectRatio = params.kieSeedreamAspectRatio || params.aspect_ratio
      const quality = params.kieSeedreamQuality || params.quality
      const ratioHint = typeof params.__firstImageRatio === 'number' &&
        Number.isFinite(params.__firstImageRatio) &&
        params.__firstImageRatio > 0
        ? params.__firstImageRatio
        : null

      const modelName = images.length === 0
        ? 'seedream/4.5-text-to-image'
        : 'seedream/4.5-edit'

      const input: DynamicValueMap = { prompt }

      const aspectRatioText = typeof aspectRatio === 'string' ? aspectRatio : ''
      input.aspect_ratio =
        !aspectRatioText || aspectRatioText === 'smart' || aspectRatioText === 'auto'
          ? (ratioHint ? pickClosestRatio(ratioHint) : '1:1')
          : aspectRatioText

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
