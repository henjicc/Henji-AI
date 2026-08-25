/**
 * Seedance 视频生成模型
 */

import { defineModel, sharedFieldText, sharedModeText, sharedOptionText } from '@/core'

export const seedanceModel = defineModel({
  meta: {
    id: 'fal-ai-bytedance-seedance-v1',
    canonicalModelId: 'seedance-v1',
    provider: 'fal',
    type: 'video',
        i18nScope: 'models.defs.fal-ai-bytedance-seedance-v1',
    name: { key: 'meta.name', fallback: 'Seedance' },
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
        when: 'falSeedanceV1Mode === "image-to-video" && falSeedanceV1FastMode === true',
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
    }
  ],
  params: [
    {
      id: 'falSeedanceV1Mode',
      order: 1,
      type: 'dropdown',
      name: sharedFieldText('mode'),
      default: 'text-to-video',
      // 官方已下线 Lite 档文生/图生视频（重定向到 Pro Fast）与参考生视频模式
      // （Lite 重定向到完全不同的 Grok Imagine Video，Pro 端点 404），只保留仍可用的两种模式
      options: [
        { value: 'text-to-video', label: sharedModeText('textToVideo') },
        { value: 'image-to-video', label: sharedModeText('imageToVideo') }
      ]
    },
    {
      id: 'falSeedanceV1AspectRatio',
      order: 3,
      type: 'dropdown',
      name: sharedFieldText('aspectRatio'),
      default: '16:9',
      options: [
        { value: 'smart', label: sharedOptionText('smart') },
        { value: 'auto', label: sharedOptionText('auto') },
        { value: '21:9', label: '21:9' },
        { value: '16:9', label: '16:9' },
        { value: '4:3', label: '4:3' },
        { value: '1:1', label: '1:1' },
        { value: '3:4', label: '3:4' },
        { value: '9:16', label: '9:16' }
      ]
    },
    {
      id: 'falSeedanceV1Resolution',
      order: 4,
      type: 'dropdown',
      name: sharedFieldText('resolution'),
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
      name: sharedFieldText('duration'),
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
      name: sharedFieldText('cameraFixed'),
      default: false
    },
    {
      id: 'falSeedanceV1FastMode',
      order: 7,
      type: 'switch',
      name: sharedFieldText('fastMode'),
      default: true
    }
  ],
  linkages: [],
  endpoints: {
    // 仅存的可用档位是 Pro（非 fast）与 Pro Fast；Lite 与参考生视频已由官方下线/重定向失效
    selector: async (params) => {
      const mode = params.falSeedanceV1Mode || 'text-to-video'
      const fastMode = params.falSeedanceV1FastMode === true
      const fastPath = fastMode ? '/fast' : ''

      if (mode === 'image-to-video') {
        return `fal-ai/bytedance/seedance/v1/pro${fastPath}/image-to-video`
      }

      return `fal-ai/bytedance/seedance/v1/pro${fastPath}/text-to-video`
    }
  },
  request: {
    builder: (params) => {
      const filterSources = (value: DynamicValue): string[] =>
        Array.isArray(value)
          ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
          : []
      const uploaded = filterSources(params.uploadedFilePaths)
      const images = uploaded.length > 0 ? uploaded : filterSources(params.images)
      const prompt = params.prompt || ''
      const mode = params.falSeedanceV1Mode || 'text-to-video'
      const duration = params.falSeedanceV1VideoDuration || 5
      const resolution = params.falSeedanceV1Resolution || '720p'
      const cameraFixed = params.falSeedanceV1CameraFixed || false
      const aspectRatio = params.falSeedanceV1AspectRatio

      const requestData: DynamicValue = {
        prompt,
        duration: `${duration}`,
        enable_safety_checker: false,
        resolution,
        camera_fixed: cameraFixed
      }

      if (aspectRatio && aspectRatio !== 'smart') {
        requestData.aspect_ratio = aspectRatio
      }

      if (mode === 'image-to-video' && images.length > 0) {
        requestData.image_url = images[0]
        if (images.length > 1) {
          requestData.end_image_url = images[1]
        }
      }

      return requestData
    }
  },
  pricing: {
    currency: '$',
    calculator: (params) => {
      // 官方按 token 计费：tokens = 宽 × 高 × fps × 秒数 / 1024；Pro $2.5/百万 token，Pro Fast $1/百万 token。
      // 分辨率对应的宽高按 16:9 近似（其余宽高比价格会有小幅偏差，仅供估算）。
      const dimensions: Record<string, [number, number]> = {
        '480p': [854, 480],
        '720p': [1280, 720],
        '1080p': [1920, 1080],
      }
      const [width, height] = dimensions[params.falSeedanceV1Resolution as string] ?? dimensions['720p']
      const duration = Number(params.falSeedanceV1VideoDuration) || 5
      const fps = 24
      const tokens = (width * height * fps * duration) / 1024
      const ratePerMillionTokens = params.falSeedanceV1FastMode === true ? 1 : 2.5
      return (tokens / 1_000_000) * ratePerMillionTokens
    },
    description: '按 token 计费（近似）：1080p 5秒约 Pro $0.62 / Pro Fast $0.245，其余分辨率按 宽×高×24fps×秒数/1024 换算，Pro $2.5/百万token，Pro Fast $1/百万token'
  }
})

export default seedanceModel;
