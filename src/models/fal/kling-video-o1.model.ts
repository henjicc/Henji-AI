/**
 * Kling Video O1 视频生成模型
 */

import { defineModel, sharedFieldText, sharedModeText, sharedOptionText } from '@/core'

export const klingVideoO1Model = defineModel({
  meta: {
    id: 'fal-ai-kling-video-o1',
    canonicalModelId: 'kling-video-o1',
    seriesId: 'kling-video',
    seriesRank: 10,
    provider: 'fal',
    type: 'video',
        i18nScope: 'models.defs.fal-ai-kling-video-o1',
    name: { key: 'meta.name', fallback: 'Kling Video O1' },
    tags: ['video', 'text-to-video', 'image-to-video', 'start-end-frame', 'reference-mode', 'supports-video-editing', 'multi-mode-switch']
  },
  inputLimits: {
    images: { max: 2 },
    videos: { max: 0 },
    rules: [
      {
        when: 'falKlingVideoO1Mode === "reference-to-video"',
        images: { max: 7 }
      },
      {
        when: 'falKlingVideoO1Mode === "video-to-video-edit" || falKlingVideoO1Mode === "video-to-video-reference"',
        images: { max: 7 },
        videos: { exact: 1 }
      }
    ]
  },
  requirements: [
    {
      id: 'kling-video-o1-video-edit',
      when: 'falKlingVideoO1Mode === "video-to-video-edit" || falKlingVideoO1Mode === "video-to-video-reference"',
      require: { videos: { exact: 1 } },
      message: {
        title: '视频必需',
        message: '视频编辑/参考模式需要上传1个视频才能生成',
        type: 'warning'
      }
    }
  ],
  params: [
    {
      id: 'falKlingVideoO1Mode',
      order: 1,
      type: 'dropdown',
      name: sharedFieldText('mode'),
      default: 'image-to-video',
      options: [
        { value: 'image-to-video', label: sharedModeText('imageToVideo') },
        { value: 'reference-to-video', label: sharedModeText('referenceToVideo') },
        { value: 'video-to-video-edit', label: sharedModeText('videoEdit') },
        { value: 'video-to-video-reference', label: sharedModeText('videoReference') }
      ]
    },
    {
      id: 'falKlingVideoO1VideoDuration',
      order: 2,
      type: 'dropdown',
      name: sharedFieldText('duration'),
      default: 5,
      options: [
        { value: 5, label: '5s' },
        { value: 10, label: '10s' }
      ]
    },
    {
      id: 'falKlingVideoO1AspectRatio',
      order: 3,
      type: 'dropdown',
      name: sharedFieldText('aspectRatio'),
      default: '16:9',
      visible: {
        condition:
          'falKlingVideoO1Mode === "reference-to-video" || falKlingVideoO1Mode === "video-to-video-reference"'
      },
      options: [
        { value: 'auto', label: sharedOptionText('auto') },
        { value: '16:9', label: '16:9' },
        { value: '9:16', label: '9:16' },
        { value: '1:1', label: '1:1' }
      ]
    },
    {
      id: 'falKlingVideoO1KeepAudio',
      order: 4,
      type: 'switch',
      name: sharedFieldText('keepAudio'),
      default: false,
      visible: {
        condition:
          'falKlingVideoO1Mode === "video-to-video-edit" || falKlingVideoO1Mode === "video-to-video-reference"'
      }
    }
  ],
  linkages: [],
  endpoints: {
    selector: async (params) => {
      const mode = params.falKlingVideoO1Mode || 'image-to-video'
      switch (mode) {
        case 'image-to-video':
          return 'fal-ai/kling-video/o1/image-to-video'
        case 'reference-to-video':
          return 'fal-ai/kling-video/o1/reference-to-video'
        case 'video-to-video-edit':
          return 'fal-ai/kling-video/o1/video-to-video/edit'
        case 'video-to-video-reference':
          return 'fal-ai/kling-video/o1/video-to-video/reference'
        default:
          return 'fal-ai/kling-video/o1/image-to-video'
      }
    }
  },
  request: {
    builder: (params) => {
      const mode = params.falKlingVideoO1Mode || 'image-to-video'
      const filterSources = (value: DynamicValue): string[] =>
        Array.isArray(value)
          ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
          : []
      const uploadedImages = filterSources(params.uploadedFilePaths)
      const images = uploadedImages.length > 0 ? uploadedImages : filterSources(params.images)
      const uploadedVideos = filterSources(params.uploadedVideoFilePaths)
      const videos = uploadedVideos.length > 0 ? uploadedVideos : filterSources(params.videos)
      const prompt = params.prompt || ''
      const duration = params.falKlingVideoO1VideoDuration || 5
      const aspectRatio = params.falKlingVideoO1AspectRatio
      const keepAudio = params.falKlingVideoO1KeepAudio || false
      const videoInput = typeof params.video === 'string' ? params.video : videos[0]

      const requestData: DynamicValue = {
        prompt,
        duration: `${duration}`
      }

      if (mode === 'image-to-video') {
        if (images.length > 0) {
          requestData.start_image_url = images[0]
          if (images.length > 1) {
            requestData.end_image_url = images[1]
          }
        }
      }

      if (mode === 'reference-to-video') {
        if (images.length > 0) {
          requestData.image_urls = images
        }
        if (aspectRatio && aspectRatio !== 'auto') {
          requestData.aspect_ratio = aspectRatio
        }
      }

      if (mode === 'video-to-video-edit' || mode === 'video-to-video-reference') {
        if (videoInput) {
          requestData.video_url = videoInput
        }
        requestData.keep_audio = keepAudio
        if (images.length > 0) {
          requestData.image_urls = images
        }
        if (mode === 'video-to-video-reference' && aspectRatio && aspectRatio !== 'auto') {
          requestData.aspect_ratio = aspectRatio
        }
      }

      return requestData
    }
  },
  pricing: {
    currency: '$',
    calculator: (params) => {
      const mode = params.falKlingVideoO1Mode || 'image-to-video'
      const duration = Number(params.falKlingVideoO1VideoDuration) || 5
      const isVideoEdit = mode === 'video-to-video-edit' || mode === 'video-to-video-reference'
      return (isVideoEdit ? 0.168 : 0.112) * duration
    },
    description: '图生视频/参考生视频 $0.112/秒；视频编辑/参考 $0.168/秒'
  }
})

export default klingVideoO1Model;
