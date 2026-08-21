/**
 * KIE Qwen Image 3.0 图片生成与编辑模型
 */

import { defineModel, sharedFieldText, sharedOptionText } from '@/core'
import { countUploadedImages } from './mediaSources'

const KIE_CREATE_TASK_ENDPOINT = '/api/v1/jobs/createTask'

const SUPPORTED_ASPECT_RATIOS = [
  '1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '21:9'
] as const

export const kieQwenImage30Model = defineModel({
  meta: {
    id: 'kie-qwen-image-3.0',
    canonicalModelId: 'qwen-image-3.0',
    seriesId: 'qwen-image',
    seriesRank: 3,
    provider: 'kie',
    type: 'image',
    i18nScope: 'models.defs.kie-qwen-image-3.0',
    name: { key: 'meta.name', fallback: 'Qwen Image 3.0' },
    tags: [
      'text-to-image',
      'image-to-image',
      'supports-image-editing',
      'supports-multi-image',
      'max-images-3',
      'supports-prompt-expansion',
      'provider-kie'
    ],
    aliases: ['qwen-image-3-kie']
  },
  inputLimits: {
    images: { max: 3 },
    videos: { max: 0 }
  },
  params: [
    {
      id: 'kieQwenImage30Variant',
      type: 'dropdown',
      order: 1,
      name: sharedFieldText('variant'),
      default: 'standard',
      options: [
        { value: 'standard', label: { zh: '标准版', en: 'Standard' } },
        { value: 'pro', label: 'Pro' }
      ]
    },
    {
      id: 'kieQwenImage30AspectRatio',
      type: 'dropdown',
      order: 2,
      name: sharedFieldText('aspectRatio'),
      default: 'smart',
      options: [
        { value: 'smart', label: sharedOptionText('smart') },
        ...SUPPORTED_ASPECT_RATIOS.map((ratio) => ({ value: ratio, label: ratio }))
      ]
    },
    {
      id: 'kieQwenImage30Resolution',
      type: 'dropdown',
      order: 3,
      name: sharedFieldText('resolution'),
      default: '1K',
      options: [
        { value: '1K', label: '1K' },
        { value: '2K', label: '2K' }
      ]
    },
    {
      id: 'kieQwenImage30PromptExtend',
      type: 'switch',
      order: 4,
      name: { zh: '提示词扩写', en: 'Prompt Expansion' },
      default: true
    }
  ],
  linkages: [],
  endpoints: KIE_CREATE_TASK_ENDPOINT,
  request: {
    builder: (params) => {
      const filterSources = (value: DynamicValue): string[] => Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : []
      const uploadedImages = filterSources(params.uploadedFilePaths)
      const images = uploadedImages.length > 0 ? uploadedImages : filterSources(params.images)
      const supportedAspectRatios = ['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '21:9']
      const rawAspectRatio = String(params.kieQwenImage30AspectRatio || 'smart')
      const ratioHint = typeof params.__firstImageRatio === 'number' && Number.isFinite(params.__firstImageRatio) && params.__firstImageRatio > 0
        ? params.__firstImageRatio
        : 1
      let aspectRatio = supportedAspectRatios.includes(rawAspectRatio) ? rawAspectRatio : '1:1'
      if (rawAspectRatio === 'smart' || rawAspectRatio === 'auto') {
        let bestDiff = Number.POSITIVE_INFINITY
        for (const candidate of supportedAspectRatios) {
          const pair = candidate.split(':').map(Number)
          const difference = Math.abs(pair[0] / pair[1] - ratioHint)
          if (difference < bestDiff) {
            bestDiff = difference
            aspectRatio = candidate
          }
        }
      }

      const input: DynamicValueMap = {
        prompt: typeof params.prompt === 'string' ? params.prompt : '',
        image_size: aspectRatio,
        resolution: params.kieQwenImage30Resolution === '2K' ? '2K' : '1K',
        prompt_extend: params.kieQwenImage30PromptExtend !== false
      }
      if (images.length > 0) {
        input.image_urls = images.slice(0, 3)
      }

      const isPro = params.kieQwenImage30Variant === 'pro'
      return {
        model: isPro
          ? (images.length > 0 ? 'qwen3/pro-image-to-image' : 'qwen3-pro/text-to-image')
          : (images.length > 0 ? 'qwen3/image-to-image' : 'qwen3/text-to-image'),
        input
      }
    }
  },
  pricing: {
    currency: '$',
    calculator: (params) => {
      const output = params.kieQwenImage30Variant === 'pro'
        ? (params.kieQwenImage30Resolution === '2K' ? 0.06 : 0.032)
        : 0.024
      return output + countUploadedImages(params) * 0.0025
    },
    description: '标准版 1K/2K $0.024/张；Pro 1K $0.032、2K $0.06/张；图片编辑输入 $0.0025/张'
  }
})

export default kieQwenImage30Model
