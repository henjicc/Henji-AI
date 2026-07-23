/**
 * Seedance V1 视频生成模型
 */

import { defineModel, sharedFieldText } from '@/core'
import { resolvePpioImageSources } from './mediaSources'

export const seedanceV1Model = defineModel({
  meta: {
    id: 'ppio-seedance-v1',
    canonicalModelId: 'seedance-v1',
    seriesId: 'seedance',
    seriesRank: 1.0,
    provider: 'ppio',
    type: 'video',
        i18nScope: 'models.defs.ppio-seedance-v1',
    name: { key: 'meta.name', fallback: 'Seedance V1' },
    tags: ['video', 'text-to-video', 'image-to-video']
  },
  inputLimits: {
    images: { max: 2 },
    videos: { max: 0 }
  },
  params: [
    // 1. 版本
    {
      id: 'ppioSeedanceV1Variant',
      type: 'dropdown',
      order: 1,
      name: sharedFieldText('variant'),
      default: 'lite',
      options: [
        { value: 'lite', label: 'Lite' },
        { value: 'pro', label: 'Pro' }
      ],
      apiField: 'variant'
    },
    // 2. 时长
    {
      id: 'ppioSeedanceV1VideoDuration',
      type: 'dropdown',
      order: 2,
      name: sharedFieldText('duration'),
      default: 5,
      options: [
        { value: 5, label: '5s' },
        { value: 10, label: '10s' }
      ],
      apiField: 'duration'
    },
    // 3. 宽高比
    {
      id: 'ppioSeedanceV1AspectRatio',
      type: 'dropdown',
      order: 3,
      name: sharedFieldText('aspectRatio'),
      default: '16:9',
      options: [
        { value: 'smart', label: '智能' },
        { value: '21:9', label: '21:9' },
        { value: '16:9', label: '16:9' },
        { value: '4:3', label: '4:3' },
        { value: '1:1', label: '1:1' },
        { value: '3:4', label: '3:4' },
        { value: '9:16', label: '9:16' },
        { value: '9:21', label: '9:21' }
      ],
      apiField: 'aspect_ratio'
    },
    // 4. 分辨率
    {
      id: 'ppioSeedanceV1Resolution',
      type: 'dropdown',
      order: 4,
      name: sharedFieldText('resolution'),
      default: '720p',
      options: [
        { value: '480p', label: '480P' },
        { value: '720p', label: '720P' },
        { value: '1080p', label: '1080P' }
      ],
      apiField: 'resolution'
    },
    // 5. 相机固定
    {
      id: 'ppioSeedanceV1CameraFixed',
      type: 'switch',
      order: 5,
      name: sharedFieldText('cameraFixed'),
      default: false,
      apiField: 'camera_fixed'
    }
  ],
  linkages: [
    // Auto-switch to smart when images uploaded
    {
      trigger: 'uploadedImages',
      effect: 'autoSwitch',
      target: 'ppioSeedanceV1AspectRatio',
      condition: (images, allParams) => {
        const imageCount = images?.length || 0
        const currentRatio = allParams.ppioSeedanceV1AspectRatio
        return imageCount > 0 && currentRatio !== 'smart'
      },
      value: 'smart'
    }
  ],
  endpoints: {
    selector: async (params) => {
      const images = resolvePpioImageSources(params)
      const variant = params.ppioSeedanceV1Variant || params.variant || 'lite'

      if (images.length > 0) {
        return `/async/seedance-v1-${variant}-i2v`
      } else {
        return `/async/seedance-v1-${variant}-t2v`
      }
    }
  },
  request: {
    builder: (params) => {
      const images = resolvePpioImageSources(params)
      const resolution = params.ppioSeedanceV1Resolution || params.resolution || '720p'
      const aspect = params.ppioSeedanceV1AspectRatio || params.aspect_ratio || '16:9'
      const duration = params.ppioSeedanceV1VideoDuration || params.duration || 5
      const camera_fixed = params.ppioSeedanceV1CameraFixed || params.camera_fixed || false
      const prompt = params.prompt || ''

      const requestData: DynamicValue = {
        prompt,
        resolution,
        duration,
        camera_fixed,
        seed: -1
      }

      if (aspect && aspect !== 'smart') {
        requestData.aspect_ratio = aspect
      }

      if (images.length > 0) {
        requestData.image = images[0]
        if (images.length > 1) {
          requestData.last_image = images[1]
        }
      }

      return requestData
    }
  },
  pricing: {
    currency: '¥',
    calculator: (params) => {
      const duration = params.ppioSeedanceV1VideoDuration || 5
      const variant = params.ppioSeedanceV1Variant || 'lite'
      const basePrice = variant === 'pro' ? 0.5 : 0.3
      const durationMultiplier = duration / 5
      return basePrice * durationMultiplier
    },
    description: '基础价格 Lite ¥0.3/5秒，Pro ¥0.5/5秒'
  }
})

export default seedanceV1Model;
