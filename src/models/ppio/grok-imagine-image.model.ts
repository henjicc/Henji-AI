import { defineModel, sharedFieldText, sharedOptionText } from '@/core'

const SUPPORTED_ASPECT_RATIOS = [
  '2:1',
  '20:9',
  '16:9',
  '4:3',
  '3:2',
  '1:1',
  '2:3',
  '3:4',
  '9:16',
  '9:20',
  '1:2'
] as const

export const grokImagineImageModel = defineModel({
  meta: {
    id: 'ppio-grok-imagine-image',
    provider: 'ppio',
    type: 'image',
    i18nScope: 'models.defs.ppio-grok-imagine-image',
    name: { key: 'meta.name', fallback: 'Grok Imagine Image' },
    description: {
      key: 'meta.description',
      fallback: 'PPIO Grok Imagine Image model with automatic switching between text-to-image and image editing'
    },
    tags: ['text-to-image', 'image-to-image', 'provider-ppio'],
    polling: {
      interval: 3000,
      maxAttempts: 120,
      expectedAttempts: 20
    }
  },
  inputLimits: {
    images: { max: 1 },
    videos: { max: 0 }
  },
  params: [
    {
      id: 'aspectRatio',
      type: 'dropdown',
      order: 1,
      name: sharedFieldText('aspectRatio'),
      default: 'smart',
      visible: {
        condition: (params) => {
          const uploadedImages = Array.isArray(params.uploadedImages) ? params.uploadedImages : []
          return uploadedImages.length === 0
        },
        reason: '仅文生图模式支持设置比例'
      },
      options: [
        { value: 'smart', label: sharedOptionText('smart') },
        ...SUPPORTED_ASPECT_RATIOS.map((ratio) => ({ value: ratio, label: ratio }))
      ]
    }
  ],
  linkages: [],
  endpoints: {
    default: '/async/grok-imagine-image-t2i',
    selector: (params) => {
      const uploadedFilePaths = Array.isArray(params.uploadedFilePaths)
        ? params.uploadedFilePaths.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : []
      const legacyImages = Array.isArray(params.images)
        ? params.images.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : []
      const requestImages = uploadedFilePaths.length > 0 ? uploadedFilePaths : legacyImages

      return requestImages.length > 0
        ? '/async/grok-imagine-image-edit'
        : '/async/grok-imagine-image-t2i'
    }
  },
  request: {
    builder: (params) => {
      const uploadedFilePaths = Array.isArray(params.uploadedFilePaths)
        ? params.uploadedFilePaths.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : []
      const legacyImages = Array.isArray(params.images)
        ? params.images.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : []
      const requestImages = uploadedFilePaths.length > 0 ? uploadedFilePaths : legacyImages
      const supportedAspectRatios = ['2:1', '20:9', '16:9', '4:3', '3:2', '1:1', '2:3', '3:4', '9:16', '9:20', '1:2']
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

      const requestData: DynamicValueMap = {
        prompt: typeof params.prompt === 'string' ? params.prompt : ''
      }

      if (requestImages.length > 0) {
        requestData.image = requestImages[0]
        return requestData
      }

      const imageRatioHint = typeof params.__firstImageRatio === 'number' && Number.isFinite(params.__firstImageRatio) && params.__firstImageRatio > 0
        ? params.__firstImageRatio
        : 1
      const rawAspectRatio = typeof params.aspectRatio === 'string'
        ? params.aspectRatio
        : 'smart'
      const aspectRatio = rawAspectRatio === 'smart' || rawAspectRatio === 'auto' || rawAspectRatio.length === 0
        ? resolveClosestAspectRatio(imageRatioHint)
        : rawAspectRatio
      requestData.aspect_ratio = supportedAspectRatios.includes(aspectRatio) ? aspectRatio : '1:1'

      return requestData
    }
  },
  pricing: {
    currency: '¥',
    calculator: () => 0.154,
    description: '￥0.154 /张'
  }
})

export default grokImagineImageModel
