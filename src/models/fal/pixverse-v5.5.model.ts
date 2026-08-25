/**
 * PixVerse V5.5 视频生成模型
 */

import { defineModel, sharedFieldText, sharedOptionText } from '@/core'

export const pixverseV55Model = defineModel({
  meta: {
    id: 'fal-ai-pixverse-v5.5',
    canonicalModelId: 'pixverse-v5.5',
    seriesId: 'pixverse',
    seriesRank: 5.5,
    provider: 'fal',
    type: 'video',
        i18nScope: 'models.defs.fal-ai-pixverse-v5.5',
    name: { key: 'meta.name', fallback: 'PixVerse V5.5' },
    tags: ['video', 'text-to-video', 'image-to-video', 'start-end-frame']
  },
  inputLimits: {
    images: { max: 2 },
    videos: { max: 0 }
  },
  params: [
    {
      id: 'pixverseAspectRatio',
      order: 1,
      type: 'dropdown',
      name: sharedFieldText('aspectRatio'),
      default: '16:9',
      options: [
        { value: 'smart', label: sharedOptionText('smart') },
        { value: '16:9', label: '16:9' },
        { value: '4:3', label: '4:3' },
        { value: '1:1', label: '1:1' },
        { value: '3:4', label: '3:4' },
        { value: '9:16', label: '9:16' }
      ]
    },
    {
      id: 'pixverseResolution',
      order: 2,
      type: 'dropdown',
      name: sharedFieldText('resolution'),
      default: '720p',
      options: [
        { value: '720p', label: '720p' },
        { value: '1080p', label: '1080p' }
      ]
    },
    {
      id: 'falPixverse55VideoDuration',
      order: 3,
      type: 'dropdown',
      name: sharedFieldText('duration'),
      default: 5,
      options: [
        { value: 5, label: '5s' },
        { value: 10, label: '10s' }
      ]
    },
    {
      id: 'pixverseStyle',
      order: 4,
      type: 'dropdown',
      name: sharedFieldText('style'),
      default: 'none',
      options: [
        { value: 'none', label: sharedOptionText('default') },
        { value: 'realistic', label: sharedOptionText('realistic') },
        { value: 'anime', label: sharedOptionText('anime') }
      ]
    },
    {
      id: 'pixverseThinkingType',
      order: 5,
      type: 'dropdown',
      name: sharedFieldText('thinkingType'),
      default: 'normal',
      options: [
        { value: 'normal', label: sharedOptionText('normal') },
        { value: 'enhanced', label: sharedOptionText('enhanced') }
      ]
    },
    {
      id: 'pixverseGenerateAudio',
      order: 6,
      type: 'switch',
      name: sharedFieldText('generateAudio'),
      default: true
    },
    {
      id: 'pixverseMultiClip',
      order: 7,
      type: 'switch',
      name: sharedFieldText('multiClip'),
      default: false
    }
  ],
  linkages: [
    // 官方文档明确 10 秒档不提供 1080p
    {
      trigger: 'falPixverse55VideoDuration',
      effect: 'filterOptions',
      target: 'pixverseResolution',
      filter: (duration, options) => (duration === 10 ? options.filter((opt) => opt.value !== '1080p') : options)
    },
    {
      trigger: 'falPixverse55VideoDuration',
      effect: 'autoSwitch',
      target: 'pixverseResolution',
      condition: (duration, allParams) => duration === 10 && allParams.pixverseResolution === '1080p',
      value: '720p'
    }
  ],
  endpoints: {
    selector: async (params) => {
      const filterSources = (value: DynamicValue): string[] =>
        Array.isArray(value)
          ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
          : []
      const uploaded = filterSources(params.uploadedFilePaths)
      const images = uploaded.length > 0 ? uploaded : filterSources(params.images)
      if (images.length === 0) {
        return 'fal-ai/pixverse/v5.5/text-to-video'
      }
      if (images.length === 1) {
        return 'fal-ai/pixverse/v5.5/image-to-video'
      }
      return 'fal-ai/pixverse/v5.5/transition'
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
      const aspectRatio = params.pixverseAspectRatio
      const resolution = params.pixverseResolution
      const duration = params.falPixverse55VideoDuration || 5

      const requestData: DynamicValue = { prompt }

      if (aspectRatio && aspectRatio !== 'smart' && aspectRatio !== 'auto') {
        requestData.aspect_ratio = aspectRatio
      }

      if (resolution) {
        requestData.resolution = resolution
      }

      requestData.duration = String(duration)

      if (params.pixverseStyle && params.pixverseStyle !== 'none') {
        requestData.style = params.pixverseStyle
      }

      if (params.pixverseThinkingType) {
        requestData.thinking_type = params.pixverseThinkingType
      }

      requestData.generate_audio_switch = params.pixverseGenerateAudio !== false

      if (params.pixverseMultiClip !== undefined) {
        requestData.generate_multi_clip_switch = params.pixverseMultiClip
      }

      if (images.length === 1) {
        requestData.image_url = images[0]
      } else if (images.length >= 2) {
        requestData.first_image_url = images[0]
        requestData.end_image_url = images[1]
      }

      return requestData
    }
  },
  pricing: {
    currency: '$',
    calculator: (params) => {
      const isTransition = (() => {
        const uploaded = Array.isArray(params.uploadedFilePaths)
          ? params.uploadedFilePaths.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
          : []
        const images = uploaded.length > 0
          ? uploaded
          : (Array.isArray(params.images)
            ? params.images.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
            : [])
        return images.length >= 2
      })()
      const resolution = params.pixverseResolution === '1080p' ? '1080p' : '720p'
      const base = isTransition
        ? (resolution === '1080p' ? 1.2 : 0.6)
        : (resolution === '1080p' ? 0.4 : 0.2)
      const audio = params.pixverseGenerateAudio !== false
      const multiClip = params.pixverseMultiClip === true
      const surcharge = multiClip
        ? (isTransition ? (audio ? 0.4 : 0.3) : (audio ? 0.15 : 0.1))
        : (audio ? (isTransition ? 0.1 : 0.05) : 0)
      const duration = Number(params.falPixverse55VideoDuration) || 5
      const durationMultiplier = duration === 10 ? 2.2 : (duration === 8 ? 2 : 1)
      return (base + surcharge) * durationMultiplier
    },
    description: '单clip无音频 5s：720p $0.20、1080p $0.40；转场（双图）5s：720p $0.60、1080p $1.20；音频 +$0.05（转场 +$0.10）；多clip +$0.10/$0.15（转场 +$0.30/$0.40）；8s 双倍，10s 2.2倍且不支持 1080p'
  }
})

export default pixverseV55Model;
