/** APIMart Gemini Omni Flash 官方与 Ext 渠道统一模型 */

import { defineModel, sharedFieldText, sharedOptionText } from '@/core'

export const apimartGeminiOmniFlashModel = defineModel({
  meta: {
    id: 'apimart-gemini-omni-flash', canonicalModelId: 'gemini-omni-video',
    seriesId: 'gemini-omni', seriesRank: 1, provider: 'apimart', type: 'video',
    i18nScope: 'models.defs.apimart-gemini-omni-flash',
    name: { key: 'meta.name', fallback: 'Gemini Omni Flash' },
    tags: [
      'text-to-video', 'image-to-video', 'video-to-video', 'supports-video-editing',
      'supports-multi-image', 'mixed-upload-mode', 'supports-4k', 'provider-apimart'
    ],
    aliases: [
      'gemini-omni-flash-apimart',
      'apimart-gemini-omni-flash-ext',
      'omni-flash-ext',
      'gemini-omni-flash-ext-apimart'
    ],
    aliasParamDefaults: {
      'apimart-gemini-omni-flash-ext': { apimartGeminiOmniFlashChannel: 'ext' },
      'omni-flash-ext': { apimartGeminiOmniFlashChannel: 'ext' },
      'gemini-omni-flash-ext-apimart': { apimartGeminiOmniFlashChannel: 'ext' }
    },
    aliasParamMappings: {
      'apimart-gemini-omni-flash': {
        apimartGeminiOmniFlashDuration: 'apimartGeminiOmniFlashOfficialDuration'
      },
      'apimart-gemini-omni-flash-ext': {
        apimartGeminiOmniFlashExtGenerationType: 'apimartGeminiOmniFlashGenerationType',
        apimartGeminiOmniFlashExtAspectRatio: 'apimartGeminiOmniFlashAspectRatio',
        apimartGeminiOmniFlashExtResolution: 'apimartGeminiOmniFlashResolution'
      }
    },
    polling: { interval: 5000, maxAttempts: 180, expectedAttempts: 60 }
  },
  inputLimits: {
    images: { max: 16 }, videos: { max: 1 },
    rules: [{
      when: 'apimartGeminiOmniFlashChannel === "ext"',
      images: { max: 3 }
    }]
  },
  requirements: [{
    id: 'apimart-gemini-omni-ext-prompt',
    when: 'apimartGeminiOmniFlashChannel === "ext"',
    require: { prompt: true },
    message: { title: '提示词必需', message: '普通渠道需要填写提示词。', type: 'warning' }
  }],
  params: [
    {
      id: 'apimartGeminiOmniFlashChannel', type: 'dropdown', order: 1,
      name: sharedFieldText('apiChannel'), default: 'official',
      options: [
        { value: 'official', label: sharedOptionText('official') },
        { value: 'ext', label: sharedOptionText('regular') }
      ]
    },
    {
      id: 'apimartGeminiOmniFlashAspectRatio', type: 'dropdown', order: 2,
      name: sharedFieldText('aspectRatio'), default: '16:9',
      options: [{ value: '16:9', label: '16:9' }, { value: '9:16', label: '9:16' }]
    },
    {
      id: 'apimartGeminiOmniFlashResolution', type: 'dropdown', order: 3,
      name: sharedFieldText('resolution'), default: '720p',
      options: [
        { value: '720p', label: '720p' },
        { value: '1080p', label: '1080p' },
        { value: '4k', label: '4K' }
      ]
    },
    {
      id: 'apimartGeminiOmniFlashOfficialDuration', type: 'number', order: 4,
      name: sharedFieldText('duration'), default: 5, min: 3, max: 10, step: 1,
      visible: { condition: (params) => params.apimartGeminiOmniFlashChannel !== 'ext' }
    },
    {
      id: 'apimartGeminiOmniFlashExtDuration', type: 'dropdown', order: 4,
      name: sharedFieldText('duration'), default: '6',
      visible: { condition: (params) => params.apimartGeminiOmniFlashChannel === 'ext' },
      options: ['4', '6', '8', '10'].map((value) => ({ value, label: `${value}s` }))
    },
    {
      id: 'apimartGeminiOmniFlashGenerationType', type: 'dropdown', order: 5,
      name: { zh: '图片生成方式', en: 'Image Generation Type' }, default: 'reference',
      visible: { condition: (params) => params.apimartGeminiOmniFlashChannel === 'ext' },
      options: [
        { value: 'reference', label: { zh: '参考融合', en: 'Reference' } },
        { value: 'frame', label: { zh: '首帧动画', en: 'First Frame' } }
      ]
    },
    {
      id: 'apimartGeminiOmniFlashExtendTaskId', type: 'text', order: 5,
      name: { zh: '延续任务 ID', en: 'Extend From Task ID' }, default: '',
      visible: { condition: (params) => params.apimartGeminiOmniFlashChannel !== 'ext' }
    }
  ],
  linkages: [{
    trigger: 'apimartGeminiOmniFlashChannel',
    effect: 'filterOptions',
    target: 'apimartGeminiOmniFlashResolution',
    filter: (channel, options) => channel === 'ext'
      ? options
      : options.filter((option) => option.value === '720p')
  }, {
    trigger: 'apimartGeminiOmniFlashChannel',
    effect: 'autoSwitch',
    target: 'apimartGeminiOmniFlashResolution',
    condition: (channel, allParams) => channel !== 'ext' && allParams.apimartGeminiOmniFlashResolution !== '720p',
    value: '720p'
  }],
  endpoints: '/v1/videos/generations',
  request: {
    builder: (params) => {
      const clean = (value: DynamicValue): string[] => Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : []
      const uploadedImages = clean(params.uploadedFilePaths)
      const images = uploadedImages.length > 0 ? uploadedImages : clean(params.images)
      const uploadedVideos = clean(params.uploadedVideoFilePaths)
      const videos = uploadedVideos.length > 0 ? uploadedVideos : clean(params.videos)
      const prompt = typeof params.prompt === 'string' ? params.prompt.trim() : ''
      const aspectRatio = params.apimartGeminiOmniFlashAspectRatio === '9:16' ? '9:16' : '16:9'
      const channel = params.apimartGeminiOmniFlashChannel === 'ext' ? 'ext' : 'official'

      if (channel === 'ext') {
        if (!prompt) throw new Error('Gemini Omni Flash 普通渠道的提示词不能为空')
        if (images.length === 2 || images.length > 3) {
          throw new Error('Gemini Omni Flash 普通渠道只支持 0、1 或 3 张图片')
        }
        const generationType = params.apimartGeminiOmniFlashGenerationType === 'frame' ? 'frame' : 'reference'
        if (generationType === 'frame' && images.length > 1) {
          throw new Error('Gemini Omni Flash 普通渠道的首帧模式只能传入 1 张图片')
        }
        const resolution = params.apimartGeminiOmniFlashResolution === '1080p'
          || params.apimartGeminiOmniFlashResolution === '4k'
          ? params.apimartGeminiOmniFlashResolution
          : '720p'
        const duration = ['4', '6', '8', '10'].includes(String(params.apimartGeminiOmniFlashExtDuration))
          ? Number(params.apimartGeminiOmniFlashExtDuration)
          : 6
        const body: DynamicValueMap = {
          model: 'Omni-Flash-Ext', prompt, resolution, aspect_ratio: aspectRatio, nsfw_check: false
        }
        if (videos.length === 0) body.duration = duration
        if (images.length > 0) {
          body.generation_type = generationType
          body.image_urls = images
        }
        if (videos.length > 0) body.video_urls = videos.slice(0, 1)
        return body
      }

      const extendTaskId = typeof params.apimartGeminiOmniFlashExtendTaskId === 'string'
        ? params.apimartGeminiOmniFlashExtendTaskId.trim()
        : ''
      if (videos.length > 0 && extendTaskId) {
        throw new Error('Gemini Omni Flash 官方渠道不能同时传入参考视频和延续任务 ID')
      }
      if (!prompt && images.length + videos.length === 0 && !extendTaskId) {
        throw new Error('Gemini Omni Flash 官方渠道至少需要提示词或一份参考素材')
      }
      const body: DynamicValueMap = {
        model: 'gemini-omni-flash-preview',
        prompt,
        duration: Math.min(10, Math.max(3, Math.round(Number(params.apimartGeminiOmniFlashOfficialDuration || 5)))),
        aspect_ratio: aspectRatio,
        resolution: '720p'
      }
      if (images.length > 0) body.image_urls = images.slice(0, 16)
      if (videos.length > 0) body.video_urls = videos.slice(0, 1)
      if (extendTaskId) body.extend_from_task_id = extendTaskId
      return body
    }
  },
  pricing: {
    currency: '$',
    calculator: (params) => {
      if (params.apimartGeminiOmniFlashChannel !== 'ext') {
        return Math.min(10, Math.max(3, Math.round(Number(params.apimartGeminiOmniFlashOfficialDuration || 5)))) * 0.088
      }
      const resolution = params.apimartGeminiOmniFlashResolution === '4k' ? '4k' : 'standard'
      const hasVideo = (Array.isArray(params.uploadedVideoFilePaths) && params.uploadedVideoFilePaths.length > 0)
        || (Array.isArray(params.videos) && params.videos.length > 0)
      if (hasVideo) return resolution === '4k' ? 0.24 : 0.08
      const duration = ['4', '6', '8', '10'].includes(String(params.apimartGeminiOmniFlashExtDuration))
        ? String(params.apimartGeminiOmniFlashExtDuration)
        : '6'
      const standard: Record<string, number> = { '4': 0.25, '6': 0.3, '8': 0.35, '10': 0.4 }
      const high4k: Record<string, number> = { '4': 0.75, '6': 0.8, '8': 0.85, '10': 0.9 }
      return (resolution === '4k' ? high4k : standard)[duration]
    },
    description: '官方渠道 720p $0.088/秒；普通渠道按分辨率、时长或参考视频档位计费'
  }
})

export default apimartGeminiOmniFlashModel
