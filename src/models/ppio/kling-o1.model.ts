/**
 * Kling O1 模型定义
 *
 * 派欧云可灵视频 O1 - 支持文/图生视频、首尾帧、参考生视频、视频编辑
 */

import { defineModel } from '@/core'

export const klingO1Model = defineModel({
  meta: {
    id: 'kling-o1',
    provider: 'ppio',
    type: 'video',
    name: { zh: '可灵视频 O1', en: 'Kling O1' },
    description: {
      zh: '派欧云可灵视频生成模型 O1 版本，支持文/图生视频、首尾帧、参考生视频、视频编辑四种模式',
      en: 'PPIO Kling video generation model O1, supports text/image-to-video, start-end-frame, reference-to-video, and video-edit modes'
    },
    tags: ['text-to-video', 'image-to-video', 'start-end-frame', 'reference-mode', 'supports-video-editing'],
    polling: {
      interval: 3000,
      maxAttempts: 120,
      expectedAttempts: 60
    }
  },

  params: [
    // 1. Mode selection
    {
      id: 'ppioKlingO1Mode',
      type: 'dropdown',
      order: 1,
      name: { zh: '模式', en: 'Mode' },
      default: 'text-image-to-video',
      options: [
        { value: 'text-image-to-video', label: { zh: '文/图生视频', en: 'Text/Image to Video' } },
        { value: 'start-end-frame', label: { zh: '首尾帧', en: 'Start-End Frame' } },
        { value: 'reference-to-video', label: { zh: '参考生视频', en: 'Reference to Video' } },
        { value: 'video-edit', label: { zh: '视频编辑', en: 'Video Edit' } }
      ],
      apiField: 'mode'
    },

    // 2. Duration parameter
    {
      id: 'ppioKlingO1VideoDuration',
      type: 'dropdown',
      order: 2,
      name: { zh: '时长', en: 'Duration' },
      default: 5,
      options: [
        { value: 5, label: '5s' },
        { value: 10, label: '10s' }
      ],
      apiField: 'duration'
    },

    // 3. Aspect ratio parameter
    {
      id: 'ppioKlingO1AspectRatio',
      type: 'dropdown',
      order: 3,
      name: { zh: '宽高比', en: 'Aspect Ratio' },
      default: '16:9',
      options: [
        { value: '16:9', label: '16:9' },
        { value: '9:16', label: '9:16' },
        { value: '1:1', label: '1:1' }
      ],
      apiField: 'aspectRatio'
    },

    // 4. Keep audio parameter
    {
      id: 'ppioKlingO1KeepAudio',
      type: 'switch',
      order: 4,
      name: { zh: '保留音频', en: 'Keep Audio' },
      default: true,
      apiField: 'keepAudio'
    },

    // 5. Fast mode parameter
    {
      id: 'ppioKlingO1FastMode',
      type: 'switch',
      order: 5,
      name: { zh: '快速模式', en: 'Fast Mode' },
      default: false,
      apiField: 'fastMode'
    }
  ],
  linkages: [
    // Mode AutoSwitch 1: 2 images uploaded → switch to start-end-frame
    {
      trigger: 'images',
      effect: 'autoSwitch',
      target: 'ppioKlingO1Mode',
      condition: (images: string[], allParams: Record<string, any>) => {
        const count = images?.length || 0
        const mode = allParams.ppioKlingO1Mode
        return mode === 'text-image-to-video' && count === 2
      },
      value: 'start-end-frame'
    },

    // Mode AutoSwitch 2: Video uploaded in video modes → keep current mode
    {
      trigger: ['videos', 'images'],
      effect: 'autoSwitch',
      target: 'ppioKlingO1Mode',
      condition: (_: any, allParams: Record<string, any>) => {
        const videoCount = allParams.uploadedVideos?.length || 0
        const mode = allParams.ppioKlingO1Mode
        return videoCount > 0 && (mode === 'reference-to-video' || mode === 'video-edit')
      },
      value: (_: any, allParams: Record<string, any>) => allParams.ppioKlingO1Mode,
      noRestore: true
    },

    // Aspect Ratio AutoSwitch 1: Upload image in text-image-to-video → switch to smart
    {
      trigger: ['ppioKlingO1Mode', 'images', 'videos'],
      effect: 'autoSwitch',
      target: 'ppioKlingO1AspectRatio',
      condition: (_: any, allParams: Record<string, any>) => {
        const mode = allParams.ppioKlingO1Mode || 'text-image-to-video'
        const imageCount = allParams.uploadedImages?.length || 0
        const currentRatio = allParams.ppioKlingO1AspectRatio
        return (mode === 'text-image-to-video' || mode === 'start-end-frame') &&
          imageCount > 0 &&
          currentRatio !== 'smart'
      },
      value: 'smart'
    },

    // Aspect Ratio AutoSwitch 2: Switch to video mode with smart → reset to 16:9
    {
      trigger: ['ppioKlingO1Mode', 'videos'],
      effect: 'autoSwitch',
      target: 'ppioKlingO1AspectRatio',
      condition: (_: any, allParams: Record<string, any>) => {
        const mode = allParams.ppioKlingO1Mode || 'text-image-to-video'
        const currentRatio = allParams.ppioKlingO1AspectRatio
        return currentRatio === 'smart' &&
          (mode === 'reference-to-video' || mode === 'video-edit')
      },
      value: '16:9'
    },

    // Aspect Ratio AutoSwitch 3: Delete all images in image modes → reset to 16:9
    {
      trigger: ['images', 'videos'],
      effect: 'autoSwitch',
      target: 'ppioKlingO1AspectRatio',
      condition: (_: any, allParams: Record<string, any>) => {
        const mode = allParams.ppioKlingO1Mode || 'text-image-to-video'
        const imageCount = allParams.uploadedImages?.length || 0
        const currentRatio = allParams.ppioKlingO1AspectRatio
        return (mode === 'text-image-to-video' || mode === 'start-end-frame') &&
          imageCount === 0 &&
          currentRatio === 'smart'
      },
      value: '16:9'
    }
  ],
  endpoints: {
    selector: (params) => {
      const mode = params.mode || 'text-image-to-video'
      const images = params.images || []

      switch (mode) {
        case 'text-image-to-video':
          return images.length === 0 ? '/async/kling-o1-t2v' : '/async/kling-o1-i2v'

        case 'start-end-frame':
          return '/async/kling-o1-i2v'

        case 'reference-to-video':
          return '/async/kling-o1-ref2v'

        case 'video-edit':
          return '/async/kling-o1-video-edit'

        default:
          throw new Error(`Unsupported mode: ${mode}`)
      }
    }
  },
  request: {
    builder: (params) => {
      const mode = params.mode || 'text-image-to-video'
      const images = params.images || []
      const videos = params.videos || []
      const duration = params.duration || 5
      const aspectRatio = params.aspect_ratio || '16:9'
      const keepAudio = params.keep_audio !== undefined ? params.keep_audio : true
      const fastMode = params.fast_mode || false
      const prompt = (params.prompt || '').slice(0, 2500)

      const requestData: any = {
        prompt,
        duration
      }

      // Mode-specific logic
      switch (mode) {
        case 'text-image-to-video':
          if (images.length === 0) {
            // Text-to-video
            requestData.aspect_ratio = aspectRatio
          } else {
            // Image-to-video
            requestData.image = images[0]
            if (images.length > 1) {
              requestData.last_image = images[1]
            }
            requestData.aspect_ratio = aspectRatio
          }
          break

        case 'start-end-frame':
          requestData.image = images[0]
          requestData.last_image = images[1]
          requestData.aspect_ratio = aspectRatio
          break

        case 'reference-to-video':
          requestData.video = videos[0]
          requestData.aspect_ratio = aspectRatio
          requestData.keep_original_sound = keepAudio
          if (images.length > 0) {
            requestData.images = images.slice(0, 7)
          }
          break

        case 'video-edit':
          requestData.video = videos[0]
          requestData.fast_mode = fastMode
          requestData.keep_original_sound = keepAudio
          if (images.length > 0) {
            requestData.images = images.slice(0, 4)
          }
          if (aspectRatio) {
            requestData.aspect_ratio = aspectRatio
          }
          break
      }

      return requestData
    }
  },
  pricing: {
    currency: '¥',
    calculator: (params) => {
      const mode = params.ppioKlingO1Mode || 'text-image-to-video'
      const duration = params.ppioKlingO1VideoDuration || 5
      const fastMode = params.ppioKlingO1FastMode || false

      // Base prices by mode
      if (mode === 'video-edit') {
        return fastMode ? 2.0 : 1.5
      }

      if (mode === 'reference-to-video') {
        return 1.2
      }

      // text-image-to-video and start-end-frame modes
      const basePrice = 1.0
      const durationMultiplier = duration / 5
      return basePrice * durationMultiplier
    },
    description: '基础价格 ¥1.0/5秒，参考生视频 ¥1.2，视频编辑 ¥1.5（快速模式 ¥2.0）'
  }
})

export default klingO1Model;
