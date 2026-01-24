/**
 * Kling Video O1 视频生成模型
 */

import { defineModel } from '@/core'

export const klingVideoO1Model = defineModel({
  meta: {
    id: 'fal-ai-kling-video-o1',
    provider: 'fal',
    type: 'video',
    name: 'Kling Video O1',
    description: 'Kling Video O1 视频生成模型',
    tags: ['video', 'text-to-video', 'image-to-video']
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
      name: { zh: '模式', en: 'Mode' },
      default: 'image-to-video',
      options: [
        { value: 'image-to-video', label: { zh: '图生视频', en: 'Image to Video' } },
        { value: 'reference-to-video', label: { zh: '参考生视频', en: 'Reference to Video' } },
        { value: 'video-to-video-edit', label: { zh: '视频编辑', en: 'Video Edit' } },
        { value: 'video-to-video-reference', label: { zh: '视频参考', en: 'Video Reference' } }
      ]
    },
    {
      id: 'falKlingVideoO1VideoDuration',
      order: 2,
      type: 'dropdown',
      name: { zh: '时长', en: 'Duration' },
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
      name: { zh: '比例', en: 'Aspect Ratio' },
      default: '16:9',
      options: [
        { value: 'auto', label: { zh: '自动', en: 'Auto' } },
        { value: '16:9', label: '16:9' },
        { value: '9:16', label: '9:16' },
        { value: '1:1', label: '1:1' }
      ]
    },
    {
      id: 'falKlingVideoO1KeepAudio',
      order: 4,
      type: 'switch',
      name: { zh: '保留音频', en: 'Keep Audio' },
      default: false
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
      const images = params.images || []
      const prompt = params.prompt || ''
      const duration = params.falKlingVideoO1VideoDuration || 5
      const aspectRatio = params.falKlingVideoO1AspectRatio
      const keepAudio = params.falKlingVideoO1KeepAudio || false
      const videoInput = params.video || (Array.isArray(params.videos) ? params.videos.find((v: any) => typeof v === 'string' && v.startsWith('http')) : undefined)

      const requestData: any = {
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
    calculator: () => 0.15,
    description: '基础价格 $0.15/次'
  }
})

export default klingVideoO1Model;
