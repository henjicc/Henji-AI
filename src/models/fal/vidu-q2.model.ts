/**
 * Vidu Q2 视频生成模型
 */

import { defineModel, sharedFieldText, sharedModeText, sharedOptionText } from '@/core'

export const viduQ2Model = defineModel({
  meta: {
    id: 'fal-ai-vidu-q2',
    canonicalModelId: 'vidu-q2',
    seriesId: 'vidu',
    seriesRank: 2,
    provider: 'fal',
    type: 'video',
        i18nScope: 'models.defs.fal-ai-vidu-q2',
    name: { key: 'meta.name', fallback: 'Vidu Q2' },
    tags: ['video', 'text-to-video', 'image-to-video']
  },
  inputLimits: {
    images: { max: 0 },
    videos: { max: 0 },
    rules: [
      {
        when: 'viduQ2Mode === "image-to-video"',
        images: { max: 1 }
      },
      {
        when: 'viduQ2Mode === "reference-to-video"',
        images: { max: 7 }
      },
      {
        when: 'viduQ2Mode === "video-extension"',
        images: { max: 0 },
        videos: { exact: 1 }
      }
    ]
  },
  requirements: [
    {
      id: 'vidu-q2-video-extension',
      when: 'viduQ2Mode === "video-extension"',
      require: { videos: { exact: 1 } },
      message: {
        title: '视频必需',
        message: '视频延长模式需要上传1个视频才能生成',
        type: 'warning'
      }
    }
  ],
  params: [
    {
      id: 'viduQ2Mode',
      order: 1,
      type: 'dropdown',
      name: sharedFieldText('mode'),
      default: 'text-to-video',
      options: [
        { value: 'text-to-video', label: sharedModeText('textToVideo') },
        { value: 'image-to-video', label: sharedModeText('imageToVideo') },
        { value: 'reference-to-video', label: sharedModeText('referenceToVideo') },
        { value: 'video-extension', label: sharedModeText('videoExtension') }
      ]
    },
    {
      id: 'falViduQ2VideoDuration',
      order: 2,
      type: 'dropdown',
      name: sharedFieldText('duration'),
      default: 4,
      options: [
        { value: 4, label: '4s' },
        { value: 6, label: '6s' },
        { value: 8, label: '8s' }
      ]
    },
    {
      id: 'viduQ2AspectRatio',
      order: 3,
      type: 'dropdown',
      name: sharedFieldText('aspectRatio'),
      default: '16:9',
      visible: {
        condition: 'viduQ2Mode === "text-to-video" || viduQ2Mode === "reference-to-video"'
      },
      options: [
        { value: 'smart', label: sharedOptionText('smart') },
        { value: '16:9', label: '16:9' },
        { value: '9:16', label: '9:16' },
        { value: '1:1', label: '1:1' }
      ]
    },
    {
      id: 'viduQ2Resolution',
      order: 4,
      type: 'dropdown',
      name: sharedFieldText('resolution'),
      default: '720p',
      visible: {
        condition: 'viduQ2Mode === "image-to-video" || viduQ2Mode === "video-extension"'
      },
      options: [
        { value: '720p', label: '720p' },
        { value: '1080p', label: '1080p' }
      ]
    },
    {
      id: 'viduQ2MovementAmplitude',
      order: 5,
      type: 'dropdown',
      name: sharedFieldText('movementAmplitude'),
      default: 'auto',
      visible: {
        condition: 'viduQ2Mode !== "video-extension"'
      },
      options: [
        { value: 'auto', label: sharedOptionText('auto') },
        { value: 'low', label: sharedOptionText('low') },
        { value: 'medium', label: sharedOptionText('medium') },
        { value: 'high', label: sharedOptionText('high') }
      ]
    },
    {
      id: 'viduQ2Bgm',
      order: 6,
      type: 'switch',
      name: sharedFieldText('backgroundMusic'),
      default: false
    },
    {
      id: 'viduQ2FastMode',
      order: 7,
      type: 'switch',
      name: sharedFieldText('turboMode'),
      default: true,
      visible: {
        condition: 'viduQ2Mode === "image-to-video"'
      }
    }
  ],
  linkages: [],
  endpoints: {
    selector: async (params) => {
      const mode = params.viduQ2Mode || 'text-to-video'
      const fastMode = params.viduQ2FastMode !== false

      if (mode === 'video-extension') {
        return 'fal-ai/vidu/q2/video-extension/pro'
      }
      if (mode === 'reference-to-video') {
        return 'fal-ai/vidu/q2/reference-to-video'
      }
      if (mode === 'image-to-video') {
        return fastMode
          ? 'fal-ai/vidu/q2/image-to-video/turbo'
          : 'fal-ai/vidu/q2/image-to-video/pro'
      }
      return 'fal-ai/vidu/q2/text-to-video'
    }
  },
  request: {
    builder: (params) => {
      const mode = params.viduQ2Mode || 'text-to-video'
      const filterSources = (value: DynamicValue): string[] =>
        Array.isArray(value)
          ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
          : []
      const uploadedImages = filterSources(params.uploadedFilePaths)
      const images = uploadedImages.length > 0 ? uploadedImages : filterSources(params.images)
      const uploadedVideos = filterSources(params.uploadedVideoFilePaths)
      const videos = uploadedVideos.length > 0 ? uploadedVideos : filterSources(params.videos)
      const prompt = params.prompt || ''
      const duration = params.falViduQ2VideoDuration || 4
      const aspectRatio = params.viduQ2AspectRatio
      const resolution = params.viduQ2Resolution || '720p'
      const movementAmplitude = params.viduQ2MovementAmplitude || 'auto'
      const bgm = params.viduQ2Bgm === true
      const videoInput = typeof params.video === 'string' ? params.video : videos[0]

      const requestData: DynamicValue = { prompt }
      requestData.duration = duration

      if (mode === 'text-to-video' || mode === 'reference-to-video') {
        if (aspectRatio && aspectRatio !== 'smart' && aspectRatio !== 'auto') {
          requestData.aspect_ratio = aspectRatio
        }
        requestData.resolution = resolution
      } else if (mode === 'image-to-video') {
        requestData.resolution = resolution
      } else if (mode === 'video-extension') {
        requestData.resolution = resolution
      }

      if (mode !== 'video-extension') {
        requestData.movement_amplitude = movementAmplitude
      }

      requestData.bgm = bgm

      if (images.length > 0) {
        if (mode === 'reference-to-video') {
          requestData.reference_image_urls = images.slice(0, 7)
        } else if (mode === 'image-to-video') {
          requestData.image_url = images[0]
        }
      }

      if (mode === 'video-extension' && videoInput) {
        requestData.video_url = videoInput
      }

      return requestData
    }
  },
  pricing: {
    currency: '$',
    calculator: (params) => {
      const mode = params.viduQ2Mode || 'text-to-video'
      const duration = Number(params.falViduQ2VideoDuration) || 4
      const resolution = params.viduQ2Resolution === '1080p' ? '1080p' : '720p'
      if (mode === 'video-extension') {
        return resolution === '1080p' ? 0.28 + 0.075 * duration : 0.075 * duration
      }
      if (mode === 'image-to-video') {
        const turbo = params.viduQ2FastMode !== false
        if (turbo) return resolution === '1080p' ? 0.2 + 0.05 * duration : 0.05 * duration
        return resolution === '1080p' ? 0.3 + 0.1 * duration : 0.1 + 0.05 * duration
      }
      // text-to-video / reference-to-video
      return resolution === '1080p' ? 0.2 + 0.1 * duration : 0.3
    },
    description: '文生视频/参考生视频：720p $0.30/次，1080p $0.20+$0.10/秒；图生视频 Turbo：720p $0.05/秒，1080p $0.20+$0.05/秒；图生视频 Pro：720p $0.10+$0.05/秒，1080p $0.30+$0.10/秒；视频延长：720p $0.075/秒，1080p $0.28+$0.075/秒'
  }
})

export default viduQ2Model;
