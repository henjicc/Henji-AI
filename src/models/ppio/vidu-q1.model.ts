/**
 * Vidu Q1 视频生成模型
 */

import { defineModel } from '@/core'

export const viduQ1Model = defineModel({
  meta: {
    id: 'ppio-vidu-q1',
    provider: 'ppio',
    type: 'video',
        i18nScope: 'models.defs.ppio-vidu-q1',
    name: { key: 'meta.name', fallback: 'Vidu Q1' },
    description: 'Vidu Q1 视频生成模型',
    tags: ['video', 'text-to-video', 'image-to-video']
  },
  inputLimits: {
    images: { max: 1 },
    videos: { max: 0 },
    rules: [
      {
        when: 'ppioViduQ1Mode === "start-end-frame"',
        images: { exact: 2 }
      },
      {
        when: 'ppioViduQ1Mode === "reference-to-video"',
        images: { max: 7 }
      }
    ]
  },
  requirements: [
    {
      id: 'vidu-q1-start-end-frame',
      when: 'ppioViduQ1Mode === "start-end-frame"',
      require: { images: { exact: 2 } },
      message: {
        title: '图片必需',
        message: '首尾帧模式需要上传2张图片',
        type: 'warning'
      }
    }
  ],
  params: [
    // 1. 模式
    {
      id: 'ppioViduQ1Mode',
      type: 'dropdown',
      order: 1,
      name: { key: 'auto.1', fallback: 'Mode' },
      default: 'text-image-to-video',
      options: [
        { value: 'text-image-to-video', label: '文/图生视频' },
        { value: 'start-end-frame', label: '首尾帧' },
        { value: 'reference-to-video', label: '参考生视频' }
      ],
      apiField: 'mode'
    },
    // 2. 宽高比
    {
      id: 'ppioViduQ1AspectRatio',
      type: 'dropdown',
      order: 2,
      name: { key: 'auto.2', fallback: 'Aspect Ratio' },
      default: '16:9',
      options: [
        { value: '16:9', label: '16:9' },
        { value: '9:16', label: '9:16' },
        { value: '1:1', label: '1:1' }
      ],
      apiField: 'aspect_ratio'
    },
    // 3. 风格
    {
      id: 'ppioViduQ1Style',
      type: 'dropdown',
      order: 3,
      name: { key: 'auto.3', fallback: 'Style' },
      default: 'general',
      options: [
        { value: 'general', label: '通用' },
        { value: 'anime', label: '动漫' }
      ],
      apiField: 'style'
    },
    // 4. 运动幅度
    {
      id: 'ppioViduQ1MovementAmplitude',
      type: 'dropdown',
      order: 4,
      name: { key: 'auto.4', fallback: 'Movement Amplitude' },
      default: 'auto',
      options: [
        { value: 'auto', label: '自动' },
        { value: 'small', label: '小' },
        { value: 'medium', label: '中' },
        { value: 'large', label: '大' }
      ],
      apiField: 'movement_amplitude'
    },
    // 5. 生成音频
    {
      id: 'ppioViduQ1Bgm',
      type: 'switch',
      order: 5,
      name: { key: 'auto.5', fallback: 'Generate Audio' },
      default: false,
      apiField: 'bgm'
    }
  ],
  linkages: [
    // Auto-switch mode based on image count
    {
      trigger: 'uploadedImages',
      effect: 'autoSwitch',
      target: 'ppioViduQ1Mode',
      condition: (images, allParams) => {
        const count = images?.length || 0
        const currentMode = allParams.ppioViduQ1Mode
        let targetMode: string
        if (count === 0 || count === 1) {
          targetMode = 'text-image-to-video'
        } else if (count === 2) {
          targetMode = 'start-end-frame'
        } else {
          targetMode = 'reference-to-video'
        }
        return currentMode !== targetMode
      },
      value: (images) => {
        const count = images?.length || 0
        if (count === 0 || count === 1) return 'text-image-to-video'
        if (count === 2) return 'start-end-frame'
        return 'reference-to-video'
      }
    },
    // Hide aspect ratio in start-end-frame mode
    {
      trigger: 'ppioViduQ1Mode',
      effect: 'hide',
      targets: ['ppioViduQ1AspectRatio'],
      condition: (mode) => mode === 'start-end-frame'
    },
    // Hide aspect ratio when images uploaded in text-image mode
    {
      trigger: ['ppioViduQ1Mode', 'uploadedImages'],
      effect: 'hide',
      targets: ['ppioViduQ1AspectRatio'],
      condition: (_, allParams) => {
        const mode = allParams.ppioViduQ1Mode
        const imageCount = allParams.uploadedImages?.length || 0
        return mode === 'text-image-to-video' && imageCount > 0
      }
    },
    // Hide style when not text-to-video with no images
    {
      trigger: ['ppioViduQ1Mode', 'uploadedImages'],
      effect: 'hide',
      targets: ['ppioViduQ1Style'],
      condition: (_, allParams) => {
        const mode = allParams.ppioViduQ1Mode
        const imageCount = allParams.uploadedImages?.length || 0
        return !(mode === 'text-image-to-video' && imageCount === 0)
      }
    }
  ],
  endpoints: {
    selector: async (params) => {
      const mode = params.ppioViduQ1Mode || params.mode || 'text-image-to-video'
      const images = params.images || []

      switch (mode) {
        case 'text-image-to-video':
          return images.length > 0 ? '/async/vidu-q1-img2video' : '/async/vidu-q1-text2video'
        case 'start-end-frame':
          return '/async/vidu-q1-startend2video'
        case 'reference-to-video':
          return '/async/vidu-q1-reference2video'
        default:
          throw new Error(`Unsupported mode: ${mode}`)
      }
    }
  },
  request: {
    builder: (params) => {
      const mode = params.ppioViduQ1Mode || params.mode || 'text-image-to-video'
      const images = params.images || []
      const prompt = params.prompt || ''
      const movementAmplitude = params.ppioViduQ1MovementAmplitude || params.movement_amplitude || 'auto'
      const bgm = params.ppioViduQ1Bgm !== undefined ? params.ppioViduQ1Bgm : (params.bgm || false)

      const requestData: any = {
        prompt,
        duration: 5,
        resolution: '1080p',
        movement_amplitude: movementAmplitude,
        bgm
      }

      if (params.seed !== undefined) {
        requestData.seed = params.seed
      }

      switch (mode) {
        case 'text-image-to-video':
          if (images.length > 0) {
            requestData.images = [images[0]]
          } else {
            requestData.aspect_ratio = params.ppioViduQ1AspectRatio || params.aspect_ratio || '16:9'
            requestData.style = params.ppioViduQ1Style || params.style || 'general'
          }
          break
        case 'start-end-frame':
          if (images.length >= 2) {
            requestData.images = [images[0], images[1]]
          }
          break
        case 'reference-to-video':
          if (images.length > 0) {
            requestData.images = images.slice(0, 7)
            requestData.aspect_ratio = params.ppioViduQ1AspectRatio || params.aspect_ratio || '16:9'
          }
          break
      }

      return requestData
    }
  },
  pricing: {
    currency: '¥',
    calculator: (params) => {
      const basePrice = 0.6
      return basePrice
    },
    description: '基础价格 ¥0.6/次'
  }
})

export default viduQ1Model;
