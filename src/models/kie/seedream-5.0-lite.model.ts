/**
 * KIE Seedream 5.0 Lite 图片生成与编辑模型
 */

import { defineModel, sharedFieldText, sharedOptionText } from '@/core'
import type { CompositePanelDef } from '@/core/types'

const KIE_CREATE_TASK_ENDPOINT = '/api/v1/jobs/createTask'

const SUPPORTED_ASPECT_RATIOS = ['1:1', '4:3', '3:4', '16:9', '9:16', '2:3', '3:2', '21:9'] as const

export const kieSeedream50LiteModel = defineModel({
  meta: {
    id: 'kie-seedream-5.0-lite',
    seriesId: 'seedream',
    seriesRank: 5.0,
    provider: 'kie',
    type: 'image',
    i18nScope: 'models.defs.kie-seedream-5.0-lite',
    name: { key: 'meta.name', fallback: 'Seedream 5.0 Lite' },
    description: { key: 'meta.description', fallback: 'KIE Seedream 5.0 Lite image generation and editing model' },
    tags: ['text-to-image', 'image-to-image', 'multi-image', 'provider-kie'],
    aliases: ['seedream-5-lite-kie']
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
        quality: 'basic'
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
            { value: 'basic', label: sharedOptionText('standard') },
            { value: 'high', label: sharedOptionText('high') }
          ],
          default: 'basic'
        }
      }
    } as CompositePanelDef
  ],
  linkages: [],
  endpoints: KIE_CREATE_TASK_ENDPOINT,
  request: {
    builder: (params) => {
      const supportedAspectRatios = ['1:1', '4:3', '3:4', '16:9', '9:16', '2:3', '3:2', '21:9']
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
        quality: resolution.quality === 'high' ? 'high' : 'basic'
      }

      if (images.length > 0) input.image_urls = images.slice(0, 14)

      return {
        model: images.length > 0 ? 'seedream/5-lite-image-to-image' : 'seedream/5-lite-text-to-image',
        input
      }
    }
  },
  pricing: {
    currency: '$',
    calculator: () => 0.0275,
    description: '文生图与图片编辑均为 $0.0275/张'
  }
})

export default kieSeedream50LiteModel
