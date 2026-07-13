/**
 * KIE Nano Banana 2 图片生成与参考图编辑模型
 */

import { defineModel, sharedFieldText, sharedOptionText } from '@/core'
import type { CompositePanelDef } from '@/core/types'

const KIE_CREATE_TASK_ENDPOINT = '/api/v1/jobs/createTask'

const SUPPORTED_ASPECT_RATIOS = [
  '1:1', '1:4', '1:8', '2:3', '3:2', '3:4', '4:1', '4:3', '4:5', '5:4', '8:1', '9:16', '16:9', '21:9'
] as const

export const kieNanoBanana2Model = defineModel({
  meta: {
    id: 'kie-nano-banana-2',
    seriesId: 'nano-banana',
    seriesRank: 2,
    provider: 'kie',
    type: 'image',
    i18nScope: 'models.defs.kie-nano-banana-2',
    name: { key: 'meta.name', fallback: 'Nano Banana 2' },
    description: { key: 'meta.description', fallback: 'KIE Nano Banana 2 image generation and reference image editing model' },
    tags: ['text-to-image', 'image-to-image', 'multi-image', 'supports-4k', 'provider-kie'],
    aliases: ['nano-banana-2-kie']
  },
  inputLimits: {
    images: { max: 14 },
    videos: { max: 0 }
  },
  params: [
    {
      id: 'resolution',
      type: 'composite',
      order: 1,
      name: sharedFieldText('resolution'),
      panel: 'resolution',
      default: {
        mode: 'aspect-quality',
        aspectRatio: 'smart',
        quality: '1K'
      },
      config: {
        mode: 'aspect-quality',
        aspectRatios: {
          options: [
            { value: 'smart', label: sharedOptionText('smart') },
            ...SUPPORTED_ASPECT_RATIOS.map((ratio) => ({ value: ratio, label: ratio }))
          ],
          default: 'smart',
          smartMatch: true
        },
        qualityTiers: {
          options: [
            { value: '1K', label: '1K' },
            { value: '2K', label: '2K' },
            { value: '4K', label: '4K' }
          ],
          default: '1K'
        }
      }
    } as CompositePanelDef
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

      const resolution = params.resolution && typeof params.resolution === 'object'
        ? params.resolution as DynamicValueMap
        : {}
      const rawAspectRatio = typeof resolution.aspectRatio === 'string' ? resolution.aspectRatio : 'smart'
      const imageRatioHint = typeof params.__firstImageRatio === 'number' && Number.isFinite(params.__firstImageRatio) && params.__firstImageRatio > 0
        ? params.__firstImageRatio
        : 1
      const aspectRatio = rawAspectRatio === 'smart' || rawAspectRatio === 'auto' || rawAspectRatio.length === 0
        ? resolveClosestAspectRatio(imageRatioHint)
        : rawAspectRatio
      const images = resolveImages()
      const input: DynamicValueMap = {
        prompt: typeof params.prompt === 'string' ? params.prompt : '',
        aspect_ratio: supportedAspectRatios.includes(aspectRatio) ? aspectRatio : '1:1',
        resolution: resolution.quality === '4K' || resolution.quality === '2K' ? resolution.quality : '1K'
      }

      if (images.length > 0) input.image_input = images.slice(0, 14)

      return { model: 'nano-banana-2', input }
    }
  },
  pricing: {
    currency: '$',
    calculator: (params) => {
      const resolution = params.resolution && typeof params.resolution === 'object'
        ? params.resolution as DynamicValueMap
        : undefined
      if (resolution?.quality === '4K') return 0.09
      if (resolution?.quality === '2K') return 0.06
      return 0.04
    },
    description: '1K $0.04/张，2K $0.06/张，4K $0.09/张'
  }
})

export default kieNanoBanana2Model
