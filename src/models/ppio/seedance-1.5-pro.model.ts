/**
 * Seedance 1.5 Pro 模型定义
 *
 * 派欧云即舞视频 1.5 Pro - 支持文生视频、图生视频、首尾帧
 */

import { defineModel, modelScopedText, sharedFieldText, sharedOptionText } from '@/core'
import { resolvePpioImageSources } from './mediaSources'

export const seedance15ProModel = defineModel({
  meta: {
    id: 'ppio-seedance-v1.5-pro',
    canonicalModelId: 'seedance-1.5-pro',
    seriesId: 'seedance',
    seriesRank: 1.5,
    provider: 'ppio',
    type: 'video',
        i18nScope: 'models.defs.ppio-seedance-v1.5-pro',
    name: { key: 'meta.name', fallback: 'Seedance 1.5 Pro' },
    tags: ['text-to-video', 'image-to-video', 'start-end-frame'],
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
      name: sharedFieldText('resolution'),
      default: 'adaptive',
      options: [
        { value: '16:9', label: '16:9' },
        { value: '4:3', label: '4:3' },
        { value: '1:1', label: '1:1' },
        { value: '3:4', label: '3:4' },
        { value: '9:16', label: '9:16' },
        { value: '21:9', label: '21:9' },
        { value: 'adaptive', label: sharedOptionText('adaptive') }
      ],
      apiField: 'aspect_ratio'
    },

    // 2. Resolution quality parameter
    {
      id: 'ppioSeedance15ProResolution',
      type: 'dropdown',
      order: 2,
      name: sharedFieldText('quality'),
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
      name: sharedFieldText('duration'),
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
      name: sharedFieldText('generateAudio'),
      default: true,
      apiField: 'generate_audio'
    },

    // 5. Camera fixed switch
    {
      id: 'ppioSeedance15ProCameraFixed',
      type: 'switch',
      order: 5,
      name: sharedFieldText('fixedCamera'),
      default: false,
      apiField: 'camera_fixed'
    },

    // 6. Service tier parameter
    {
      id: 'ppioSeedance15ProServiceTier',
      type: 'dropdown',
      order: 6,
      name: sharedFieldText('serviceTier'),
      tooltip: modelScopedText('params.ppioSeedance15ProServiceTier.tooltip', 'Online mode has lower RPM and concurrency quotas, suitable for time-sensitive scenarios. Offline mode has higher TPD quotas at 50% price, suitable for delay-insensitive scenarios.'),
      default: 'default',
      options: [
        { value: 'default', label: sharedOptionText('onlineMode') },
        { value: 'flex', label: sharedOptionText('offlineMode') }
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
      condition: (images: string[], allParams: DynamicValueMap) => {
        const imageCount = images?.length || 0
        const currentRatio = allParams.ppioSeedance15ProAspectRatio
        return imageCount > 0 && currentRatio !== 'adaptive'
      },
      value: 'adaptive'
    },

    // AutoSwitch 2: Delete all images → reset to default
    {
      trigger: 'uploadedImages',
      effect: 'autoSwitch',
      target: 'ppioSeedance15ProAspectRatio',
      condition: (images: string[], allParams: DynamicValueMap) => {
        const imageCount = images?.length || 0
        const currentRatio = allParams.ppioSeedance15ProAspectRatio
        return imageCount === 0 && currentRatio === 'adaptive'
      },
      value: 'adaptive'
    },

    // FilterOptions: Add smart option when images are uploaded
    {
      trigger: 'uploadedImages',
      effect: 'filterOptions',
      target: 'ppioSeedance15ProAspectRatio',
      filter: (images: string[], options: DynamicValue[]) => {
        const imageCount = images?.length || 0
        if (imageCount > 0) {
          // Add smart option at the beginning
          return [
            { value: 'adaptive', label: sharedOptionText('adaptive') },
            ...options
          ]
        }
        return options
      }
    }
  ],
  endpoints: {
    selector: async (params) => {
      const images = resolvePpioImageSources(params)

      return images.length > 0 ? '/async/seedance-v1.5-pro-i2v' : '/async/seedance-v1.5-pro-t2v'
    }
  },
  request: {
    builder: (params) => {
      const images = resolvePpioImageSources(params)
      const resolution = params.ppioSeedance15ProResolution || params.resolution || '720p'
      const duration = params.ppioSeedance15ProDuration || params.duration || 5
      const cameraFixed = params.ppioSeedance15ProCameraFixed || params.camera_fixed || false
      const serviceTier = params.ppioSeedance15ProServiceTier || params.service_tier || 'default'
      const generateAudio = params.ppioSeedance15ProGenerateAudio !== undefined ? params.ppioSeedance15ProGenerateAudio : (params.generate_audio !== undefined ? params.generate_audio : true)
      const ratio = params.ppioSeedance15ProAspectRatio || params.ratio || 'adaptive'

      const requestData: DynamicValue = {
        prompt: params.prompt,
        resolution,
        ratio,
        duration,
        camera_fixed: cameraFixed,
        service_tier: serviceTier,
        generate_audio: generateAudio,
        fps: 24,
        seed: -1,
        watermark: false
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
