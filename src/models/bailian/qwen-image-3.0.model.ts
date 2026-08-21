/** 阿里云百炼官方 Qwen Image 3.0 图片生成与编辑模型 */

import { defineModel, sharedFieldText, sharedOptionText } from '@/core'

const ASPECT_RATIOS = ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'] as const

export const bailianQwenImage30Model = defineModel({
  meta: {
    id: 'bailian-qwen-image-3.0', canonicalModelId: 'qwen-image-3.0', seriesId: 'qwen-image', seriesRank: 3,
    provider: 'bailian', type: 'image', i18nScope: 'models.defs.bailian-qwen-image-3.0',
    name: { key: 'meta.name', fallback: 'Qwen Image 3.0' },
    tags: ['text-to-image', 'image-to-image', 'supports-image-editing', 'supports-multi-image', 'max-images-3', 'multi-output', 'provider-bailian'],
    aliases: ['qwen-image-3-official']
  },
  inputLimits: { images: { max: 3 }, videos: { max: 0 } },
  params: [
    {
      id: 'bailianQwenImage30Variant', type: 'dropdown', order: 1,
      name: sharedFieldText('variant'), default: 'standard',
      options: [
        { value: 'standard', label: { zh: '标准版', en: 'Standard' } },
        { value: 'pro', label: 'Pro' }
      ]
    },
    {
      id: 'bailianQwenImage30AspectRatio', type: 'dropdown', order: 2,
      name: sharedFieldText('aspectRatio'), default: 'smart',
      options: [{ value: 'smart', label: sharedOptionText('smart') }, ...ASPECT_RATIOS.map((ratio) => ({ value: ratio, label: ratio }))]
    },
    {
      id: 'bailianQwenImage30Resolution', type: 'dropdown', order: 3,
      name: sharedFieldText('resolution'), default: '1K',
      options: ['1K', '2K'].map((value) => ({ value, label: value }))
    },
    {
      id: 'bailianQwenImage30Count', type: 'number', order: 4,
      name: { zh: '生成数量', en: 'Output Count' }, default: 1, min: 1, max: 6, step: 1
    }
  ],
  linkages: [], endpoints: '/api/v1/services/aigc/multimodal-generation/generation',
  request: {
    builder: (params) => {
      const filterSources = (value: DynamicValue): string[] => Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : []
      const uploaded = filterSources(params.uploadedFilePaths)
      const images = (uploaded.length > 0 ? uploaded : filterSources(params.images)).slice(0, 3)
      const ratios = ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3']
      const raw = String(params.bailianQwenImage30AspectRatio || 'smart')
      const hint = typeof params.__firstImageRatio === 'number' && Number.isFinite(params.__firstImageRatio) && params.__firstImageRatio > 0 ? params.__firstImageRatio : 1
      let aspectRatio = ratios.includes(raw) ? raw : '1:1'
      if (raw === 'smart' || raw === 'auto') {
        let difference = Number.POSITIVE_INFINITY
        for (const candidate of ratios) {
          const pair = candidate.split(':').map(Number)
          const next = Math.abs(pair[0] / pair[1] - hint)
          if (next < difference) { difference = next; aspectRatio = candidate }
        }
      }
      const pair = aspectRatio.split(':').map(Number)
      const ratio = pair[0] / pair[1]
      const base = params.bailianQwenImage30Resolution === '2K' ? 2048 : 1024
      const width = Math.max(384, Math.round(Math.sqrt(base * base * ratio) / 8) * 8)
      const height = Math.max(384, Math.round(Math.sqrt(base * base / ratio) / 8) * 8)
      const count = Math.min(6, Math.max(1, Math.round(Number(params.bailianQwenImage30Count || 1))))
      const content: DynamicValue[] = images.map((image) => ({ image }))
      content.push({ text: typeof params.prompt === 'string' ? params.prompt : '' })
      return {
        model: params.bailianQwenImage30Variant === 'pro' ? 'qwen-image-3.0-pro' : 'qwen-image-3.0',
        input: { messages: [{ role: 'user', content }] },
        parameters: {
          prompt_extend: true, prompt_extend_mode: 'direct', enable_thinking: false,
          n: count, size: `${width}*${height}`, watermark: false
        }
      }
    }
  },
  pricing: {
    currency: '¥',
    calculator: (params) => {
      const count = Math.min(6, Math.max(1, Math.round(Number(params.bailianQwenImage30Count || 1))))
      const images = Array.isArray(params.uploadedFilePaths) ? params.uploadedFilePaths.length : (Array.isArray(params.images) ? params.images.length : 0)
      const outputPrice = params.bailianQwenImage30Variant === 'pro'
        ? (params.bailianQwenImage30Resolution === '2K' ? 0.5 : 0.25)
        : 0.18
      return count * outputPrice + Math.min(3, images) * 0.02
    },
    description: '标准版 1K/2K 输出 ¥0.18/张；Pro 1K ¥0.25、2K ¥0.50/张；输入图 ¥0.02/张'
  }
})

export default bailianQwenImage30Model
