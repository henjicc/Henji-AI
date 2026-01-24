/**
 * Seedance 视频生成模型
 */

import { defineModel } from '@/core'

export const seedanceModel = defineModel({
  meta: {
    id: 'fal-ai-bytedance-seedance-v1',
    provider: 'fal',
    type: 'video',
    name: 'Seedance',
    description: 'Bytedance Seedance 视频生成模型',
    tags: ['video', 'text-to-video', 'image-to-video'],
    aliases: ['fal-ai-bytedance-seedance', 'bytedance-seedance-v1']
  },
  inputLimits: {
    images: { max: 0 },
    videos: { max: 0 },
    rules: [
      {
        when: 'falSeedanceV1Mode === "image-to-video"',
        images: { max: 2 }
      },
      {
        when: 'falSeedanceV1Mode === "reference-to-video"',
        images: { max: 12 }
      },
      {
        when: 'falSeedanceV1Mode === "image-to-video" && falSeedanceV1Version === "pro" && falSeedanceV1FastMode === true',
        images: { max: 1 }
      }
    ]
  },
  requirements: [
    {
      id: 'seedance-image-to-video',
      when: 'falSeedanceV1Mode === "image-to-video"',
      require: { images: { min: 1 } },
      message: {
        title: '图片必需',
        message: '图生视频模式需要上传至少1张图片',
        type: 'warning'
      }
    },
    {
      id: 'seedance-reference-to-video',
      when: 'falSeedanceV1Mode === "reference-to-video"',
      require: { images: { min: 1 } },
      message: {
        title: '图片必需',
        message: '参考生视频模式需要上传图片才能生成',
        type: 'warning'
      }
    }
  ],
  params: [
    {
      id: 'falSeedanceV1Mode',
      order: 1,
      type: 'dropdown',
      name: { zh: '模式', en: 'Mode' },
      default: 'text-to-video',
      options: [
        { value: 'text-to-video', label: { zh: '文生视频', en: 'Text to Video' } },
        { value: 'image-to-video', label: { zh: '图生视频', en: 'Image to Video' } },
        { value: 'reference-to-video', label: { zh: '参考生视频', en: 'Reference to Video' } }
      ]
    },
    {
      id: 'falSeedanceV1Version',
      order: 2,
      type: 'dropdown',
      name: { zh: '版本', en: 'Version' },
      default: 'lite',
      options: [
        { value: 'lite', label: 'Lite' },
        { value: 'pro', label: 'Pro' }
      ]
    },
    {
      id: 'falSeedanceV1AspectRatio',
      order: 3,
      type: 'dropdown',
      name: { zh: '宽高比', en: 'Aspect Ratio' },
      default: '16:9',
      options: [
        { value: 'smart', label: { zh: '智能', en: 'Smart' } },
        { value: 'auto', label: { zh: '自动', en: 'Auto' } },
        { value: '21:9', label: '21:9' },
        { value: '16:9', label: '16:9' },
        { value: '4:3', label: '4:3' },
        { value: '1:1', label: '1:1' },
        { value: '3:4', label: '3:4' },
        { value: '9:16', label: '9:16' },
        { value: '9:21', label: '9:21' }
      ]
    },
    {
      id: 'falSeedanceV1Resolution',
      order: 4,
      type: 'dropdown',
      name: { zh: '分辨率', en: 'Resolution' },
      default: '720p',
      options: [
        { value: '480p', label: '480p' },
        { value: '720p', label: '720p' },
        { value: '1080p', label: '1080p' }
      ]
    },
    {
      id: 'falSeedanceV1VideoDuration',
      order: 5,
      type: 'dropdown',
      name: { zh: '时长', en: 'Duration' },
      default: 5,
      options: [
        { value: 2, label: '2s' },
        { value: 3, label: '3s' },
        { value: 4, label: '4s' },
        { value: 5, label: '5s' },
        { value: 6, label: '6s' },
        { value: 7, label: '7s' },
        { value: 8, label: '8s' },
        { value: 9, label: '9s' },
        { value: 10, label: '10s' },
        { value: 11, label: '11s' },
        { value: 12, label: '12s' }
      ]
    },
    {
      id: 'falSeedanceV1CameraFixed',
      order: 6,
      type: 'switch',
      name: { zh: '固定相机', en: 'Camera Fixed' },
      default: false
    },
    {
      id: 'falSeedanceV1FastMode',
      order: 7,
      type: 'switch',
      name: { zh: '快速模式', en: 'Fast Mode' },
      default: true
    }
  ],
  linkages: [],
  endpoints: {
    selector: async (params) => {
      const mode = params.falSeedanceV1Mode || 'text-to-video'
      const version = params.falSeedanceV1Version || 'lite'
      const fastMode = params.falSeedanceV1FastMode === true
      const versionPath = version === 'pro' ? 'pro' : 'lite'
      const fastPath = fastMode && version === 'pro' && mode !== 'reference-to-video' ? '/fast' : ''

      if (mode === 'reference-to-video') {
        return 'fal-ai/bytedance/seedance/v1/lite/reference-to-video'
      }

      if (mode === 'image-to-video') {
        return `fal-ai/bytedance/seedance/v1/${versionPath}${fastPath}/image-to-video`
      }

      return `fal-ai/bytedance/seedance/v1/${versionPath}${fastPath}/text-to-video`
    }
  },
  request: {
    builder: (params) => {
      const images = params.images || []
      const prompt = params.prompt || ''
      const mode = params.falSeedanceV1Mode || 'text-to-video'
      const duration = params.falSeedanceV1VideoDuration || 5
      const resolution = params.falSeedanceV1Resolution || '720p'
      const cameraFixed = params.falSeedanceV1CameraFixed || false
      const aspectRatio = params.falSeedanceV1AspectRatio

      const requestData: any = {
        prompt,
        duration: `${duration}`,
        enable_safety_checker: false,
        resolution,
        camera_fixed: cameraFixed
      }

      if (aspectRatio && aspectRatio !== 'smart') {
        requestData.aspect_ratio = aspectRatio
      }

      if (mode === 'reference-to-video') {
        if (images.length > 0) {
          requestData.reference_image_urls = images
        }
      } else if (mode === 'image-to-video') {
        if (images.length > 0) {
          requestData.image_url = images[0]
          if (images.length > 1) {
            requestData.end_image_url = images[1]
          }
        }
      }

      return requestData
    }
  },
  pricing: {
    currency: '$',
    calculator: () => 0.1,
    description: '基础价格 $0.1/次'
  }
})

export default seedanceModel;
