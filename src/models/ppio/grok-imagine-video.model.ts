import { defineModel, sharedFieldText, sharedModeText, sharedOptionText } from '@/core'
import { resolvePpioImageSources, resolvePpioVideoSources, resolvePpioPrimaryVideoSource } from './mediaSources'

const SUPPORTED_ASPECT_RATIOS = ['16:9', '1:1', '9:16'] as const
const SUPPORTED_RESOLUTIONS = ['480p', '720p'] as const
const DEFAULT_TEXT_IMAGE_DURATION = 6
const DEFAULT_VIDEO_EDIT_DURATION = 8

export const grokImagineVideoModel = defineModel({
  meta: {
    id: 'ppio-grok-imagine-video',
    provider: 'ppio',
    type: 'video',
    i18nScope: 'models.defs.ppio-grok-imagine-video',
    name: { key: 'meta.name', fallback: 'Grok Imagine Video' },
    description: {
      key: 'meta.description',
      fallback: 'PPIO Grok Imagine Video model supporting text/image-to-video and video editing'
    },
    tags: [
      'text-to-video',
      'image-to-video',
      'video-to-video',
      'supports-video-editing',
      'provider-ppio'
    ],
    polling: {
      interval: 3000,
      maxAttempts: 120,
      expectedAttempts: 50
    }
  },
  inputLimits: {
    images: { max: 1 },
    videos: { max: 1 },
    rules: [
      {
        when: 'ppioGrokImagineVideoMode === "text-image-to-video"',
        images: { max: 1 },
        videos: { exact: 0 }
      },
      {
        when: 'ppioGrokImagineVideoMode === "video-edit"',
        images: { max: 0 },
        videos: { exact: 1 },
        videoConstraints: {
          maxDurationSec: 8.7
        }
      }
    ]
  },
  requirements: [
    {
      id: 'grok-imagine-video-edit-video-required',
      when: 'ppioGrokImagineVideoMode === "video-edit"',
      require: { videos: { exact: 1 } },
      message: {
        title: '视频必需',
        message: '视频编辑模式需要上传 1 个视频后才能生成',
        type: 'warning'
      }
    }
  ],
  params: [
    {
      id: 'ppioGrokImagineVideoMode',
      type: 'dropdown',
      order: 1,
      valueType: 'string',
      name: sharedFieldText('mode'),
      default: 'text-image-to-video',
      options: [
        { value: 'text-image-to-video', label: sharedModeText('textImageToVideo') },
        { value: 'video-edit', label: sharedModeText('videoEdit') }
      ]
    },
    {
      id: 'ppioGrokImagineVideoDuration',
      type: 'dropdown',
      order: 2,
      valueType: 'number',
      name: sharedFieldText('duration'),
      default: DEFAULT_TEXT_IMAGE_DURATION,
      visible: {
        condition: 'ppioGrokImagineVideoMode === "text-image-to-video"'
      },
      options: [6, 7, 8, 9, 10].map((value) => ({ value, label: `${value}s` }))
    },
    {
      id: 'ppioGrokImagineVideoAspectRatio',
      type: 'dropdown',
      order: 3,
      valueType: 'string',
      name: sharedFieldText('aspectRatio'),
      default: 'smart',
      visible: {
        condition: (params) => {
          const mode = params.ppioGrokImagineVideoMode || 'text-image-to-video'
          const uploadedImages = Array.isArray(params.uploadedImages) ? params.uploadedImages : []
          return mode === 'text-image-to-video' && uploadedImages.length === 0
        },
        reason: '仅文生视频支持设置宽高比'
      },
      options: [
        { value: 'smart', label: sharedOptionText('smart') },
        ...SUPPORTED_ASPECT_RATIOS.map((ratio) => ({ value: ratio, label: ratio }))
      ]
    },
    {
      id: 'ppioGrokImagineVideoResolution',
      type: 'dropdown',
      order: 4,
      valueType: 'string',
      name: sharedFieldText('resolution'),
      default: '720p',
      options: SUPPORTED_RESOLUTIONS.map((value) => ({ value, label: value.toUpperCase() }))
    }
  ],
  linkages: [
    {
      trigger: 'uploadedVideos',
      effect: 'autoSwitch',
      target: 'ppioGrokImagineVideoMode',
      condition: (videos, allParams) => {
        const videoCount = Array.isArray(videos) ? videos.length : 0
        const mode = allParams.ppioGrokImagineVideoMode || 'text-image-to-video'
        return videoCount > 0 && mode === 'text-image-to-video'
      },
      value: 'video-edit'
    }
  ],
  endpoints: {
    default: '/async/grok-imagine-video-t2v',
    selector: (params) => {
      const images = resolvePpioImageSources(params)
      const videos = resolvePpioVideoSources(params)
      const rawMode = typeof params.ppioGrokImagineVideoMode === 'string'
        ? params.ppioGrokImagineVideoMode
        : (typeof params.mode === 'string' ? params.mode : '')
      const mode = rawMode || (videos.length > 0 ? 'video-edit' : 'text-image-to-video')

      if (mode === 'video-edit') {
        return '/async/grok-imagine-video-edit'
      }

      return images.length > 0
        ? '/async/grok-imagine-video-i2v'
        : '/async/grok-imagine-video-t2v'
    }
  },
  request: {
    builder: (params) => {
      const supportedAspectRatios = ['16:9', '1:1', '9:16']
      const supportedResolutions = ['480p', '720p']
      const images = resolvePpioImageSources(params)
      const videos = resolvePpioVideoSources(params)
      const video = resolvePpioPrimaryVideoSource(params) || videos[0]
      const rawMode = typeof params.ppioGrokImagineVideoMode === 'string'
        ? params.ppioGrokImagineVideoMode
        : (typeof params.mode === 'string' ? params.mode : '')
      const mode = rawMode || (videos.length > 0 ? 'video-edit' : 'text-image-to-video')

      const normalizeDuration = (value: unknown): number => {
        const parsed = Number(value)
        if (!Number.isFinite(parsed)) {
          return 6
        }
        return Math.min(10, Math.max(6, Math.round(parsed)))
      }

      const parseAspectRatio = (value: unknown): number | null => {
        if (typeof value !== 'string' || value.indexOf(':') < 0) {
          return null
        }
        const [width, height] = value.split(':').map(Number)
        if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
          return null
        }
        return width / height
      }

      const resolveClosestAspectRatio = (targetRatio: number): string => {
        let bestRatio = '1:1'
        let bestDistance = Number.POSITIVE_INFINITY

        for (const candidate of supportedAspectRatios) {
          const candidateRatio = parseAspectRatio(candidate)
          if (candidateRatio === null) {
            continue
          }

          const distance = Math.abs(candidateRatio - targetRatio)
          if (distance < bestDistance) {
            bestDistance = distance
            bestRatio = candidate
          }
        }

        return bestRatio
      }

      const rawResolution = typeof params.ppioGrokImagineVideoResolution === 'string'
        ? params.ppioGrokImagineVideoResolution
        : (typeof params.resolution === 'string' ? params.resolution : '')
      const normalizedResolution = rawResolution.toLowerCase()
      const defaultResolution = mode === 'video-edit' ? '480p' : '720p'
      const resolution = supportedResolutions.includes(normalizedResolution)
        ? normalizedResolution
        : defaultResolution
      const prompt = typeof params.prompt === 'string' ? params.prompt.slice(0, 4096) : ''

      if (mode === 'video-edit') {
        return {
          video,
          prompt,
          resolution
        }
      }

      const durationValue = params.ppioGrokImagineVideoDuration ?? params.duration
      const duration = normalizeDuration(durationValue)

      if (images.length > 0) {
        return {
          image: images[0],
          prompt,
          duration,
          resolution
        }
      }

      const imageRatioHint = typeof params.__firstImageRatio === 'number' &&
        Number.isFinite(params.__firstImageRatio) &&
        params.__firstImageRatio > 0
        ? params.__firstImageRatio
        : 1
      const rawAspectRatio = typeof params.ppioGrokImagineVideoAspectRatio === 'string'
        ? params.ppioGrokImagineVideoAspectRatio
        : (typeof params.aspect_ratio === 'string' ? params.aspect_ratio : 'smart')
      const aspectRatio = rawAspectRatio === 'smart' || rawAspectRatio === 'auto' || rawAspectRatio.length === 0
        ? resolveClosestAspectRatio(imageRatioHint)
        : rawAspectRatio
      const normalizedAspectRatio = supportedAspectRatios.includes(aspectRatio)
        ? aspectRatio
        : '1:1'

      return {
        prompt,
        duration,
        resolution,
        aspect_ratio: normalizedAspectRatio
      }
    }
  },
  pricing: {
    currency: '¥',
    calculator: (params) => {
      const normalizeDuration = (value: unknown): number => {
        const parsed = Number(value)
        if (!Number.isFinite(parsed)) {
          return 6
        }
        return Math.min(10, Math.max(6, Math.round(parsed)))
      }

      const normalizeEditDuration = (value: unknown): number => {
        const parsed = Number(value)
        if (!Number.isFinite(parsed) || parsed <= 0) {
          return 8
        }
        return Math.min(8.7, parsed)
      }

      const videos = resolvePpioVideoSources(params)
      const rawMode = typeof params.ppioGrokImagineVideoMode === 'string'
        ? params.ppioGrokImagineVideoMode
        : (typeof params.mode === 'string' ? params.mode : '')
      const mode = rawMode || (videos.length > 0 ? 'video-edit' : 'text-image-to-video')

      const rawResolution = typeof params.ppioGrokImagineVideoResolution === 'string'
        ? params.ppioGrokImagineVideoResolution
        : (typeof params.resolution === 'string' ? params.resolution : '')
      const resolution = rawResolution.toLowerCase() === '480p' ? '480p' : '720p'

      if (mode === 'video-edit') {
        const duration = normalizeEditDuration(
          params.uploadedVideoDuration ?? params.videoDuration ?? params.duration
        )
        const pricePerSecond = resolution === '720p' ? 0.55 : 0.41
        return pricePerSecond * duration
      }

      const duration = normalizeDuration(params.ppioGrokImagineVideoDuration ?? params.duration)
      const pricePerSecond = resolution === '720p' ? 0.48 : 0.34
      return pricePerSecond * duration
    },
    description: '文/图生：480P ¥0.34/秒，720P ¥0.48/秒；视频编辑：480P ¥0.41/秒，720P ¥0.55/秒（视频编辑按上传视频时长计费，缺省按 8 秒估算）'
  }
})

export default grokImagineVideoModel
