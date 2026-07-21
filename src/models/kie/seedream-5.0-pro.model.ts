/**
 * KIE Seedream 5.0 Pro 图片生成与编辑模型
 */

import { defineModel, sharedFieldText, sharedOptionText } from '@/core'
import type { CompositePanelDef } from '@/core/types'
import { countUploadedImages } from './mediaSources'

const KIE_CREATE_TASK_ENDPOINT = '/api/v1/jobs/createTask'

const SUPPORTED_ASPECT_RATIOS = ['1:1', '4:3', '3:4', '16:9', '9:16', '2:3', '3:2', '21:9'] as const

export const kieSeedream50ProModel = defineModel({
  meta: {
    id: 'kie-seedream-5.0-pro',
    seriesId: 'seedream',
    seriesRank: 5.0,
    provider: 'kie',
    type: 'image',
    i18nScope: 'models.defs.kie-seedream-5.0-pro',
    name: { key: 'meta.name', fallback: 'Seedream 5.0 Pro' },
    description: { key: 'meta.description', fallback: 'KIE Seedream 5.0 Pro image generation and editing model' },
    tags: ['text-to-image', 'image-to-image', 'multi-image', 'provider-kie'],
    aliases: ['seedream-5-pro-kie']
  },
  inputLimits: {
    images: { max: 10 },
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
            { value: '2K', label: '2K' }
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
      const quality = resolution.quality === '2K' || resolution.quality === 'high' ? 'high' : 'basic'
      const images = resolveImages()
      const input: DynamicValueMap = {
        prompt: typeof params.prompt === 'string' ? params.prompt : '',
        aspect_ratio: supportedAspectRatios.includes(aspectRatio) ? aspectRatio : '1:1',
        quality
      }

      if (images.length > 0) input.image_urls = images.slice(0, 10)

      return {
        model: images.length > 0 ? 'seedream/5-pro-image-to-image' : 'seedream/5-pro-text-to-image',
        input
      }
    }
  },
  pricing: {
    currency: '$',
    calculator: (params) => {
      const resolution = params.resolution && typeof params.resolution === 'object'
        ? params.resolution as DynamicValueMap
        : undefined
      const outputPrice = resolution?.quality === '2K' || resolution?.quality === 'high' ? 0.07 : 0.035
      return outputPrice + Math.max(0, countUploadedImages(params) - 1) * 0.0025
    },
    description: '1K $0.035/张，2K $0.07/张；首张输入免费，后续输入 $0.0025/张'
  }
})

export default kieSeedream50ProModel
