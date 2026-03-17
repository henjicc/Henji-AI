/**
 * KIE Seedance V3 视频生成模型
 */

import { defineModel, sharedFieldText, sharedOptionText } from '@/core'

const KIE_CREATE_TASK_ENDPOINT = '/api/v1/jobs/createTask'

export const kieSeedanceV3Model = defineModel({
  meta: {
    id: 'kie-seedance-v3',
    provider: 'kie',
    type: 'video',
        i18nScope: 'models.defs.kie-seedance-v3',
    name: { key: 'meta.name', fallback: 'Seedance V3' },
    description: { key: 'meta.description', fallback: 'KIE Seedance V3 video generation model' },
    tags: ['text-to-video', 'image-to-video', 'provider-kie'],
    aliases: ['seedance-v3-kie'],
    polling: {
      interval: 3000,
      maxAttempts: 150,
      expectedAttempts: 50
    }
  },
  inputLimits: {
    images: { max: 1 },
    videos: { max: 0 }
  },
  params: [
    {
      id: 'kieSeedanceV3Version',
      type: 'dropdown',
      order: 1,
      name: sharedFieldText('version'),
      default: 'lite',
      options: [
        { value: 'lite', label: 'Lite' },
        { value: 'pro', label: 'Pro' }
      ]
    },
    {
      id: 'kieSeedanceV3AspectRatio',
      type: 'dropdown',
      order: 2,
      name: sharedFieldText('aspectRatio'),
      default: '16:9',
      options: [
        { value: '16:9', label: '16:9' },
        { value: '4:3', label: '4:3' },
        { value: '1:1', label: '1:1' },
        { value: '3:4', label: '3:4' },
        { value: '9:16', label: '9:16' },
        { value: '21:9', label: '21:9' },
        { value: '9:21', label: '9:21' },
        { value: 'smart', label: sharedOptionText('smart') }
      ]
    },
    {
      id: 'kieSeedanceV3Resolution',
      type: 'dropdown',
      order: 3,
      name: sharedFieldText('resolution'),
      default: '720p',
      options: [
        { value: '480p', label: '480p' },
        { value: '720p', label: '720p' },
        { value: '1080p', label: '1080p' }
      ]
    },
    {
      id: 'kieSeedanceV3Duration',
      type: 'dropdown',
      order: 4,
      name: sharedFieldText('duration'),
      default: '5',
      options: [
        { value: '5', label: '5s' },
        { value: '10', label: '10s' }
      ]
    },
    {
      id: 'kieSeedanceV3CameraFixed',
      type: 'switch',
      order: 5,
      name: sharedFieldText('cameraFixed'),
      default: false
    },
    {
      id: 'kieSeedanceV3FastMode',
      type: 'switch',
      order: 6,
      name: sharedFieldText('fastMode'),
      default: true
    }
  ],
  linkages: [],
  endpoints: KIE_CREATE_TASK_ENDPOINT,
  request: {
    builder: (params) => {
      const images = params.images || []
      const prompt = params.prompt || ''
      const version = params.kieSeedanceV3Version || params.version || 'lite'
      const fastMode = params.kieSeedanceV3FastMode !== undefined
        ? params.kieSeedanceV3FastMode
        : (params.fast_mode !== undefined ? params.fast_mode : true)
      const aspectRatio = params.kieSeedanceV3AspectRatio || params.aspect_ratio || '16:9'
      let resolution = params.kieSeedanceV3Resolution || params.resolution || '720p'
      const duration = params.kieSeedanceV3Duration || params.duration || '5'
      const cameraFixed = params.kieSeedanceV3CameraFixed !== undefined
        ? params.kieSeedanceV3CameraFixed
        : (params.camera_fixed !== undefined ? params.camera_fixed : false)

      const validResolutions = ['480p', '720p', '1080p']
      if (!validResolutions.includes(resolution)) {
        resolution = '720p'
      }

      if (version === 'pro' && fastMode && images.length > 0 && resolution === '480p') {
        resolution = '720p'
      }

      let model: string
      if (images.length === 0) {
        model = version === 'pro'
          ? 'bytedance/v1-pro-text-to-video'
          : 'bytedance/v1-lite-text-to-video'
      } else {
        if (version === 'pro') {
          model = fastMode
            ? 'bytedance/v1-pro-fast-image-to-video'
            : 'bytedance/v1-pro-image-to-video'
        } else {
          model = 'bytedance/v1-lite-image-to-video'
        }
      }

      const input: Record<string, unknown> = { prompt }

      if (images.length === 0 && aspectRatio && aspectRatio !== 'smart') {
        input.aspect_ratio = aspectRatio
      }

      input.resolution = resolution
      input.duration = String(duration)

      if (!(version === 'pro' && fastMode && images.length > 0)) {
        input.camera_fixed = cameraFixed
      }

      if (images.length > 0) {
        input.image_url = images[0]
      }

      input.enable_safety_checker = false

      return {
        model,
        input
      }
    }
  },
  pricing: {
    currency: '¥',
    calculator: () => 0.12,
    description: '基础价格 ¥0.12/次'
  }
})

export default kieSeedanceV3Model
