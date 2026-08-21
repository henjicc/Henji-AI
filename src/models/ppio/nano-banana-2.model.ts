import { defineModel, sharedFieldText, sharedOptionText } from '@/core'
import { resolvePpioImageSources } from './mediaSources'

const SUPPORTED_ASPECT_RATIOS = [
  '1:1',
  '1:4',
  '1:8',
  '2:3',
  '3:2',
  '3:4',
  '4:1',
  '4:3',
  '4:5',
  '5:4',
  '8:1',
  '9:16',
  '16:9',
  '21:9'
] as const

export const nanoBanana2Model = defineModel({
  meta: {
    id: 'ppio-nano-banana-2',
    canonicalModelId: 'nano-banana-2',
    seriesId: 'nano-banana',
    seriesRank: 3,
    provider: 'ppio',
    type: 'image',
    i18nScope: 'models.defs.ppio-nano-banana-2',
    name: { key: 'meta.name', fallback: 'Nano Banana 2' },
    tags: ['text-to-image', 'image-to-image', 'supports-4k', 'provider-ppio']
  },
  inputLimits: {
    images: { max: 14 },
    videos: { max: 0 }
  },
  params: [
    {
      id: 'ppioNanoBanana2AspectRatio',
      type: 'dropdown',
      order: 1,
      name: sharedFieldText('aspectRatio'),
      default: 'smart',
      options: [
        { value: 'smart', label: sharedOptionText('smart') },
        ...SUPPORTED_ASPECT_RATIOS.map((ratio) => ({ value: ratio, label: ratio }))
      ]
    },
    {
      id: 'ppioNanoBanana2Resolution',
      type: 'dropdown',
      order: 2,
      name: sharedFieldText('resolution'),
      default: '1K',
      options: [
        { value: '0.5K', label: '0.5K' },
        { value: '1K', label: '1K' },
        { value: '2K', label: '2K' },
        { value: '4K', label: '4K' }
      ]
    },
  ],
  linkages: [],
  endpoints: {
    selector: (params) => {
      const requestImages = resolvePpioImageSources(params)
      return requestImages.length > 0
        ? '/gemini-3.1-flash-image-edit'
        : '/gemini-3.1-flash-image-text-to-image'
    }
  },
  request: {
    builder: (params) => {
      const requestImages = resolvePpioImageSources(params)
      const supportedAspectRatios = [
        '1:1',
        '1:4',
        '1:8',
        '2:3',
        '3:2',
        '3:4',
        '4:1',
        '4:3',
        '4:5',
        '5:4',
        '8:1',
        '9:16',
        '16:9',
        '21:9'
      ]
      const parseAspectRatio = (value: string): number | null => {
        if (typeof value !== 'string' || value.indexOf(':') === -1) {
          return null
        }
        const parts = value.split(':').map(Number)
        if (parts.length !== 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1]) || parts[0] <= 0 || parts[1] <= 0) {
          return null
        }
        return parts[0] / parts[1]
      }
      const resolveClosestAspectRatio = (targetRatio: number): string => {
        let bestValue = '1:1'
        let bestDistance = Number.POSITIVE_INFINITY

        for (const candidate of supportedAspectRatios) {
          const ratio = parseAspectRatio(candidate)
          if (ratio === null) {
            continue
          }
          const distance = Math.abs(ratio - targetRatio)
          if (distance < bestDistance) {
            bestDistance = distance
            bestValue = candidate
          }
        }

        return bestValue
      }

      const legacyResolution = params.resolution && typeof params.resolution === 'object'
        ? params.resolution as DynamicValueMap
        : undefined
      const quality = typeof legacyResolution?.quality === 'string'
        ? legacyResolution.quality
        : String(params.ppioNanoBanana2Resolution || '1K')
      const rawAspectRatio = typeof legacyResolution?.aspectRatio === 'string'
        ? legacyResolution.aspectRatio
        : String(params.ppioNanoBanana2AspectRatio || 'smart')
      const imageRatioHint = typeof params.__firstImageRatio === 'number' && Number.isFinite(params.__firstImageRatio) && params.__firstImageRatio > 0
        ? params.__firstImageRatio
        : 1
      const aspectRatio = rawAspectRatio === 'smart' || rawAspectRatio === 'auto' || rawAspectRatio.length === 0
        ? resolveClosestAspectRatio(imageRatioHint)
        : rawAspectRatio

      const requestData: DynamicValueMap = {
        prompt: typeof params.prompt === 'string' ? params.prompt : '',
        size: quality === '0.5K' || quality === '1K' || quality === '2K' || quality === '4K' ? quality : '1K',
        aspect_ratio: supportedAspectRatios.includes(aspectRatio) ? aspectRatio : '1:1'
      }

      if (requestImages.length > 0) {
        requestData.image_base64s = requestImages.slice(0, 14)
      }

      return requestData
    }
  },
  pricing: {
    currency: '¥',
    calculator: (params) => {
      const legacyResolution = params.resolution && typeof params.resolution === 'object'
        ? params.resolution as DynamicValueMap
        : undefined
      const quality = typeof legacyResolution?.quality === 'string'
        ? legacyResolution.quality
        : String(params.ppioNanoBanana2Resolution || '1K')

      if (quality === '0.5K') return 0.315
      if (quality === '2K') return 0.707
      if (quality === '4K') return 1.057
      return 0.469
    },
    description: '0.5K ￥0.315/张，1K ￥0.469/张，2K ￥0.707/张，4K ￥1.057/张'
  }
})

export default nanoBanana2Model
