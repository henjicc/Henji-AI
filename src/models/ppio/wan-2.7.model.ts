import { defineModel, sharedFieldText, sharedModeText, sharedOptionText } from '@/core'

const WAN27_SIZE_MAP = {
  '16:9': { '720P': '1280*720', '1080P': '1920*1080' },
  '9:16': { '720P': '720*1280', '1080P': '1080*1920' },
  '1:1': { '720P': '960*960', '1080P': '1440*1440' },
  '4:3': { '720P': '1088*832', '1080P': '1632*1248' },
  '3:4': { '720P': '832*1088', '1080P': '1248*1632' }
} as const

const WAN27_EDIT_RATIO_MAP = {
  '16:9': { '720P': '1280*720', '1080P': '1920*1080' },
  '9:16': { '720P': '720*1280', '1080P': '1080*1920' },
  '1:1': { '720P': '960*960', '1080P': '1440*1440' },
  '4:3': { '720P': '1104*832', '1080P': '1648*1248' },
  '3:4': { '720P': '832*1104', '1080P': '1248*1648' }
} as const

export const wan27Model = defineModel({
  meta: {
    id: 'ppio-wan-2.7',
    seriesId: 'wan',
    seriesRank: 2.7,
    provider: 'ppio',
    type: 'video',
    i18nScope: 'models.defs.ppio-wan-2.7',
    name: { key: 'meta.name', fallback: 'Wan 2.7' },
    description: {
      key: 'meta.description',
      fallback: 'PPIO Wan 2.7 video generation model, supports unified text/image-to-video, reference-to-video, and video-edit modes'
    },
    tags: [
      'text-to-video',
      'image-to-video',
      'start-end-frame',
      'reference-mode',
      'video-to-video',
      'video-extension',
      'supports-video-editing',
      'supports-audio-generation',
      'supports-audio-drive',
      'supports-prompt-expansion',
      'multi-mode-switch',
      'mixed-upload-mode',
      'provider-ppio'
    ],
    polling: {
      interval: 3000,
      maxAttempts: 120,
      expectedAttempts: 50
    }
  },
  inputLimits: {
    images: { max: 2 },
    videos: { max: 1 },
    audios: { max: 1 },
    rules: [
      {
        when: 'ppioWan27Mode === "text-image-to-video"',
        images: { max: 2 },
        videos: { max: 1 },
        audios: { max: 1 }
      },
      {
        when: 'ppioWan27Mode === "reference-to-video"',
        images: { max: 5 },
        videos: { max: 3 },
        audios: { max: 0 }
      },
      {
        when: 'ppioWan27Mode === "video-edit"',
        images: { max: 3 },
        videos: { exact: 1 },
        audios: { max: 0 }
      }
    ]
  },
  requirements: [
    {
      id: 'wan-27-video-edit-video-required',
      when: 'ppioWan27Mode === "video-edit"',
      require: { videos: { exact: 1 } },
      message: {
        title: '视频必需',
        message: '视频编辑模式需要上传 1 个待编辑视频',
        type: 'warning'
      }
    }
  ],
  params: [
    {
      id: 'ppioWan27Mode',
      type: 'dropdown',
      order: 1,
      valueType: 'string',
      name: sharedFieldText('mode'),
      default: 'text-image-to-video',
      options: [
        { value: 'text-image-to-video', label: sharedModeText('textImageToVideo') },
        { value: 'reference-to-video', label: sharedModeText('referenceToVideo') },
        { value: 'video-edit', label: sharedModeText('videoEdit') }
      ],
      apiField: 'mode'
    },
    {
      id: 'ppioWan27AspectRatio',
      type: 'dropdown',
      order: 2,
      valueType: 'string',
      name: sharedFieldText('aspectRatio'),
      default: '16:9',
      visible: {
        condition: 'ppioWan27Mode === "text-image-to-video" && uploadedImages.length === 0 && uploadedVideos.length === 0',
        reason: '仅无素材的文生视频通过 size 设置比例'
      },
      options: Object.keys(WAN27_SIZE_MAP).map((value) => ({ value, label: value })),
      apiField: 'size'
    },
    {
      id: 'ppioWan27EditRatio',
      type: 'dropdown',
      order: 3,
      valueType: 'string',
      name: sharedFieldText('aspectRatio'),
      default: 'auto',
      visible: {
        condition: 'ppioWan27Mode === "video-edit"',
        reason: '视频编辑模式可选择输出比例，自动时沿用输入视频比例'
      },
      options: [
        { value: 'auto', label: sharedOptionText('smart') },
        ...Object.keys(WAN27_EDIT_RATIO_MAP).map((value) => ({ value, label: value }))
      ],
      apiField: 'ratio'
    },
    {
      id: 'ppioWan27Resolution',
      type: 'dropdown',
      order: 4,
      valueType: 'string',
      name: sharedFieldText('resolution'),
      default: '1080P',
      options: [
        { value: '720P', label: '720P' },
        { value: '1080P', label: '1080P' }
      ],
      apiField: 'resolution'
    },
    {
      id: 'ppioWan27Duration',
      type: 'number',
      order: 5,
      valueType: 'number',
      name: sharedFieldText('duration'),
      default: 5,
      min: 2,
      max: 15,
      step: 1,
      apiField: 'duration'
    },
    {
      id: 'ppioWan27ShotType',
      type: 'dropdown',
      order: 6,
      valueType: 'string',
      name: sharedFieldText('shotType'),
      default: 'single',
      visible: {
        condition: 'ppioWan27Mode === "reference-to-video"',
        reason: '仅参考生视频支持镜头类型'
      },
      options: [
        { value: 'single', label: sharedOptionText('singleShot') },
        { value: 'multi', label: sharedOptionText('multiShot') }
      ],
      apiField: 'shot_type'
    },
    {
      id: 'ppioWan27Audio',
      type: 'switch',
      order: 7,
      valueType: 'boolean',
      name: sharedFieldText('generateAudio'),
      default: true,
      visible: {
        condition: 'ppioWan27Mode === "reference-to-video"',
        reason: '仅参考生视频支持关闭音频'
      },
      apiField: 'audio'
    },
    {
      id: 'ppioWan27AudioSetting',
      type: 'dropdown',
      order: 8,
      valueType: 'string',
      name: { zh: '声音设置', en: 'Audio Setting' },
      default: 'auto',
      visible: {
        condition: 'ppioWan27Mode === "video-edit"',
        reason: '仅视频编辑支持声音设置'
      },
      options: [
        { value: 'auto', label: sharedOptionText('auto') },
        { value: 'origin', label: { zh: '保留原声', en: 'Keep Original' } }
      ],
      apiField: 'audio_setting'
    },
    {
      id: 'ppioWan27PromptExtend',
      type: 'switch',
      order: 9,
      valueType: 'boolean',
      name: sharedFieldText('promptExtension'),
      default: true,
      visible: {
        condition: 'ppioWan27Mode === "text-image-to-video"',
        reason: '仅文/图生视频支持提示词改写'
      },
      apiField: 'prompt_extend'
    }
  ],
  linkages: [],
  endpoints: {
    default: '/async/wan2.7-t2v',
    selector: (params) => {
      const mode = typeof params.ppioWan27Mode === 'string'
        ? params.ppioWan27Mode
        : (typeof params.mode === 'string' ? params.mode : 'text-image-to-video')
      const images = Array.isArray(params.uploadedFilePaths)
        ? params.uploadedFilePaths.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : Array.isArray(params.images)
          ? params.images.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
          : []
      const videos = Array.isArray(params.uploadedVideoFilePaths)
        ? params.uploadedVideoFilePaths.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : Array.isArray(params.videos)
          ? params.videos.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
          : []
      if (mode === 'video-edit') {
        return '/async/wan2.7-videoedit'
      }
      if (mode === 'reference-to-video') {
        return '/async/wan2.7-r2v'
      }
      if (mode === 'text-image-to-video' && (images.length > 0 || videos.length > 0)) {
        return '/async/wan2.7-i2v'
      }
      return '/async/wan2.7-t2v'
    }
  },
  request: {
    builder: (params) => {
      const filterSources = (value: DynamicValue): string[] => Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : []
      const pickSources = (primary: DynamicValue, fallback: DynamicValue): string[] => {
        const preferred = filterSources(primary)
        return preferred.length > 0 ? preferred : filterSources(fallback)
      }
      const images = pickSources(params.uploadedFilePaths, params.images)
      const videos = pickSources(params.uploadedVideoFilePaths, params.videos)
      const audios = pickSources(params.uploadedAudioFilePaths, params.audios)
      const mode = typeof params.ppioWan27Mode === 'string'
        ? params.ppioWan27Mode
        : (typeof params.mode === 'string' ? params.mode : 'text-image-to-video')
      const resolution = params.ppioWan27Resolution === '720P' ? '720P' : '1080P'
      const aspectRatioCandidates = ['16:9', '9:16', '1:1', '4:3', '3:4']
      const rawAspectRatio = typeof params.ppioWan27AspectRatio === 'string'
        ? params.ppioWan27AspectRatio
        : (typeof params.aspect_ratio === 'string' ? params.aspect_ratio : '16:9')
      const aspectRatio = aspectRatioCandidates.includes(rawAspectRatio) ? rawAspectRatio : '16:9'
      const sizeMap = {
        '16:9': { '720P': '1280*720', '1080P': '1920*1080' },
        '9:16': { '720P': '720*1280', '1080P': '1080*1920' },
        '1:1': { '720P': '960*960', '1080P': '1440*1440' },
        '4:3': { '720P': '1088*832', '1080P': '1632*1248' },
        '3:4': { '720P': '832*1088', '1080P': '1248*1632' }
      }
      const clampDuration = (value: DynamicValue, min: number, max: number, fallback: number): number => {
        const parsed = Number(value)
        if (!Number.isFinite(parsed)) {
          return fallback
        }
        return Math.min(max, Math.max(min, Math.round(parsed)))
      }
      const readText = (value: DynamicValue, maxLength: number): string => {
        return typeof value === 'string' ? value.slice(0, maxLength) : ''
      }
      const prompt = readText(params.prompt, mode === 'text-image-to-video' || mode === 'video-edit' ? 5000 : 1500)
      const promptExtend = params.ppioWan27PromptExtend !== undefined
        ? params.ppioWan27PromptExtend === true
        : params.prompt_extend !== false
      const requestData: DynamicValueMap = { watermark: false }

      if (mode === 'video-edit') {
        const duration = clampDuration(params.ppioWan27Duration ?? params.duration, 0, 10, 0)
        requestData.prompt = prompt
        requestData.duration = duration
        requestData.video_url = videos[0] || ''
        requestData.resolution = resolution
        requestData.audio_setting = params.ppioWan27AudioSetting === 'origin' ? 'origin' : 'auto'
        requestData.prompt_extend = promptExtend
        const rawRatio = typeof params.ppioWan27EditRatio === 'string'
          ? params.ppioWan27EditRatio
          : (typeof params.ratio === 'string' ? params.ratio : 'auto')
        if (aspectRatioCandidates.includes(rawRatio)) {
          requestData.ratio = rawRatio
        }
        if (images[0]) {
          requestData.reference_image_url = images[0]
        }
        if (images[1]) {
          requestData.reference_image_url_2 = images[1]
        }
        if (images[2]) {
          requestData.reference_image_url_3 = images[2]
        }
        return requestData
      }

      if (mode === 'reference-to-video') {
        const duration = clampDuration(params.ppioWan27Duration ?? params.duration, 2, 10, 5)
        requestData.prompt = prompt
        requestData.size = sizeMap[aspectRatio as keyof typeof sizeMap][resolution]
        requestData.audio = params.ppioWan27Audio !== undefined ? params.ppioWan27Audio === true : params.audio !== false
        requestData.duration = duration
        requestData.shot_type = params.ppioWan27ShotType === 'multi' ? 'multi' : 'single'
        requestData.media = [
          ...images.slice(0, 5).map((url, index) => ({
            url,
            type: index === 0 && params.ppioWan27ReferenceFirstFrame === true ? 'first_frame' : 'reference_image'
          })),
          ...videos.slice(0, 3).map((url) => ({ url, type: 'reference_video' }))
        ].slice(0, 5)
        return requestData
      }

      if (mode === 'text-image-to-video') {
        const duration = clampDuration(params.ppioWan27Duration ?? params.duration, 2, 15, 5)
        requestData.prompt = prompt
        requestData.duration = duration
        requestData.prompt_extend = promptExtend
        if (videos[0]) {
          requestData.first_clip_url = videos[0]
          requestData.resolution = resolution
        } else if (images[0]) {
          requestData.image_url = images[0]
          requestData.resolution = resolution
        }
        if (images[1]) {
          requestData.last_frame_url = images[1]
        }
        if (audios[0]) {
          requestData[videos[0] || images[0] ? 'driving_audio_url' : 'audio_url'] = audios[0]
        }
        return requestData
      }

      const duration = clampDuration(params.ppioWan27Duration ?? params.duration, 2, 15, 5)
      requestData.prompt = prompt
      requestData.size = sizeMap[aspectRatio as keyof typeof sizeMap][resolution]
      requestData.duration = duration
      requestData.prompt_extend = promptExtend
      if (audios[0]) {
        requestData.audio_url = audios[0]
      }
      return requestData
    }
  },
  pricing: {
    currency: '¥',
    calculator: (params) => {
      const mode = typeof params.ppioWan27Mode === 'string' ? params.ppioWan27Mode : 'text-image-to-video'
      const resolution = params.ppioWan27Resolution === '720P' ? '720P' : '1080P'
      const rawDuration = Number(params.ppioWan27Duration ?? params.duration)
      const fallbackDuration = mode === 'video-edit' && (!Number.isFinite(rawDuration) || rawDuration <= 0) ? 5 : rawDuration
      const maxDuration = mode === 'reference-to-video' || mode === 'video-edit' ? 10 : 15
      const minDuration = mode === 'video-edit' ? 0 : 2
      const duration = Number.isFinite(fallbackDuration)
        ? Math.min(maxDuration, Math.max(minDuration, Math.round(fallbackDuration)))
        : 5
      const pricePerSecond = resolution === '720P' ? 0.6 : 1
      return pricePerSecond * (duration > 0 ? duration : 5)
    },
    description: '720P ¥0.6000/秒，1080P ¥1.0000/秒；按生成时长计费。'
  }
})

export default wan27Model
