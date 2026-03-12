/**
 * 示例：Nano Banana 模型定义
 *
 * 用于验证 ModelDefinition 接口的完整性和可用性
 */

import { ModelDefinition } from '../types/ModelDefinition'

/**
 * Nano Banana 模型配置示例
 */
export const nanoBananaExample: ModelDefinition = {
  meta: {
    id: 'nano-banana',
    provider: 'fal',
    type: 'image',
    name: {
      zh: 'Nano Banana',
      en: 'Nano Banana'
    },
    description: {
      zh: 'Google 最先进的图片生成和编辑模型',
      en: 'Google\'s most advanced image generation and editing model'
    },
    tags: [
      'text-to-image',
      'image-to-image',
      'supports-image-editing',
      'supports-multi-image',
      'no-resolution-panel',
      'provider-fal'
    ],
    icon: '/icons/nano-banana.png',
    polling: {
      interval: 3000,
      maxAttempts: 100,
      expectedAttempts: 30
    },
    aliases: ['fal-ai-nano-banana', 'nano-banana-fal']
  },

  params: [
    // TODO: Phase 1-1-2 将定义详细的参数配置
    // 现在只是占位符
  ],

  linkages: [
    // TODO: Phase 1-1-3 将定义详细的联动规则
    // 现在只是占位符
  ],

  endpoints: {
    rules: [
      {
        when: { hasImage: true },
        endpoint: '/fal-ai/nano-banana/image-to-image'
      },
      {
        when: { hasImage: false },
        endpoint: '/fal-ai/nano-banana/text-to-image'
      }
    ],
    default: '/fal-ai/nano-banana'
  },

  request: {
    base: {
      prompt: 'input.prompt',
      image_url: 'input.imageUrl',
      num_images: 'options.numImages',
      aspect_ratio: 'options.aspectRatio'
    },
    preprocess: (params) => {
      // 示例：图片 URL 预处理
      const processed = { ...params }

      // 如果有多张图片，只取第一张
      if (Array.isArray(params.images) && params.images.length > 0) {
        processed.image_url = params.images[0]
      }

      return processed
    }
  },

  pricing: {
    currency: '¥',
    fixed: 0.1,
    description: '每次生成 ¥0.1'
  }
}

/**
 * 示例：Seedream 4.0 模型定义
 */
export const seedream40Example: ModelDefinition = {
  meta: {
    id: 'seedream-4.0',
    provider: 'ppio',
    type: 'image',
    name: {
      zh: '即梦图片 4.0',
      en: 'Seedream 4.0'
    },
    description: {
      zh: '先进的图片生成模型，支持4K分辨率',
      en: 'Advanced image generation model with 4K resolution'
    },
    tags: [
      'text-to-image',
      'image-to-image',
      'supports-image-editing',
      'supports-multi-image',
      'sequential-generation',
      'supports-4k',
      'provider-ppio'
    ],
    polling: {
      interval: 3000,
      maxAttempts: 120,
      expectedAttempts: 20
    }
  },

  params: [],

  endpoints: '/api/ppio/seedream-4.0',

  request: {
    base: {
      prompt: 'input.prompt',
      images: 'input.images',
      max_images: 'options.maxImages',
      resolution: 'options.resolution'
    }
  },

  pricing: {
    currency: '¥',
    calculator: (params) => {
      // 根据分辨率和图片数量计算价格
      const basePrice = 0.15
      const maxImages = params.maxImages || 1
      const resolution = params.resolution || '1024x1024'

      // 4K 分辨率价格翻倍
      const is4K = resolution.includes('4096') || resolution.includes('3840')
      const resolutionMultiplier = is4K ? 2 : 1

      return basePrice * maxImages * resolutionMultiplier
    },
    description: '基础价格 ¥0.15/张，4K分辨率翻倍'
  }
}

/**
 * 示例：Kling 2.6 Pro 视频模型定义
 */
export const kling26ProExample: ModelDefinition = {
  meta: {
    id: 'kling-2.6-pro',
    provider: 'ppio',
    type: 'video',
    name: {
      zh: '可灵 2.6 Pro',
      en: 'Kling 2.6 Pro'
    },
    description: {
      zh: '支持文生视频、图生视频和动作控制，可生成带音频的高质量视频',
      en: 'Supports text-to-video, image-to-video and motion control with audio generation'
    },
    tags: [
      'text-to-video',
      'image-to-video',
      'supports-motion-control',
      'supports-audio-generation',
      'mixed-upload-mode',
      'video-duration-check',
      'multi-mode-switch',
      'provider-ppio'
    ],
    polling: {
      interval: 3000,
      maxAttempts: 200,
      expectedAttempts: 45
    }
  },

  params: [],

  endpoints: {
    rules: [
      { when: { mode: 'text-to-video' }, endpoint: '/api/ppio/kling-2.6-pro/text-to-video' },
      { when: { mode: 'image-to-video' }, endpoint: '/api/ppio/kling-2.6-pro/image-to-video' },
      { when: { mode: 'motion-control' }, endpoint: '/api/ppio/kling-2.6-pro/motion-control' }
    ],
    default: '/api/ppio/kling-2.6-pro'
  },

  request: {
    builder: (params) => {
      const request: Record<string, any> = {
        prompt: params.prompt,
        mode: params.mode || 'text-to-video'
      }

      // 根据模式添加不同的字段
      if (params.mode === 'image-to-video' || params.mode === 'motion-control') {
        request.images = params.images
      }

      if (params.mode === 'motion-control') {
        request.reference_video = params.referenceVideo
      }

      if (params.generateAudio) {
        request.audio = true
      }

      return request
    }
  },

  pricing: {
    currency: '¥',
    calculator: (params) => {
      // 根据视频时长和分辨率计算价格
      const duration = params.duration || 5
      const mode = params.mode || 'text-to-video'

      let pricePerSecond = 0.3

      // 动作控制模式价格更高
      if (mode === 'motion-control') {
        pricePerSecond = 0.5
      }

      // 音频生成额外收费
      if (params.generateAudio) {
        pricePerSecond += 0.1
      }

      return duration * pricePerSecond
    },
    description: '按视频时长和模式计费，支持音频生成'
  }
}
