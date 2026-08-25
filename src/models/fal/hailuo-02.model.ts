/**
 * Hailuo 02 视频生成模型
 */

import { defineModel, sharedFieldText } from '@/core'
import { hasUploadedImage } from '@/models/shared/mediaPresence'

export const hailuo02Model = defineModel({
  meta: {
    id: 'fal-ai-minimax-hailuo-02',
    canonicalModelId: 'hailuo-02',
    seriesId: 'hailuo',
    seriesRank: 2.0,
    provider: 'fal',
    type: 'video',
        i18nScope: 'models.defs.fal-ai-minimax-hailuo-02',
    name: { key: 'meta.name', fallback: 'MiniMax Hailuo 02' },
    tags: ['video', 'text-to-video', 'image-to-video', 'start-end-frame'],
    aliases: ['fal-ai-hailuo-02', 'minimax-hailuo-02-fal']
  },
  inputLimits: {
    images: { max: 2 },
    videos: { max: 0 },
    rules: [
      {
        when: 'falHailuo02FastMode === true',
        images: { max: 1 }
      }
    ]
  },
  params: [
    {
      id: 'falHailuo02Version',
      order: 1,
      type: 'dropdown',
      name: sharedFieldText('version'),
      default: 'standard',
      options: [
        { value: 'standard', label: 'Standard' },
        { value: 'pro', label: 'Pro' }
      ]
    },
    {
      id: 'falHailuo02Duration',
      order: 2,
      type: 'dropdown',
      name: sharedFieldText('duration'),
      default: '6',
      // Pro 端点的 schema 里没有 duration 字段，官方固定 6 秒（$0.48/条）。
      // 不隐藏的话用户选 10s 会看到 $0.80 预估，但请求不带该字段、实际仍按 6s 出账。
      visible: { condition: 'falHailuo02Version !== "pro"' },
      options: [
        { value: '6', label: '6s' },
        { value: '10', label: '10s' }
      ]
    },
    {
      id: 'falHailuo02Resolution',
      order: 3,
      type: 'dropdown',
      name: sharedFieldText('resolution'),
      default: '768P',
      // Pro 固定 1080P 且不接受 resolution 入参；Standard 官方只开放 512P/768P 两档
      visible: { condition: 'falHailuo02Version !== "pro"' },
      options: [
        { value: '512P', label: '512P' },
        { value: '768P', label: '768P' }
      ]
    },
    {
      id: 'falHailuo02FastMode',
      order: 4,
      type: 'switch',
      name: sharedFieldText('fastMode'),
      default: false
    },
    {
      id: 'falHailuo02PromptOptimizer',
      order: 5,
      type: 'switch',
      name: sharedFieldText('promptOptimizer'),
      default: true
    }
  ],
  linkages: [],
  endpoints: {
    selector: async (params) => {
      const filterSources = (value: DynamicValue): string[] =>
        Array.isArray(value)
          ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
          : []
      const uploaded = filterSources(params.uploadedFilePaths)
      const images = uploaded.length > 0 ? uploaded : filterSources(params.images)
      const imageCount = images.length
      const version = params.falHailuo02Version || 'standard'
      const fastMode = params.falHailuo02FastMode === true

      if (imageCount === 0) {
        return version === 'pro'
          ? 'fal-ai/minimax/hailuo-02/pro/text-to-video'
          : 'fal-ai/minimax/hailuo-02/standard/text-to-video'
      }

      if (imageCount === 1 && fastMode) {
        return 'fal-ai/minimax/hailuo-02-fast/image-to-video'
      }

      if (version === 'pro') {
        return 'fal-ai/minimax/hailuo-02/pro/image-to-video'
      }

      return 'fal-ai/minimax/hailuo-02/standard/image-to-video'
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
      const version = params.falHailuo02Version || 'standard'
      const resolution = params.falHailuo02Resolution || '768P'
      const duration = params.falHailuo02Duration || '6'
      const promptOptimizer = params.falHailuo02PromptOptimizer !== false

      const requestData: DynamicValue = { prompt }

      if (promptOptimizer !== undefined) {
        requestData.prompt_optimizer = promptOptimizer
      }

      if (version === 'standard') {
        requestData.duration = duration
      }

      if (version === 'standard' && images.length > 0 && params.falHailuo02FastMode !== true) {
        requestData.resolution = resolution
      }

      if (images.length >= 1) {
        requestData.image_url = images[0]
      }
      if (images.length >= 2) {
        requestData.end_image_url = images[1]
      }

      return requestData
    }
  },
  pricing: {
    currency: '$',
    calculator: (params) => {
      const duration = params.falHailuo02Duration === '10' ? 10 : 6
      const version = params.falHailuo02Version === 'pro' ? 'pro' : 'standard'
      const isFastMode = params.falHailuo02FastMode === true && hasUploadedImage(params)
      // Pro 不接受 duration 入参，官方固定 6 秒，计价不能读 UI 上的时长
      if (version === 'pro') return 0.08 * 6
      if (isFastMode) return 0.017 * duration
      const resolution = params.falHailuo02Resolution === '512P' ? '512P' : '768P'
      return (resolution === '512P' ? 0.017 : 0.045) * duration
    },
    description: 'Standard：768P $0.045/秒，512P $0.017/秒；Fast（图生视频）：512P $0.017/秒；Pro：固定 1080P、固定 6 秒，$0.08/秒（$0.48/条）'
  }
})

export default hailuo02Model;
