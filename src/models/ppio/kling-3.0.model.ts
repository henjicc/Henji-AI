import { defineModel, sharedFieldText } from '@/core'

export const kling30Model = defineModel({
  meta: {
    id: 'ppio-kling-3.0',
    provider: 'ppio',
    type: 'video',
    i18nScope: 'models.defs.ppio-kling-3.0',
    name: { key: 'meta.name', fallback: 'Kling 3.0' },
    description: {
      key: 'meta.description',
      fallback: 'PPIO Kling video generation model v3.0 with automatic switching between Standard/Pro resolution and text/image-to-video'
    },
    tags: ['text-to-video', 'image-to-video', 'provider-ppio'],
    polling: {
      interval: 3000,
      maxAttempts: 120,
      expectedAttempts: 50
    }
  },
  inputLimits: {
    images: { max: 2 },
    videos: { max: 0 }
  },
  params: [
    {
      id: 'ppioKling30Resolution',
      type: 'dropdown',
      order: 1,
      valueType: 'string',
      name: sharedFieldText('resolution'),
      default: '720P',
      options: [
        { value: '720P', label: '720P' },
        { value: '1080P', label: '1080P' }
      ]
    },
    {
      id: 'ppioKling30Duration',
      type: 'dropdown',
      order: 2,
      valueType: 'number',
      name: sharedFieldText('duration'),
      default: 5,
      options: Array.from({ length: 13 }, (_, index) => {
        const value = index + 3
        return { value, label: `${value}s` }
      })
    },
    {
      id: 'ppioKling30AspectRatio',
      type: 'dropdown',
      order: 3,
      valueType: 'string',
      name: sharedFieldText('aspectRatio'),
      default: '16:9',
      visible: {
        condition: (params) => {
          const uploadedImages = Array.isArray(params.uploadedImages) ? params.uploadedImages : []
          return uploadedImages.length === 0
        },
        reason: '仅文生视频支持设置宽高比'
      },
      options: [
        { value: '16:9', label: '16:9' },
        { value: '9:16', label: '9:16' },
        { value: '1:1', label: '1:1' }
      ]
    },
    {
      id: 'ppioKling30CfgScale',
      type: 'number',
      order: 4,
      valueType: 'number',
      name: sharedFieldText('cfgScale'),
      default: 0.5,
      min: 0,
      max: 1,
      step: 0.01
    },
    {
      id: 'ppioKling30Sound',
      type: 'switch',
      order: 5,
      valueType: 'boolean',
      name: sharedFieldText('generateAudio'),
      default: false
    }
  ],
  linkages: [],
  endpoints: {
    default: '/async/kling-v3.0-std-t2v',
    selector: (params) => {
      const uploadedFilePaths = Array.isArray(params.uploadedFilePaths)
        ? params.uploadedFilePaths.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : []
      const legacyImages = Array.isArray(params.images)
        ? params.images.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : []
      const requestImages = uploadedFilePaths.length > 0 ? uploadedFilePaths : legacyImages
      const rawResolution = params.ppioKling30Resolution ?? params.resolution
      const resolution = rawResolution === '1080P' ? '1080P' : '720P'
      const version = resolution === '1080P' ? 'pro' : 'std'
      const modality = requestImages.length > 0 ? 'i2v' : 't2v'

      return `/async/kling-v3.0-${version}-${modality}`
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
      const prompt = typeof params.prompt === 'string' ? params.prompt.slice(0, 2500) : ''
      const durationValue = params.ppioKling30Duration ?? params.duration
      const duration = typeof durationValue === 'number' ? durationValue : Number(durationValue || 5)
      const cfgScaleValue = params.ppioKling30CfgScale ?? params.cfg_scale
      const cfgScale = typeof cfgScaleValue === 'number' ? cfgScaleValue : Number(cfgScaleValue ?? 0.5)
      const rawSound = params.ppioKling30Sound ?? params.sound
      const sound = rawSound === true

      const requestData: Record<string, unknown> = {
        prompt,
        duration,
        sound,
        cfg_scale: Number.isFinite(cfgScale) ? cfgScale : 0.5
      }

      if (requestImages.length > 0) {
        requestData.image = requestImages[0]
        if (requestImages.length > 1) {
          requestData.end_image = requestImages[1]
        }
        return requestData
      }

      const rawAspectRatio = params.ppioKling30AspectRatio ?? params.aspect_ratio
      const aspectRatio = rawAspectRatio === '9:16' || rawAspectRatio === '1:1' ? rawAspectRatio : '16:9'
      requestData.aspect_ratio = aspectRatio

      return requestData
    }
  },
  pricing: {
    currency: '¥',
    calculator: (params) => {
      const rawResolution = params.ppioKling30Resolution ?? params.resolution
      const resolution = rawResolution === '1080P' ? '1080P' : '720P'
      const rawSound = params.ppioKling30Sound ?? params.sound
      const sound = rawSound === true
      const durationValue = params.ppioKling30Duration ?? params.duration
      const duration = typeof durationValue === 'number' ? durationValue : Number(durationValue || 5)

      const pricePerSecond = resolution === '1080P'
        ? (sound ? 2.352 : 1.568)
        : (sound ? 1.764 : 1.176)

      return pricePerSecond * (Number.isFinite(duration) ? duration : 5)
    },
    description: '720P(Standard)：无声 ¥1.176/秒，有声 ¥1.764/秒；1080P(Pro)：无声 ¥1.568/秒，有声 ¥2.352/秒'
  }
})

export default kling30Model
