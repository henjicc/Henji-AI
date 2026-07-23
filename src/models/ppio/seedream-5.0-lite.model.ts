import { defineModel, sharedFieldText, sharedOptionText, sharedText } from '@/core'
import type { CompositePanelDef } from '@/core/types'
import { normalizeSeedreamSizeString } from '@/models/shared/seedreamResolution'
import { resolvePpioImageSources } from './mediaSources'

const MIN_ASPECT_RATIO = 1 / 16
const MAX_ASPECT_RATIO = 16
const MIN_PIXELS = 3686400
const MAX_PIXELS = 10404496

const SUPPORTED_ASPECT_RATIOS = ['21:9', '16:9', '3:2', '4:3', '1:1', '3:4', '2:3', '9:16'] as const
const SEEDREAM_50_CONSTRAINTS = {
  minSide: 256,
  maxSide: 12900,
  minAspectRatio: MIN_ASPECT_RATIO,
  maxAspectRatio: MAX_ASPECT_RATIO,
  minPixels: MIN_PIXELS,
  maxPixels: MAX_PIXELS,
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function toInteger(value: DynamicValue): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value)
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return null
}

export const seedream50LiteModel = defineModel({
  meta: {
    id: 'ppio-seedream-5.0-lite',
    canonicalModelId: 'seedream-5.0-lite',
    seriesId: 'seedream',
    seriesRank: 5.0,
    provider: 'ppio',
    type: 'image',
    i18nScope: 'models.defs.ppio-seedream-5.0-lite',
    name: { key: 'meta.name', fallback: 'Seedream 5.0 Lite' },
    tags: ['text-to-image', 'image-to-image', 'multi-image', 'provider-ppio'],
    polling: {
      interval: 3000,
      maxAttempts: 120,
      expectedAttempts: 20
    }
  },
  inputLimits: {
    images: { max: 14 },
    videos: { max: 0 }
  },
  runtimeConstraints: {
    imageSizeFields: [
      {
        field: 'size',
        format: 'string',
        minPixels: 3686400,
        maxPixels: 10404496,
        minAspectRatio: 1 / 16,
        maxAspectRatio: 16
      }
    ]
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
        quality: '2K'
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
            { value: '2K', label: sharedOptionText('hd2k') },
            { value: '4K', label: sharedOptionText('uhd4k') }
          ],
          default: '2K'
        },
        customSize: {
          enabled: true,
          minWidth: 256,
          maxWidth: 12900,
          minHeight: 256,
          maxHeight: 12900,
          step: 1,
          lockRatio: false
        }
      }
    } as CompositePanelDef,
    {
      id: 'maxImages',
      type: 'number',
      order: 2,
      name: sharedFieldText('quantity'),
      tooltip: sharedText('tips.numberOfImagesLimit'),
      default: 1,
      min: 1,
      max: 15,
      step: 1
    },
    {
      id: 'optimizePrompt',
      type: 'switch',
      order: 3,
      name: sharedFieldText('promptOptimization'),
      tooltip: sharedText('tips.promptOptimization'),
      default: false
    }
  ],
  linkages: [],
  endpoints: '/seedream-5.0-lite',
  request: {
    builder: (params) => {
      const localClamp = (value: number, min: number, max: number): number =>
        Math.min(max, Math.max(min, value))
      const localToInteger = (value: DynamicValue): number | null => {
        if (typeof value === 'number' && Number.isFinite(value)) {
          return Math.trunc(value)
        }
        if (typeof value === 'string' && value.trim().length > 0) {
          const parsed = Number.parseInt(value, 10)
          return Number.isFinite(parsed) ? parsed : null
        }
        return null
      }
      const localToPositiveNumber = (value: DynamicValue): number | null => {
        if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
          return value
        }
        if (typeof value === 'string' && value.trim().length > 0) {
          const parsed = Number(value)
          return Number.isFinite(parsed) && parsed > 0 ? parsed : null
        }
        return null
      }
      const localParseAspectRatio = (aspectRatio: string): number | null => {
        const pair = aspectRatio.split(':').map(Number)
        if (pair.length !== 2 || !Number.isFinite(pair[0]) || !Number.isFinite(pair[1]) || pair[0] <= 0 || pair[1] <= 0) {
          return null
        }
        return pair[0] / pair[1]
      }
      const localNormalizeSizeByRatioAndPixels = (ratio: number, targetPixels: number): { width: number; height: number } => {
        const minAspectRatio = 1 / 16
        const maxAspectRatio = 16
        const minPixels = 3686400
        const maxPixels = 10404496

        const normalizedRatio = localClamp(ratio, minAspectRatio, maxAspectRatio)
        const normalizedPixels = localClamp(targetPixels, minPixels, maxPixels)

        let height = Math.sqrt(normalizedPixels / normalizedRatio)
        let width = height * normalizedRatio

        width = Math.max(1, Math.round(width))
        height = Math.max(1, Math.round(height))

        let pixelCount = width * height
        if (pixelCount < minPixels) {
          const scale = Math.sqrt(minPixels / pixelCount)
          width = Math.max(1, Math.ceil(width * scale))
          height = Math.max(1, Math.ceil(height * scale))
        } else if (pixelCount > maxPixels) {
          const scale = Math.sqrt(maxPixels / pixelCount)
          width = Math.max(1, Math.floor(width * scale))
          height = Math.max(1, Math.floor(height * scale))
        }

        pixelCount = width * height
        if (pixelCount < minPixels) {
          if (width >= height) {
            width += Math.ceil((minPixels - pixelCount) / Math.max(1, height))
          } else {
            height += Math.ceil((minPixels - pixelCount) / Math.max(1, width))
          }
        } else if (pixelCount > maxPixels) {
          if (width >= height) {
            width = Math.max(1, width - Math.ceil((pixelCount - maxPixels) / Math.max(1, height)))
          } else {
            height = Math.max(1, height - Math.ceil((pixelCount - maxPixels) / Math.max(1, width)))
          }
        }

        return { width, height }
      }
      const localResolveRequestSize = (): string => {
        const resolutionRecord = params.resolution && typeof params.resolution === 'object'
          ? params.resolution as DynamicValueMap
          : undefined

        if (!resolutionRecord) {
          const size = normalizeSeedreamSizeString(
            typeof params.size === 'string' ? params.size.trim() : undefined,
            SEEDREAM_50_CONSTRAINTS
          )
          return size ?? '2048x2048'
        }

        const aspectRatioRaw = typeof resolutionRecord.aspectRatio === 'string' ? resolutionRecord.aspectRatio : 'smart'
        const isSmartAspect = aspectRatioRaw === 'smart' || aspectRatioRaw === 'auto' || aspectRatioRaw.length === 0
        const width = localToPositiveNumber(resolutionRecord.width)
        const height = localToPositiveNumber(resolutionRecord.height)
        if (!isSmartAspect && width && height) {
          const normalized = localNormalizeSizeByRatioAndPixels(width / height, width * height)
          return `${normalized.width}x${normalized.height}`
        }

        const quality = resolutionRecord.quality === '4K' ? '4K' : '2K'
        const targetPixels = quality === '4K' ? 10404496 : 2048 * 2048
        const smartRatioHint = typeof params.__firstImageRatio === 'number' && Number.isFinite(params.__firstImageRatio) && params.__firstImageRatio > 0
          ? params.__firstImageRatio
          : 1
        const ratio = !isSmartAspect
          ? (localParseAspectRatio(aspectRatioRaw) ?? 1)
          : smartRatioHint
        const normalized = localNormalizeSizeByRatioAndPixels(ratio, targetPixels)
        return `${normalized.width}x${normalized.height}`
      }

      const requestImages = resolvePpioImageSources(params)
      const rawMaxImages = localToInteger(params.maxImages) ?? localToInteger(params.max_images) ?? 1
      const maxGeneratedImages = localClamp(rawMaxImages, 1, Math.max(1, 15 - requestImages.length))
      const size = localResolveRequestSize()

      const requestData: DynamicValueMap = {
        prompt: typeof params.prompt === 'string' ? params.prompt : '',
        size,
        watermark: false,
        sequential_image_generation: maxGeneratedImages > 1 ? 'auto' : 'disabled'
      }

      if (requestImages.length > 0) {
        requestData.image = requestImages
      }

      if (maxGeneratedImages > 1) {
        requestData.sequential_image_generation_options = {
          max_images: maxGeneratedImages
        }
      }

      if (params.optimizePrompt === true) {
        requestData.optimize_prompt_options = {
          mode: 'standard'
        }
      }

      return requestData
    }
  },
  pricing: {
    currency: '¥',
    calculator: (params) => {
      const rawMaxImages = toInteger(params.maxImages) ?? toInteger(params.max_images) ?? 1
      const maxImages = clamp(rawMaxImages, 1, 15)
      return 0.245 * maxImages
    },
    description: '基础价格 ¥0.245/张'
  }
})

export default seedream50LiteModel
