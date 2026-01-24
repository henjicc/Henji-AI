/**
 * Wan 2.6 模型定义
 *
 * 派欧云万象视频 2.6 - 支持文/图生视频、参考生视频
 */

import { defineModel } from '@/core'

export const wan26Model = defineModel({
  meta: {
    id: 'wan-2.6',
    provider: 'ppio',
    type: 'video',
    name: { zh: '万象视频 2.6', en: 'Wan 2.6' },
    description: {
      zh: '派欧云万象视频生成模型 2.6 版本，支持文/图生视频和参考生视频两种模式',
      en: 'PPIO Wan video generation model v2.6, supports text/image-to-video and reference-to-video modes'
    },
    tags: ['text-to-video', 'image-to-video', 'reference-mode'],
    polling: {
      interval: 3000,
      maxAttempts: 120,
      expectedAttempts: 45
    }
  },
  inputLimits: {
    images: { max: 1 },
    videos: { max: 0 },
    rules: [
      {
        when: 'ppioWan26Mode === "reference-to-video"',
        images: { max: 0 },
        videos: { exact: 1 }
      }
    ]
  },
  requirements: [
    {
      id: 'wan-26-reference-video',
      when: 'ppioWan26Mode === "reference-to-video"',
      require: { videos: { exact: 1 } },
      message: {
        title: '视频必需',
        message: '参考生视频模式需要上传视频才能生成',
        type: 'warning'
      }
    }
  ],

  params: [
    // 1. Mode selection
    {
      id: 'ppioWan26Mode',
      type: 'dropdown',
      order: 1,
      name: { zh: '模式', en: 'Mode' },
      default: 'text-image-to-video',
      options: [
        { value: 'text-image-to-video', label: { zh: '文/图生视频', en: 'Text/Image to Video' } },
        { value: 'reference-to-video', label: { zh: '参考生视频', en: 'Reference to Video' } }
      ],
      apiField: 'mode'
    },

    // 2. Aspect ratio parameter
    {
      id: 'ppioWan26AspectRatio',
      type: 'dropdown',
      order: 2,
      name: { zh: '分辨率', en: 'Resolution' },
      default: '16:9',
      options: [
        { value: '16:9', label: '16:9' },
        { value: '9:16', label: '9:16' },
        { value: '1:1', label: '1:1' },
        { value: '4:3', label: '4:3' },
        { value: '3:4', label: '3:4' }
      ],
      apiField: 'aspect_ratio'
    },

    // 3. Quality parameter
    {
      id: 'ppioWan26Quality',
      type: 'dropdown',
      order: 3,
      name: { zh: '质量', en: 'Quality' },
      default: '720P',
      options: [
        { value: '720P', label: '720P' },
        { value: '1080P', label: '1080P' }
      ],
      apiField: 'quality'
    },

    // 4. Duration parameter
    {
      id: 'ppioWan26VideoDuration',
      type: 'dropdown',
      order: 4,
      name: { zh: '时长', en: 'Duration' },
      default: 5,
      options: [
        { value: 5, label: '5s' },
        { value: 10, label: '10s' },
        { value: 15, label: '15s' }
      ],
      apiField: 'duration'
    },

    // 5. Shot type parameter
    {
      id: 'ppioWan26ShotType',
      type: 'dropdown',
      order: 5,
      name: { zh: '镜头类型', en: 'Shot Type' },
      default: 'multi',
      options: [
        { value: 'multi', label: { zh: '多镜头', en: 'Multi-shot' } },
        { value: 'single', label: { zh: '单镜头', en: 'Single-shot' } }
      ],
      apiField: 'shot_type'
    },

    // 6. Audio parameter
    {
      id: 'ppioWan26Audio',
      type: 'switch',
      order: 6,
      name: { zh: '生成音频', en: 'Generate Audio' },
      default: true,
      apiField: 'audio'
    },

    // 7. Prompt extend parameter
    {
      id: 'ppioWan26PromptExtend',
      type: 'switch',
      order: 7,
      name: { zh: '提示词扩展', en: 'Prompt Extend' },
      default: true,
      apiField: 'prompt_extend'
    }
  ],
  linkages: [
    // AutoSwitch: Duration adjustment for reference-to-video mode
    {
      trigger: 'ppioWan26Mode',
      effect: 'autoSwitch',
      target: 'ppioWan26VideoDuration',
      condition: (mode: string, allParams: Record<string, any>) => {
        const duration = allParams.ppioWan26VideoDuration || 5
        return mode === 'reference-to-video' && duration === 15
      },
      value: 10
    }
  ],
  endpoints: {
    selector: (params) => {
      const mode = params.ppioWan26Mode || params.mode || 'text-image-to-video'
      const images = params.images || []

      if (mode === 'reference-to-video') {
        return '/async/wan2.6-v2v'
      }
      if (images.length > 0) {
        return '/async/wan2.6-i2v'
      }
      return '/async/wan2.6-t2v'
    }
  },
  request: {
    builder: (params) => {
      const mode = params.ppioWan26Mode || params.mode || 'text-image-to-video'
      const images = params.images || []
      const videos = params.videos || []
      const video = params.video || videos[0]
      const aspectRatio = params.ppioWan26AspectRatio || params.aspect_ratio || '16:9'
      const quality = params.ppioWan26Quality || params.quality || '720P'
      const duration = params.ppioWan26VideoDuration || params.duration || 5
      const shotType = params.ppioWan26ShotType || params.shot_type || 'multi'
      const audio = params.ppioWan26Audio !== undefined ? params.ppioWan26Audio : (params.audio !== undefined ? params.audio : true)
      const promptExtend = params.ppioWan26PromptExtend !== undefined ? params.ppioWan26PromptExtend : (params.prompt_extend !== undefined ? params.prompt_extend : true)
      const prompt = (params.prompt || '').slice(0, 2000)
      const negativePrompt = params.ppioWan26NegativePrompt || params.negative_prompt

      const resolutionMap: Record<string, Record<string, string>> = {
        '16:9': { '720P': '1280*720', '1080P': '1920*1080' },
        '9:16': { '720P': '720*1280', '1080P': '1080*1920' },
        '1:1': { '720P': '960*960', '1080P': '1440*1440' },
        '4:3': { '720P': '1088*832', '1080P': '1632*1248' },
        '3:4': { '720P': '832*1088', '1080P': '1248*1632' }
      }

      const input: Record<string, any> = { prompt }
      if (negativePrompt) {
        input.negative_prompt = negativePrompt
      }
      if (params.audio_url) {
        input.audio_url = params.audio_url
      }

      if (mode === 'reference-to-video') {
        if (video) {
          input.reference_video_urls = [video]
        }
      } else if (images.length > 0) {
        input.img_url = images[0]
        if (params.template) {
          input.template = params.template
        }
      }

      const parameters: Record<string, any> = {
        audio,
        duration,
        shot_type: shotType,
        watermark: false,
        prompt_extend: promptExtend
      }

      if (params.seed !== undefined) {
        parameters.seed = params.seed
      }

      if (mode === 'reference-to-video' || images.length === 0) {
        parameters.size = resolutionMap[aspectRatio]?.[quality] || '1280*720'
      } else {
        parameters.resolution = quality
      }

      return { input, parameters }
    }
  },
  pricing: {
    currency: '¥',
    calculator: (params) => {
      const basePrice = 0.6
      const duration = params.ppioWan26VideoDuration || 5
      const quality = params.ppioWan26Quality || '720P'

      // Quality multiplier
      const qualityMultiplier = quality === '1080P' ? 1.5 : 1

      // Duration multiplier
      const durationMultiplier = duration / 5

      return basePrice * qualityMultiplier * durationMultiplier
    },
    description: '基础价格 ¥0.6/5秒，1080P 增加 50%'
  }
})

export default wan26Model;
