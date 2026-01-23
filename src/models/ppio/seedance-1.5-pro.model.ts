/**
 * Seedance 1.5 Pro 模型定义
 *
 * 派欧云即舞视频 1.5 Pro - 支持文生视频、图生视频、首尾帧
 */

import { defineModel } from '@/core'

export const seedance15ProModel = defineModel({
  meta: {
    id: 'seedance-v1.5-pro',
    provider: 'ppio',
    type: 'video',
    name: { zh: '即舞视频 1.5 Pro', en: 'Seedance 1.5 Pro' },
    description: {
      zh: '派欧云即舞视频生成模型 1.5 Pro 版本，支持文生视频、图生视频、首尾帧三种模式',
      en: 'PPIO Seedance video generation model v1.5 Pro, supports text-to-video, image-to-video, and start-end-frame modes'
    },
    tags: ['text-to-video', 'image-to-video', 'supports-start-end-frame'],
    polling: {
      interval: 3000,
      maxAttempts: 120,
      expectedAttempts: 40
    }
  },

  params: [
    // 1. Aspect ratio parameter with smart match
    {
      id: 'ppioSeedance15ProAspectRatio',
      type: 'dropdown',
      order: 1,
      name: { zh: '分辨率', en: 'Resolution' },
      default: '1:1',
      options: [
        { value: '16:9', label: '16:9' },
        { value: '4:3', label: '4:3' },
        { value: '1:1', label: '1:1' },
        { value: '3:4', label: '3:4' },
        { value: '9:16', label: '9:16' },
        { value: '21:9', label: '21:9' }
      ],
      apiField: 'aspect_ratio'
    },

    // 2. Resolution quality parameter
    {
      id: 'ppioSeedance15ProResolution',
      type: 'dropdown',
      order: 2,
      name: { zh: '质量', en: 'Quality' },
      default: '720p',
      options: [
        { value: '480p', label: '480P' },
        { value: '720p', label: '720P' }
      ],
      apiField: 'resolution'
    },

    // 3. Duration parameter
    {
      id: 'ppioSeedance15ProDuration',
      type: 'dropdown',
      order: 3,
      name: { zh: '时长', en: 'Duration' },
      default: 5,
      options: [
        { value: 4, label: '4s' },
        { value: 5, label: '5s' },
        { value: 6, label: '6s' },
        { value: 7, label: '7s' },
        { value: 8, label: '8s' },
        { value: 9, label: '9s' },
        { value: 10, label: '10s' },
        { value: 11, label: '11s' },
        { value: 12, label: '12s' }
      ],
      apiField: 'duration'
    },

    // 4. Generate audio switch
    {
      id: 'ppioSeedance15ProGenerateAudio',
      type: 'switch',
      order: 4,
      name: { zh: '生成音频', en: 'Generate Audio' },
      default: false,
      apiField: 'generate_audio'
    },

    // 5. Camera fixed switch
    {
      id: 'ppioSeedance15ProCameraFixed',
      type: 'switch',
      order: 5,
      name: { zh: '固定相机', en: 'Fixed Camera' },
      default: false,
      apiField: 'camera_fixed'
    },

    // 6. Service tier parameter
    {
      id: 'ppioSeedance15ProServiceTier',
      type: 'dropdown',
      order: 6,
      name: { zh: '服务层级', en: 'Service Tier' },
      tooltip: {
        zh: '在线推理模式，RPM 和并发配额较低，适用于时效性要求高的场景。离线推理模式，TPD 配额更高，价格为在线模式的 50%，适用于对延迟不敏感的场景。',
        en: 'Online mode has lower RPM and concurrency quotas, suitable for time-sensitive scenarios. Offline mode has higher TPD quotas at 50% price, suitable for delay-insensitive scenarios.'
      },
      default: 'default',
      options: [
        { value: 'default', label: { zh: '在线模式', en: 'Online Mode' } },
        { value: 'flex', label: { zh: '离线模式', en: 'Offline Mode' } }
      ],
      apiField: 'service_tier'
    }
  ],

  linkages: [
    // AutoSwitch 1: Upload image → switch to smart
    {
      trigger: 'uploadedImages',
      effect: 'autoSwitch',
      target: 'ppioSeedance15ProAspectRatio',
      condition: (images: string[], allParams: Record<string, any>) => {
        const imageCount = images?.length || 0
        const currentRatio = allParams.ppioSeedance15ProAspectRatio
        return imageCount > 0 && currentRatio !== 'smart'
      },
      value: 'smart'
    },

    // AutoSwitch 2: Delete all images → reset to default
    {
      trigger: 'uploadedImages',
      effect: 'autoSwitch',
      target: 'ppioSeedance15ProAspectRatio',
      condition: (images: string[], allParams: Record<string, any>) => {
        const imageCount = images?.length || 0
        const currentRatio = allParams.ppioSeedance15ProAspectRatio
        return imageCount === 0 && currentRatio === 'smart'
      },
      value: '1:1'
    },

    // FilterOptions: Add smart option when images are uploaded
    {
      trigger: 'uploadedImages',
      effect: 'filterOptions',
      target: 'ppioSeedance15ProAspectRatio',
      filter: (images: string[], options: any[]) => {
        const imageCount = images?.length || 0
        if (imageCount > 0) {
          // Add smart option at the beginning
          return [
            { value: 'smart', label: { zh: '智能', en: 'Smart' } },
            ...options
          ]
        }
        return options
      }
    }
  ],
  endpoints: {
    selector: (params) => {
      const images = params.images || []

      if (images.length === 2) {
        // Start-end-frame mode
        return '/async/seedance-v1.5-pro-start-end-frame'
      } else if (images.length === 1) {
        // Image-to-video mode
        return '/async/seedance-v1.5-pro-i2v'
      } else {
        // Text-to-video mode
        return '/async/seedance-v1.5-pro-t2v'
      }
    }
  },
  request: {
    builder: (params) => {
      const images = params.images || []
      const resolution = params.resolution || '720p'
      const duration = params.duration || 5
      const cameraFixed = params.camera_fixed || false
      const serviceTier = params.service_tier || 'default'
      const generateAudio = params.generate_audio || false

      // Get aspect ratio, use smartMatchedRatio if ratio is 'smart'
      let ratio = params.ratio || '1:1'
      if (ratio === 'smart' && params.smartMatchedRatio) {
        ratio = params.smartMatchedRatio
      }

      const requestData: any = {
        prompt: params.prompt,
        resolution,
        ratio,
        duration,
        camera_fixed: cameraFixed,
        service_tier: serviceTier,
        generate_audio: generateAudio
      }

      // Add image(s) if present
      if (images.length > 0) {
        requestData.image = images[0]

        // Add last_image for start-end-frame mode
        if (images.length >= 2) {
          requestData.last_image = images[1]
        }
      }

      return requestData
    }
  },
  pricing: {
    currency: '¥',
    calculator: (params) => {
      const basePrice = 0.5
      const duration = params.ppioSeedance15ProDuration || 5
      const resolution = params.ppioSeedance15ProResolution || '720p'
      const serviceTier = params.ppioSeedance15ProServiceTier || 'default'

      // Resolution multiplier
      const resolutionMultiplier = resolution === '720p' ? 1 : 0.8

      // Service tier multiplier (offline mode is 50% price)
      const tierMultiplier = serviceTier === 'flex' ? 0.5 : 1

      // Duration multiplier (price scales with duration)
      const durationMultiplier = duration / 5

      return basePrice * resolutionMultiplier * tierMultiplier * durationMultiplier
    },
    description: '基础价格 ¥0.5/5秒，离线模式半价'
  }
})

export default seedance15ProModel;
