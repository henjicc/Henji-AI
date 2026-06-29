import { defineModel, sharedFieldText } from '@/core'

export const viduQ3Model = defineModel({
  meta: {
    id: 'ppio-vidu-q3',
    seriesId: 'vidu',
    seriesRank: 3,
    provider: 'ppio',
    type: 'video',
    i18nScope: 'models.defs.ppio-vidu-q3',
    name: { key: 'meta.name', fallback: 'Vidu Q3' },
    description: {
      key: 'meta.description',
      fallback: 'PPIO Vidu Q3 unified model with Turbo/Pro switch and automatic text-image/start-end routing'
    },
    tags: ['text-to-video', 'image-to-video', 'start-end-frame', 'multi-mode-switch', 'provider-ppio'],
    polling: {
      interval: 3000,
      maxAttempts: 120,
      expectedAttempts: 45
    }
  },
  inputLimits: {
    images: { max: 2 },
    videos: { max: 0 },
    rules: [
      {
        when: 'ppioViduQ3Mode === "text-image-to-video"',
        images: { max: 1 }
      },
      {
        when: 'ppioViduQ3Mode === "start-end-frame"',
        images: { exact: 2 }
      }
    ]
  },
  requirements: [
    {
      id: 'vidu-q3-start-end-frame-images',
      when: 'ppioViduQ3Mode === "start-end-frame"',
      require: { images: { exact: 2 } },
      message: {
        title: '图片数量不符合要求',
        message: '首尾帧模式需要上传 2 张图片',
        type: 'warning'
      }
    }
  ],
  params: [
    {
      id: 'ppioViduQ3Mode',
      type: 'dropdown',
      order: 1,
      name: sharedFieldText('mode'),
      default: 'text-image-to-video',
      options: [
        { value: 'text-image-to-video', label: { zh: '文/图生视频', en: 'Text/Image to Video' } },
        { value: 'start-end-frame', label: { zh: '首尾帧', en: 'Start-End Frame' } }
      ],
      apiField: 'mode'
    },
    {
      id: 'ppioViduQ3ProMode',
      type: 'switch',
      order: 2,
      name: { zh: '专业模式', en: 'Pro Mode' },
      default: false
    },
    {
      id: 'ppioViduQ3Duration',
      type: 'dropdown',
      order: 3,
      name: sharedFieldText('duration'),
      default: 5,
      options: Array.from({ length: 16 }, (_, index) => {
        const value = index + 1
        return { value, label: `${value}s` }
      }),
      apiField: 'duration'
    },
    {
      id: 'ppioViduQ3Resolution',
      type: 'dropdown',
      order: 4,
      name: sharedFieldText('resolution'),
      default: '720p',
      options: [
        { value: '540p', label: '540P' },
        { value: '720p', label: '720P' },
        { value: '1080p', label: '1080P' }
      ],
      apiField: 'resolution'
    },
    {
      id: 'ppioViduQ3AspectRatio',
      type: 'dropdown',
      order: 5,
      name: sharedFieldText('aspectRatio'),
      default: 'smart',
      options: [
        { value: 'smart', label: { zh: '智能', en: 'Smart' } },
        { value: '16:9', label: '16:9' },
        { value: '9:16', label: '9:16' },
        { value: '4:3', label: '4:3' },
        { value: '3:4', label: '3:4' },
        { value: '1:1', label: '1:1' }
      ],
      apiField: 'aspect_ratio'
    },
    {
      id: 'ppioViduQ3Style',
      type: 'dropdown',
      order: 6,
      name: sharedFieldText('style'),
      default: 'general',
      options: [
        { value: 'general', label: { zh: '通用', en: 'General' } },
        { value: 'anime', label: { zh: '动漫', en: 'Anime' } }
      ],
      apiField: 'style'
    },
    {
      id: 'ppioViduQ3GenerateSpeech',
      type: 'switch',
      order: 7,
      name: { zh: '生成人声', en: 'Generate Speech' },
      default: true,
      apiField: 'audio'
    },
    {
      id: 'ppioViduQ3GenerateSoundEffect',
      type: 'switch',
      order: 8,
      name: { zh: '生成音效', en: 'Generate Sound Effects' },
      default: true
    },
    {
      id: 'ppioViduQ3OffPeak',
      type: 'switch',
      order: 9,
      name: { zh: '错峰模式', en: 'Off-Peak Mode' },
      default: false,
      apiField: 'off_peak'
    }
  ],
  linkages: [
    {
      trigger: ['uploadedImages', 'ppioViduQ3Mode'],
      effect: 'autoSwitch',
      target: 'ppioViduQ3Mode',
      condition: (_, allParams) => {
        const images = Array.isArray(allParams.uploadedImages) ? allParams.uploadedImages : []
        const mode = typeof allParams.ppioViduQ3Mode === 'string'
          ? allParams.ppioViduQ3Mode
          : 'text-image-to-video'
        return images.length === 2 && mode !== 'start-end-frame'
      },
      value: 'start-end-frame'
    },
    {
      trigger: ['uploadedImages', 'ppioViduQ3Mode'],
      effect: 'autoSwitch',
      target: 'ppioViduQ3Mode',
      condition: (_, allParams) => {
        const images = Array.isArray(allParams.uploadedImages) ? allParams.uploadedImages : []
        return images.length <= 1 && allParams.ppioViduQ3Mode === 'start-end-frame'
      },
      value: 'text-image-to-video'
    },
    {
      trigger: ['ppioViduQ3Mode', 'ppioViduQ3ProMode', 'uploadedImages'],
      effect: 'hide',
      targets: ['ppioViduQ3AspectRatio'],
      condition: (_, allParams) => {
        const mode = allParams.ppioViduQ3Mode
        const isProMode = allParams.ppioViduQ3ProMode === true
        const images = Array.isArray(allParams.uploadedImages) ? allParams.uploadedImages : []
        if (mode === 'start-end-frame') {
          return true
        }
        if (images.length > 0 && !isProMode) {
          return true
        }
        return false
      }
    },
    {
      trigger: ['ppioViduQ3Mode', 'ppioViduQ3ProMode', 'uploadedImages'],
      effect: 'hide',
      targets: ['ppioViduQ3Style'],
      condition: (_, allParams) => {
        const mode = allParams.ppioViduQ3Mode
        const isProMode = allParams.ppioViduQ3ProMode === true
        const images = Array.isArray(allParams.uploadedImages) ? allParams.uploadedImages : []
        return !(mode === 'text-image-to-video' && isProMode && images.length > 0)
      }
    },
  ],
  endpoints: {
    selector: (params) => {
      const isProMode = params.ppioViduQ3ProMode === true
      const mode = typeof params.ppioViduQ3Mode === 'string' ? params.ppioViduQ3Mode : 'text-image-to-video'
      const preferredImages = Array.isArray(params.uploadedFilePaths)
        ? params.uploadedFilePaths.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : []
      const legacyImages = Array.isArray(params.images)
        ? params.images.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : []
      const images = preferredImages.length > 0 ? preferredImages : legacyImages

      if (mode === 'start-end-frame' || images.length >= 2) {
        return isProMode ? '/async/vidu-q3-pro-f2v' : '/async/vidu-q3-turbo-f2v'
      }
      if (images.length >= 1) {
        return isProMode ? '/async/vidu-q3-pro-i2v' : '/async/vidu-q3-turbo-i2v'
      }
      return isProMode ? '/async/vidu-q3-pro-t2v' : '/async/vidu-q3-turbo-t2v'
    }
  },
  request: {
    builder: (params) => {
      const supportedRatios = ['16:9', '9:16', '4:3', '3:4', '1:1'] as const
      type SupportedRatio = (typeof supportedRatios)[number]

      const preferredImages = Array.isArray(params.uploadedFilePaths)
        ? params.uploadedFilePaths.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : []
      const legacyImages = Array.isArray(params.images)
        ? params.images.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : []
      const images = preferredImages.length > 0 ? preferredImages : legacyImages

      const prompt = typeof params.prompt === 'string' ? params.prompt : ''
      const isProMode = params.ppioViduQ3ProMode === true
      const mode = typeof params.ppioViduQ3Mode === 'string' ? params.ppioViduQ3Mode : 'text-image-to-video'

      const rawDuration = params.ppioViduQ3Duration ?? params.duration
      const parsedDuration = typeof rawDuration === 'number' ? rawDuration : Number(rawDuration)
      const duration = Number.isFinite(parsedDuration)
        ? Math.min(16, Math.max(1, Math.round(parsedDuration)))
        : 5

      const rawResolution = params.ppioViduQ3Resolution ?? params.resolution
      const resolution = rawResolution === '540p' || rawResolution === '1080p' ? rawResolution : '720p'

      const legacyAudioType = params.ppioViduQ3AudioType ?? params.audio_type
      const legacyAudio = params.ppioViduQ3Audio ?? params.audio
      const rawGenerateSpeech = params.ppioViduQ3GenerateSpeech
      const rawGenerateSoundEffect = params.ppioViduQ3GenerateSoundEffect
      const generateSpeech = typeof rawGenerateSpeech === 'boolean'
        ? rawGenerateSpeech
        : (legacyAudioType === 'speech_only' ? true : (legacyAudioType === 'sound_effect_only' ? false : legacyAudio !== false))
      const generateSoundEffect = typeof rawGenerateSoundEffect === 'boolean'
        ? rawGenerateSoundEffect
        : (legacyAudioType === 'speech_only' ? false : (legacyAudioType === 'sound_effect_only' ? true : legacyAudio !== false))
      const audio = generateSpeech || generateSoundEffect

      const rawOffPeak = params.ppioViduQ3OffPeak ?? params.off_peak
      const offPeak = rawOffPeak === true

      const ratioHint = typeof params.__firstImageRatio === 'number' && Number.isFinite(params.__firstImageRatio) && params.__firstImageRatio > 0
        ? params.__firstImageRatio
        : 1
      const ratioMap: Record<SupportedRatio, number> = {
        '16:9': 16 / 9,
        '9:16': 9 / 16,
        '4:3': 4 / 3,
        '3:4': 3 / 4,
        '1:1': 1
      }
      const pickClosestRatio = (target: number): SupportedRatio => {
        let best: SupportedRatio = '1:1'
        let bestDiff = Number.POSITIVE_INFINITY
        for (const ratio of supportedRatios) {
          const diff = Math.abs(ratioMap[ratio] - target)
          if (diff < bestDiff) {
            best = ratio
            bestDiff = diff
          }
        }
        return best
      }

      const rawAspectRatio = params.ppioViduQ3AspectRatio ?? params.aspect_ratio
      const resolvedAspectRatio = rawAspectRatio === 'smart' || rawAspectRatio === 'auto' || rawAspectRatio === undefined
        ? pickClosestRatio(ratioHint)
        : (supportedRatios.includes(rawAspectRatio as SupportedRatio) ? rawAspectRatio as SupportedRatio : '16:9')

      const requestData: DynamicValueMap = {
        prompt,
        duration,
        resolution,
        audio,
        off_peak: offPeak
      }

      if (mode === 'start-end-frame' || images.length >= 2) {
        if (images.length > 0) {
          requestData.images = images.slice(0, 2)
        }
        return requestData
      }

      if (images.length >= 1) {
        requestData.images = [images[0]]
        if (isProMode) {
          requestData.aspect_ratio = resolvedAspectRatio
          const rawStyle = params.ppioViduQ3Style ?? params.style
          requestData.style = rawStyle === 'anime' ? 'anime' : 'general'
        } else if (audio) {
          if (generateSpeech && generateSoundEffect) {
            requestData.audio_type = 'all'
          } else if (generateSpeech) {
            requestData.audio_type = 'speech_only'
          } else {
            requestData.audio_type = 'sound_effect_only'
          }
        }
        return requestData
      }

      requestData.aspect_ratio = resolvedAspectRatio
      return requestData
    }
  },
  pricing: {
    currency: '¥',
    calculator: (params) => {
      type SupportedResolution = '540p' | '720p' | '1080p'
      const isProMode = params.ppioViduQ3ProMode === true
      const offPeak = (params.ppioViduQ3OffPeak ?? params.off_peak) === true
      const rawResolution = params.ppioViduQ3Resolution ?? params.resolution
      const resolution: SupportedResolution = rawResolution === '540p' || rawResolution === '1080p'
        ? rawResolution
        : '720p'

      const rawDuration = params.ppioViduQ3Duration ?? params.duration
      const parsedDuration = typeof rawDuration === 'number' ? rawDuration : Number(rawDuration)
      const duration = Number.isFinite(parsedDuration)
        ? Math.min(16, Math.max(1, Math.round(parsedDuration)))
        : 5

      const turboPriceByResolution: Record<SupportedResolution, number> = offPeak
        ? { '540p': 0.125, '720p': 0.1875, '1080p': 0.25 }
        : { '540p': 0.25, '720p': 0.375, '1080p': 0.5 }
      const proPriceByResolution: Record<SupportedResolution, number> = offPeak
        ? { '540p': 0.2188, '720p': 0.4688, '1080p': 0.5 }
        : { '540p': 0.4375, '720p': 0.9375, '1080p': 1 }

      const priceByResolution = isProMode ? proPriceByResolution : turboPriceByResolution
      const pricePerSecond = priceByResolution[resolution] ?? priceByResolution['720p']
      return pricePerSecond * duration
    },
    description: 'Turbo/Pro 均按时长计费；支持错峰（off_peak）低价与 540p/720p/1080p 分辨率分档。'
  }
})

export default viduQ3Model
