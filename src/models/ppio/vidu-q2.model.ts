import { defineModel } from '@/core'
import { viduQ2Params } from './vidu-q2.constants'
import { viduQ2Linkages } from './vidu-q2.linkages'

export const viduQ2Model = defineModel({
  meta: {
    id: 'ppio-vidu-q2',
    provider: 'ppio',
    type: 'video',
    i18nScope: 'models.defs.ppio-vidu-q2',
    name: { key: 'meta.name', fallback: 'Vidu Q2' },
    description: {
      key: 'meta.description',
      fallback: 'PPIO Vidu Q2 unified family model with edition and mode dimensions'
    },
    tags: [
      'text-to-video',
      'image-to-video',
      'reference-mode',
      'start-end-frame',
      'supports-multi-image',
      'multi-mode-switch',
      'provider-ppio'
    ],
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
        when: '!ppioViduQ2ProMode && !ppioViduQ2FastMode && ppioViduQ2Mode === "text-image-to-video"',
        images: { max: 1 }
      },
      {
        when: '!ppioViduQ2ProMode && !ppioViduQ2FastMode && ppioViduQ2Mode === "reference-to-video"',
        images: { min: 1, max: 10 }
      },
      {
        when: '(ppioViduQ2ProMode || ppioViduQ2FastMode) && ppioViduQ2Mode === "text-image-to-video"',
        images: { exact: 1 }
      },
      {
        when: 'ppioViduQ2Mode === "start-end-frame"',
        images: { exact: 2 }
      },
      {
        when: 'ppioViduQ2Mode === "smart-multiframe" && (ppioViduQ2ProMode || ppioViduQ2FastMode)',
        images: { min: 3, max: 10 }
      }
    ]
  },
  requirements: [
    {
      id: 'vidu-q2-reference-images',
      when: '!ppioViduQ2ProMode && !ppioViduQ2FastMode && ppioViduQ2Mode === "reference-to-video"',
      require: { images: { min: 1 } },
      message: {
        title: '参考图必需',
        message: '参考生视频模式至少需要上传 1 张图片',
        type: 'warning'
      }
    },
    {
      id: 'vidu-q2-image-to-video-images',
      when: '(ppioViduQ2ProMode || ppioViduQ2FastMode) && ppioViduQ2Mode === "text-image-to-video"',
      require: { images: { exact: 1 } },
      message: {
        title: '图片数量不符合要求',
        message: '图生视频模式需要上传 1 张图片',
        type: 'warning'
      }
    },
    {
      id: 'vidu-q2-start-end-images',
      when: 'ppioViduQ2Mode === "start-end-frame"',
      require: { images: { exact: 2 } },
      message: {
        title: '图片数量不符合要求',
        message: '首尾帧模式需要上传 2 张图片',
        type: 'warning'
      }
    },
    {
      id: 'vidu-q2-smart-multiframe-images',
      when: 'ppioViduQ2Mode === "smart-multiframe" && (ppioViduQ2ProMode || ppioViduQ2FastMode)',
      require: { images: { min: 3, max: 10 } },
      message: {
        title: '图片数量不符合要求',
        message: '智能多帧模式需要上传 3-10 张图片',
        type: 'warning'
      }
    }
  ],
  params: viduQ2Params,
  linkages: viduQ2Linkages,
  endpoints: {
    selector: (params) => {
      const editionValues = ['q2', 'pro', 'pro-fast', 'turbo'] as const
      const modeValues = ['text-image-to-video', 'reference-to-video', 'start-end-frame', 'smart-multiframe'] as const
      type LocalEdition = (typeof editionValues)[number]
      type LocalMode = (typeof modeValues)[number]
      const isEdition = (value: DynamicValue): value is LocalEdition => {
        return typeof value === 'string' && editionValues.includes(value as LocalEdition)
      }
      const support: Record<LocalEdition, LocalMode[]> = {
        q2: ['text-image-to-video', 'reference-to-video'],
        pro: ['text-image-to-video', 'start-end-frame', 'smart-multiframe'],
        'pro-fast': ['text-image-to-video', 'start-end-frame'],
        turbo: ['text-image-to-video', 'start-end-frame', 'smart-multiframe']
      }
      const fallback: Record<LocalEdition, LocalMode> = {
        q2: 'text-image-to-video',
        pro: 'text-image-to-video',
        'pro-fast': 'text-image-to-video',
        turbo: 'text-image-to-video'
      }
      const routeMap: Record<LocalEdition, Partial<Record<LocalMode, string>>> = {
        q2: {
          'text-image-to-video': '/async/vidu-q2-text2video',
          'reference-to-video': '/async/vidu-q2-reference2video'
        },
        pro: {
          'text-image-to-video': '/async/vidu-q2-pro-img2video',
          'start-end-frame': '/async/vidu-q2-pro-startend2video',
          'smart-multiframe': '/async/vidu-q2-pro-multiframe'
        },
        'pro-fast': {
          'text-image-to-video': '/async/vidu-q2-pro-fast-img2video',
          'start-end-frame': '/async/vidu-q2-pro-fast-startend2video'
        },
        turbo: {
          'text-image-to-video': '/async/vidu-q2-turbo-img2video',
          'start-end-frame': '/async/vidu-q2-turbo-startend2video',
          'smart-multiframe': '/async/vidu-q2-turbo-multiframe'
        }
      }
      const filterMedia = (items: DynamicValue): string[] => {
        if (!Array.isArray(items)) {
          return []
        }
        return items.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      }
      const resolveEdition = (rawParams: DynamicValueMap): LocalEdition => {
        const proMode = rawParams.ppioViduQ2ProMode === true
        const fastMode = rawParams.ppioViduQ2FastMode === true
        if (proMode && fastMode) {
          return 'pro-fast'
        }
        if (proMode) {
          return 'pro'
        }
        if (fastMode) {
          return 'turbo'
        }
        const preferred = rawParams.ppioViduQ2Edition
        if (isEdition(preferred)) {
          return preferred
        }
        const legacy = rawParams.edition
        if (isEdition(legacy)) {
          return legacy
        }
        return 'q2'
      }
      const resolvedEdition = resolveEdition(params)
      const edition: LocalEdition = isEdition(resolvedEdition) ? resolvedEdition : 'q2'
      const rawMode = typeof params.ppioViduQ2Mode === 'string'
        ? params.ppioViduQ2Mode
        : (typeof params.mode === 'string' ? params.mode : fallback[edition])
      const mode: LocalMode = modeValues.includes(rawMode as LocalMode) && support[edition].includes(rawMode as LocalMode)
        ? (rawMode as LocalMode)
        : fallback[edition]

      if (edition === 'q2' && mode === 'text-image-to-video') {
        const preferredImages = filterMedia(params.uploadedFilePaths)
        const legacyImages = filterMedia(params.images)
        const uploadedImages = preferredImages.length > 0 ? preferredImages : legacyImages
        return uploadedImages.length > 0 ? '/async/vidu-q2-turbo-img2video' : '/async/vidu-q2-text2video'
      }

      const route = routeMap[edition][mode]
      if (!route) {
        throw new Error('Unsupported Vidu Q2 edition/mode combination')
      }
      return route
    }
  },
  request: {
    builder: (params) => {
      const editionValues = ['q2', 'pro', 'pro-fast', 'turbo'] as const
      const modeValues = ['text-image-to-video', 'reference-to-video', 'start-end-frame', 'smart-multiframe'] as const
      type LocalEdition = (typeof editionValues)[number]
      type LocalMode = (typeof modeValues)[number]
      const isEdition = (value: DynamicValue): value is LocalEdition => {
        return typeof value === 'string' && editionValues.includes(value as LocalEdition)
      }
      const support: Record<LocalEdition, LocalMode[]> = {
        q2: ['text-image-to-video', 'reference-to-video'],
        pro: ['text-image-to-video', 'start-end-frame', 'smart-multiframe'],
        'pro-fast': ['text-image-to-video', 'start-end-frame'],
        turbo: ['text-image-to-video', 'start-end-frame', 'smart-multiframe']
      }
      const fallback: Record<LocalEdition, LocalMode> = {
        q2: 'text-image-to-video',
        pro: 'text-image-to-video',
        'pro-fast': 'text-image-to-video',
        turbo: 'text-image-to-video'
      }
      const filterMedia = (items: DynamicValue): string[] => {
        if (!Array.isArray(items)) {
          return []
        }
        return items.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      }
      const resolveBoolean = (preferred: DynamicValue, legacy: DynamicValue, fallbackValue: boolean): boolean => {
        if (typeof preferred === 'boolean') return preferred
        if (typeof legacy === 'boolean') return legacy
        return fallbackValue
      }
      const resolveNumber = (preferred: DynamicValue, legacy: DynamicValue, fallbackValue: number): number => {
        const source = preferred !== undefined ? preferred : legacy
        const parsed = typeof source === 'number' ? source : Number(source)
        return Number.isFinite(parsed) ? parsed : fallbackValue
      }
      const clampInteger = (value: DynamicValue, min: number, max: number, fallbackValue: number): number => {
        const resolved = resolveNumber(value, undefined, fallbackValue)
        const rounded = Math.round(resolved)
        if (rounded < min) return min
        if (rounded > max) return max
        return rounded
      }

      const resolveEdition = (rawParams: DynamicValueMap): LocalEdition => {
        const proMode = rawParams.ppioViduQ2ProMode === true
        const fastMode = rawParams.ppioViduQ2FastMode === true
        if (proMode && fastMode) {
          return 'pro-fast'
        }
        if (proMode) {
          return 'pro'
        }
        if (fastMode) {
          return 'turbo'
        }
        const preferred = rawParams.ppioViduQ2Edition
        if (isEdition(preferred)) {
          return preferred
        }
        const legacy = rawParams.edition
        if (isEdition(legacy)) {
          return legacy
        }
        return 'q2'
      }
      const resolvedEdition = resolveEdition(params)
      const edition: LocalEdition = isEdition(resolvedEdition) ? resolvedEdition : 'q2'
      const rawMode = typeof params.ppioViduQ2Mode === 'string'
        ? params.ppioViduQ2Mode
        : (typeof params.mode === 'string' ? params.mode : fallback[edition])
      const mode: LocalMode = modeValues.includes(rawMode as LocalMode) && support[edition].includes(rawMode as LocalMode)
        ? (rawMode as LocalMode)
        : fallback[edition]

      const preferredImages = filterMedia(params.uploadedFilePaths)
      const legacyImages = filterMedia(params.images)
      const uploadedImages = preferredImages.length > 0 ? preferredImages : legacyImages

      const prompt = typeof params.prompt === 'string' ? params.prompt : ''
      const durationLimit = mode === 'start-end-frame' ? 8 : 10
      const duration = clampInteger(params.ppioViduQ2Duration, params.duration, durationLimit, 5)
      const segmentDuration = clampInteger(
        params.ppioViduQ2MultiframeSegmentDuration,
        params.multiframeSegmentDuration,
        7,
        2
      )

      const resolutionRaw = typeof params.ppioViduQ2Resolution === 'string'
        ? params.ppioViduQ2Resolution
        : (typeof params.resolution === 'string' ? params.resolution : '720p')
      const resolutionSupport = edition === 'pro-fast' ? ['720p', '1080p'] : ['540p', '720p', '1080p']
      const resolution = resolutionSupport.includes(resolutionRaw) ? resolutionRaw : '720p'

      const aspectRatioRaw = typeof params.ppioViduQ2AspectRatio === 'string'
        ? params.ppioViduQ2AspectRatio
        : (typeof params.aspect_ratio === 'string' ? params.aspect_ratio : '16:9')
      const aspectRatio = ['16:9', '9:16', '1:1'].includes(aspectRatioRaw) ? aspectRatioRaw : '16:9'

      const styleRaw = typeof params.ppioViduQ2Style === 'string'
        ? params.ppioViduQ2Style
        : (typeof params.style === 'string' ? params.style : 'general')
      const style = ['general', 'cinematic', 'realistic', 'anime'].includes(styleRaw) ? styleRaw : 'general'

      const movementRaw = typeof params.ppioViduQ2MovementAmplitude === 'string'
        ? params.ppioViduQ2MovementAmplitude
        : (typeof params.movement_amplitude === 'string' ? params.movement_amplitude : 'auto')
      const movementAmplitude = ['auto', 'small', 'medium', 'high'].includes(movementRaw)
        ? movementRaw
        : 'auto'

      const audio = resolveBoolean(params.ppioViduQ2Audio, params.audio, false)
      const bgm = resolveBoolean(params.ppioViduQ2Bgm, params.bgm, false)

      const buildQ2ReferencePayload = (images: string[]) => {
        const markerRegex = /(^|\s)@1(\s|$)/
        const normalizedPrompt = markerRegex.test(prompt)
          ? prompt
          : (prompt.trim().length > 0 ? `@1 ${prompt}` : '@1')

        return {
          prompt: normalizedPrompt,
          duration,
          resolution,
          aspect_ratio: aspectRatio,
          movement_amplitude: movementAmplitude,
          audio,
          bgm,
          subjects: [
            {
              id: '1',
              images
            }
          ]
        }
      }

      if (edition === 'q2' && mode === 'text-image-to-video') {
        const hasImage = uploadedImages.length > 0
        if (!hasImage) {
          return {
            prompt,
            duration,
            resolution,
            aspect_ratio: aspectRatio,
            style,
            movement_amplitude: movementAmplitude,
            audio,
            bgm
          }
        }
        return {
          prompt,
          duration,
          resolution,
          movement_amplitude: movementAmplitude,
          audio,
          bgm,
          images: [uploadedImages[0]]
        }
      }

      if (edition === 'q2' && mode === 'reference-to-video') {
        return buildQ2ReferencePayload(uploadedImages)
      }

      if (mode === 'text-image-to-video') {
        const requestData = {
          prompt,
          duration,
          resolution,
          movement_amplitude: movementAmplitude,
          audio,
          bgm
        }
        if (uploadedImages.length > 0) {
          return {
            ...requestData,
            images: [uploadedImages[0]]
          }
        }
        return requestData
      }

      if (mode === 'start-end-frame') {
        const requestData = {
          prompt,
          duration,
          resolution,
          movement_amplitude: movementAmplitude,
          bgm
        }
        if (uploadedImages.length > 0) {
          return {
            ...requestData,
            images: uploadedImages.slice(0, 2)
          }
        }
        return requestData
      }

      const startImage = uploadedImages[0]
      const restImages = uploadedImages.slice(1, 10)
      const imageSettings = restImages.map((image) => {
        const item = {
          key_image: image,
          duration: segmentDuration
        }
        if (prompt.trim().length > 0) {
          return { ...item, prompt }
        }
        return item
      })

      const requestData = {
        resolution
      }

      if (typeof startImage === 'string' && startImage.length > 0) {
        if (imageSettings.length > 0) {
          return {
            ...requestData,
            start_image: startImage,
            image_settings: imageSettings
          }
        }
        return {
          ...requestData,
          start_image: startImage
        }
      }

      return imageSettings.length > 0
        ? { ...requestData, image_settings: imageSettings }
        : requestData
    }
  },
  pricing: {
    currency: '¥',
    calculator: (params) => {
      const editionValues = ['q2', 'pro', 'pro-fast', 'turbo'] as const
      const modeValues = ['text-image-to-video', 'reference-to-video', 'start-end-frame', 'smart-multiframe'] as const
      type LocalEdition = (typeof editionValues)[number]
      type LocalMode = (typeof modeValues)[number]
      const isEdition = (value: DynamicValue): value is LocalEdition => {
        return typeof value === 'string' && editionValues.includes(value as LocalEdition)
      }
      const support: Record<LocalEdition, LocalMode[]> = {
        q2: ['text-image-to-video', 'reference-to-video'],
        pro: ['text-image-to-video', 'start-end-frame', 'smart-multiframe'],
        'pro-fast': ['text-image-to-video', 'start-end-frame'],
        turbo: ['text-image-to-video', 'start-end-frame', 'smart-multiframe']
      }
      const fallback: Record<LocalEdition, LocalMode> = {
        q2: 'text-image-to-video',
        pro: 'text-image-to-video',
        'pro-fast': 'text-image-to-video',
        turbo: 'text-image-to-video'
      }
      const resolveEdition = (rawParams: DynamicValueMap): LocalEdition => {
        const proMode = rawParams.ppioViduQ2ProMode === true
        const fastMode = rawParams.ppioViduQ2FastMode === true
        if (proMode && fastMode) return 'pro-fast'
        if (proMode) return 'pro'
        if (fastMode) return 'turbo'
        const preferred = rawParams.ppioViduQ2Edition
        if (isEdition(preferred)) return preferred
        const legacy = rawParams.edition
        if (isEdition(legacy)) return legacy
        return 'q2'
      }
      const resolveMode = (rawParams: DynamicValueMap, edition: LocalEdition): LocalMode => {
        const preferred = rawParams.ppioViduQ2Mode
        const legacy = rawParams.mode
        const rawMode = typeof preferred === 'string' ? preferred : (typeof legacy === 'string' ? legacy : fallback[edition])
        if (modeValues.includes(rawMode as LocalMode) && support[edition].includes(rawMode as LocalMode)) {
          return rawMode as LocalMode
        }
        return fallback[edition]
      }
      const edition = resolveEdition(params)
      const mode = resolveMode(params, edition)
      const resolutionRaw = typeof params.ppioViduQ2Resolution === 'string'
        ? params.ppioViduQ2Resolution
        : (typeof params.resolution === 'string' ? params.resolution : '720p')
      const resolutionSupport = edition === 'pro-fast' ? ['720p', '1080p'] : ['540p', '720p', '1080p']
      const resolution = resolutionSupport.includes(resolutionRaw) ? resolutionRaw : '720p'
      const preferredImages = Array.isArray(params.uploadedFilePaths)
        ? params.uploadedFilePaths.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : []
      const legacyImages = Array.isArray(params.images)
        ? params.images.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : []
      const imageCount = (preferredImages.length > 0 ? preferredImages : legacyImages).length

      const base5sPriceTable: Record<string, Record<string, Record<string, number>>> = {
        q2: {
          'text-image-to-video': {
            '540p': 0.5625,
            '720p': 1.0936,
            '1080p': 1.875
          },
          'reference-to-video': {
            '540p': 1.0936,
            '720p': 1.406,
            '1080p': 3.5938
          }
        },
        pro: {
          'image-to-video': {
            '540p': 1.0311,
            '720p': 1.7188,
            '1080p': 3.594
          }
        },
        'pro-fast': {
          'image-to-video': {
            '720p': 0.5,
            '1080p': 1
          }
        },
        turbo: {
          'image-to-video': {
            '540p': 0.4375,
            '720p': 1.5,
            '1080p': 2.3438
          }
        }
      }

      const effectiveEdition = mode === 'text-image-to-video' && edition === 'q2' && imageCount > 0
        ? 'turbo'
        : edition
      let priceMode: string
      if (mode === 'smart-multiframe' || mode === 'start-end-frame') {
        priceMode = 'image-to-video'
      } else if (mode === 'text-image-to-video' && effectiveEdition !== 'q2') {
        priceMode = 'image-to-video'
      } else {
        priceMode = mode
      }
      const modePrices = base5sPriceTable[effectiveEdition]?.[priceMode]
      if (!modePrices) {
        return 0
      }
      const base5s = modePrices[resolution] ?? modePrices['720p']
      if (typeof base5s !== 'number') {
        return 0
      }

      if (mode === 'smart-multiframe') {
        const rawSegment = params.ppioViduQ2MultiframeSegmentDuration ?? params.multiframeSegmentDuration
        const segmentDuration = Number.isFinite(Number(rawSegment)) ? Number(rawSegment) : 5
        const normalizedSegment = Math.min(7, Math.max(2, Math.round(segmentDuration)))
        const totalDuration = normalizedSegment * Math.max(0, imageCount - 1)
        return base5s * totalDuration / 5
      }

      const rawDuration = params.ppioViduQ2Duration ?? params.duration
      const durationValue = Number.isFinite(Number(rawDuration)) ? Number(rawDuration) : 5
      const durationLimit = mode === 'start-end-frame' ? 8 : 10
      const duration = Math.min(durationLimit, Math.max(1, Math.round(durationValue)))
      return base5s * duration / 5
    },
    description: '按版本/模式/分辨率计费，普通模式按总时长计费，多帧模式按段落时长×关键帧段数累计计费'
  }
})

export default viduQ2Model
