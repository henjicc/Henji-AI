/**
 * Kling O1 模型定义
 *
 * 派欧云可灵视频 O1 - 支持文/图生视频、首尾帧、参考生视频、视频编辑
 */

import { defineModel, sharedFieldText, sharedModeText } from '@/core'
import {
  resolvePpioImageSources,
  resolvePpioPrimaryVideoSource,
  resolvePpioVideoSources,
} from './mediaSources'

export const klingO1Model = defineModel({
  meta: {
    id: 'ppio-kling-o1',
    provider: 'ppio',
    type: 'video',
        i18nScope: 'models.defs.ppio-kling-o1',
    name: { key: 'meta.name', fallback: 'Kling O1' },
    description: { key: 'meta.description', fallback: 'PPIO Kling video generation model O1, supports text/image-to-video, start-end-frame, reference-to-video, and video-edit modes' },
    tags: ['text-to-video', 'image-to-video', 'start-end-frame', 'reference-mode', 'supports-video-editing'],
    polling: {
      interval: 3000,
      maxAttempts: 120,
      expectedAttempts: 60
    }
  },
  inputLimits: {
    images: { max: 1 },
    videos: { max: 0 },
    rules: [
      {
        when: 'ppioKlingO1Mode === "start-end-frame"',
        images: { exact: 2 }
      },
      {
        when: 'ppioKlingO1Mode === "reference-to-video"',
        images: { max: 7 },
        videos: { exact: 1 },
        videoConstraints: {
          minDurationSec: 3,
          maxDurationSec: 10
        }
      },
      {
        when: 'ppioKlingO1Mode === "video-edit"',
        images: { max: 4 },
        videos: { exact: 1 },
        videoConstraints: {
          minDurationSec: 3,
          maxDurationSec: 10
        }
      }
    ]
  },
  requirements: [
    {
      id: 'kling-o1-start-end-frame-images',
      when: 'ppioKlingO1Mode === "start-end-frame"',
      require: { images: { exact: 2 } },
      message: {
        title: '图片必需',
        message: '首尾帧模式需要上传2张图片',
        type: 'warning'
      }
    },
    {
      id: 'kling-o1-reference-video',
      when: 'ppioKlingO1Mode === "reference-to-video"',
      require: { videos: { exact: 1 } },
      message: {
        title: '视频必需',
        message: '参考生视频模式需要上传1个3-10秒视频才能生成',
        type: 'warning'
      }
    },
    {
      id: 'kling-o1-video-edit',
      when: 'ppioKlingO1Mode === "video-edit"',
      require: { videos: { exact: 1 } },
      message: {
        title: '视频必需',
        message: '视频编辑模式需要上传1个3-10秒视频才能生成',
        type: 'warning'
      }
    }
  ],

  params: [
    // 1. Mode selection
    {
      id: 'ppioKlingO1Mode',
      type: 'dropdown',
      order: 1,
      valueType: 'string',
      name: sharedFieldText('mode'),
      default: 'text-image-to-video',
      options: [
        { value: 'text-image-to-video', label: sharedModeText('textImageToVideo') },
        { value: 'start-end-frame', label: sharedModeText('startEndFrame') },
        { value: 'reference-to-video', label: sharedModeText('referenceToVideo') },
        { value: 'video-edit', label: sharedModeText('videoEdit') }
      ]
    },

    // 2. Duration parameter
    {
      id: 'ppioKlingO1VideoDuration',
      type: 'dropdown',
      order: 2,
      valueType: 'number',
      name: sharedFieldText('duration'),
      default: 5,
      visible: {
        condition: 'ppioKlingO1Mode !== "video-edit"'
      },
      options: [
        { value: 5, label: '5s' },
        { value: 10, label: '10s' }
      ]
    },

    // 3. Aspect ratio parameter
    {
      id: 'ppioKlingO1AspectRatio',
      type: 'dropdown',
      order: 3,
      valueType: 'string',
      name: sharedFieldText('aspectRatio'),
      default: '16:9',
      visible: {
        condition: 'ppioKlingO1Mode !== "video-edit"'
      },
      options: [
        { value: '16:9', label: '16:9' },
        { value: '9:16', label: '9:16' },
        { value: '1:1', label: '1:1' }
      ]
    },

    // 4. Keep audio parameter
    {
      id: 'ppioKlingO1KeepAudio',
      type: 'switch',
      order: 4,
      valueType: 'boolean',
      name: sharedFieldText('keepAudio'),
      default: true,
      visible: {
        condition:
          'ppioKlingO1Mode === "reference-to-video" || ppioKlingO1Mode === "video-edit"'
      }
    },

    // 5. Fast mode parameter
    {
      id: 'ppioKlingO1FastMode',
      type: 'switch',
      order: 5,
      valueType: 'boolean',
      name: sharedFieldText('fastMode'),
      default: false,
      visible: {
        condition: 'ppioKlingO1Mode === "video-edit"'
      }
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
    selector: async (params) => {
      const mode = params.ppioKlingO1Mode || params.mode || 'text-image-to-video'
      const images = resolvePpioImageSources(params)

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
      const mode = params.ppioKlingO1Mode || params.mode || 'text-image-to-video'
      const images = resolvePpioImageSources(params)
      const videos = resolvePpioVideoSources(params)
      const video = resolvePpioPrimaryVideoSource(params) || videos[0]
      const duration = params.ppioKlingO1VideoDuration || params.duration || 5
      const aspectRatio = params.ppioKlingO1AspectRatio || params.aspect_ratio || '16:9'
      const keepAudio = params.ppioKlingO1KeepAudio !== undefined ? params.ppioKlingO1KeepAudio : (params.keep_original_sound !== undefined ? params.keep_original_sound : true)
      const fastMode = params.ppioKlingO1FastMode !== undefined ? params.ppioKlingO1FastMode : (params.fast_mode || false)
      const prompt = (params.prompt || '').slice(0, 2500)

      // Mode-specific logic
      switch (mode) {
        case 'text-image-to-video':
          if (images.length === 0) {
            // Text-to-video
            return {
              prompt,
              duration,
              aspect_ratio: aspectRatio
            }
          } else {
            // Image-to-video
            return {
              prompt,
              duration,
              image: images[0],
              ...(images.length > 1 ? { last_image: images[1] } : {}),
              aspect_ratio: aspectRatio
            }
          }
        case 'start-end-frame':
          return {
            prompt,
            duration,
            image: images[0],
            ...(images.length > 1 ? { last_image: images[1] } : {}),
            aspect_ratio: aspectRatio
          }

        case 'reference-to-video':
          return {
            prompt,
            duration,
            video,
            aspect_ratio: aspectRatio,
            keep_original_sound: keepAudio,
            ...(images.length > 0 ? { images: images.slice(0, 7) } : {})
          }

        case 'video-edit':
          return {
            prompt,
            video,
            fast_mode: fastMode,
            keep_original_sound: keepAudio,
            ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}),
            ...(images.length > 0 ? { images: images.slice(0, 4) } : {})
          }
      }

      return { prompt, duration, aspect_ratio: aspectRatio }
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
