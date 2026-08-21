/** APIMart Qwen Image 3.0 图片生成与编辑模型 */

import { defineModel, sharedFieldText, sharedOptionText } from '@/core'

const APIMART_IMAGE_ENDPOINT = '/v1/images/generations'
const ASPECT_RATIOS = ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'] as const

export const apimartQwenImage30Model = defineModel({
  meta: {
    id: 'apimart-qwen-image-3.0', canonicalModelId: 'qwen-image-3.0', seriesId: 'qwen-image', seriesRank: 3,
    provider: 'apimart', type: 'image', i18nScope: 'models.defs.apimart-qwen-image-3.0',
    name: { key: 'meta.name', fallback: 'Qwen Image 3.0' },
    tags: ['text-to-image', 'image-to-image', 'supports-image-editing', 'supports-multi-image', 'max-images-3', 'multi-output', 'provider-apimart'],
    aliases: ['qwen-image-3-apimart'],
    polling: { interval: 3000, maxAttempts: 200, expectedAttempts: 40 }
  },
  inputLimits: { images: { max: 3 }, videos: { max: 0 } },
  params: [
    {
      id: 'apimartQwenImage30Variant', type: 'dropdown', order: 1,
      name: sharedFieldText('variant'), default: 'standard',
      options: [
        { value: 'standard', label: { zh: '标准版', en: 'Standard' } },
        { value: 'pro', label: 'Pro' }
      ]
    },
    {
      id: 'apimartQwenImage30AspectRatio', type: 'dropdown', order: 2,
      name: sharedFieldText('aspectRatio'), default: 'smart',
      options: [{ value: 'smart', label: sharedOptionText('smart') }, ...ASPECT_RATIOS.map((ratio) => ({ value: ratio, label: ratio }))]
    },
    {
      id: 'apimartQwenImage30Resolution', type: 'dropdown', order: 3,
      name: sharedFieldText('resolution'), default: '1K',
      options: ['1K', '2K'].map((value) => ({ value, label: value }))
    },
    {
      id: 'apimartQwenImage30Count', type: 'number', order: 4,
      name: { zh: '生成数量', en: 'Output Count' }, default: 1, min: 1, max: 6, step: 1
    },
    {
      id: 'apimartQwenImage30PromptExtend', type: 'switch', order: 5,
      name: sharedFieldText('promptExpansion'), default: false
    }
  ],
  linkages: [],
  endpoints: APIMART_IMAGE_ENDPOINT,
  request: {
    builder: (params) => {
      const filterSources = (value: DynamicValue): string[] => Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : []
      const uploaded = filterSources(params.uploadedFilePaths)
      const images = uploaded.length > 0 ? uploaded : filterSources(params.images)
      const supported = ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3']
      const raw = String(params.apimartQwenImage30AspectRatio || 'smart')
      const hint = typeof params.__firstImageRatio === 'number' && Number.isFinite(params.__firstImageRatio) && params.__firstImageRatio > 0 ? params.__firstImageRatio : 1
      let size = supported.includes(raw) ? raw : '1:1'
      if (raw === 'smart' || raw === 'auto') {
        let difference = Number.POSITIVE_INFINITY
        for (const candidate of supported) {
          const pair = candidate.split(':').map(Number)
          const next = Math.abs(pair[0] / pair[1] - hint)
          if (next < difference) { difference = next; size = candidate }
        }
      }
      const count = Math.min(6, Math.max(1, Math.round(Number(params.apimartQwenImage30Count || 1))))
      const body: DynamicValueMap = {
        model: params.apimartQwenImage30Variant === 'pro' ? 'qwen-image-3.0-pro' : 'qwen-image-3.0',
        prompt: typeof params.prompt === 'string' ? params.prompt : '',
        size,
        resolution: params.apimartQwenImage30Resolution === '2K' ? '2K' : '1K',
        n: count,
        prompt_extend: params.apimartQwenImage30PromptExtend === true
      }
      if (body.prompt_extend === true) body.prompt_extend_mode = 'direct'
      if (images.length > 0) body.image_urls = images.slice(0, 3)
      return body
    }
  },
  pricing: {
    currency: '$',
    calculator: (params) => {
      const count = Math.min(6, Math.max(1, Math.round(Number(params.apimartQwenImage30Count || 1))))
      if (params.apimartQwenImage30Variant === 'pro') {
        return count * (params.apimartQwenImage30Resolution === '2K' ? 0.0571432 : 0.0285712)
      }
      return count * 0.0205712
    },
    description: '标准版 1K/2K $0.0205712/张；Pro 1K $0.0285712、2K $0.0571432/张'
  }
})

export default apimartQwenImage30Model
