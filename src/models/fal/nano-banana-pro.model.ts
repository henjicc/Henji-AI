/** Fal Nano Banana Pro 图片生成与编辑模型 */

import { defineModel, sharedFieldText, sharedOptionText } from '@/core'

const NANO_BANANA_PRO_RATIOS = ['21:9', '16:9', '3:2', '4:3', '5:4', '1:1', '4:5', '3:4', '2:3', '9:16'] as const

export const nanoBananaProModel = defineModel({
  meta: {
    id: 'fal-ai-nano-banana-pro', canonicalModelId: 'nano-banana-pro', seriesId: 'nano-banana', seriesRank: 3,
    provider: 'fal', type: 'image', i18nScope: 'models.defs.fal-ai-nano-banana-pro',
    name: { key: 'meta.name', fallback: 'Nano Banana Pro' },
    tags: ['text-to-image', 'image-to-image', 'supports-image-editing', 'supports-multi-image', 'supports-4k', 'provider-fal'],
    aliases: ['nano-banana-pro-fal'], polling: { interval: 3000, maxAttempts: 200, expectedAttempts: 40 }
  },
  inputLimits: { images: { max: 14 }, videos: { max: 0 } },
  params: [
    {
      id: 'falNanoBananaProAspectRatio', type: 'dropdown', order: 1,
      name: sharedFieldText('aspectRatio'), default: 'smart',
      options: [{ value: 'smart', label: sharedOptionText('smart') }, ...NANO_BANANA_PRO_RATIOS.map((value) => ({ value, label: value }))]
    },
    {
      id: 'falNanoBananaProResolution', type: 'dropdown', order: 2,
      name: sharedFieldText('resolution'), default: '1K',
      options: ['1K', '2K', '4K'].map((value) => ({ value, label: value }))
    },
    {
      id: 'falNanoBananaProNumImages', type: 'number', order: 3,
      name: sharedFieldText('numberOfImages'), default: 1, min: 1, max: 4, step: 1
    },
    {
      id: 'falNanoBananaProWebSearch', type: 'switch', order: 4,
      name: { zh: '联网搜索', en: 'Web Search' }, default: false
    }
  ],
  linkages: [],
  endpoints: {
    selector: async (params) => {
      const uploaded = Array.isArray(params.uploadedFilePaths) ? params.uploadedFilePaths : []
      const images = uploaded.length > 0 ? uploaded : (Array.isArray(params.images) ? params.images : [])
      return images.length > 0 ? 'fal-ai/nano-banana-pro/edit' : 'fal-ai/nano-banana-pro'
    }
  },
  request: {
    builder: (params) => {
      const clean = (value: DynamicValue): string[] => Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : []
      const uploaded = clean(params.uploadedFilePaths)
      const images = uploaded.length > 0 ? uploaded : clean(params.images)
      const ratios = ['21:9', '16:9', '3:2', '4:3', '5:4', '1:1', '4:5', '3:4', '2:3', '9:16']
      const raw = String(params.falNanoBananaProAspectRatio || 'smart')
      const hint = typeof params.__firstImageRatio === 'number' && Number.isFinite(params.__firstImageRatio) && params.__firstImageRatio > 0 ? params.__firstImageRatio : 1
      let ratio = ratios.includes(raw) ? raw : '1:1'
      if (raw === 'smart' || raw === 'auto') {
        let difference = Number.POSITIVE_INFINITY
        for (const candidate of ratios) {
          const pair = candidate.split(':').map(Number)
          const next = Math.abs(pair[0] / pair[1] - hint)
          if (next < difference) { difference = next; ratio = candidate }
        }
      }
      const body: DynamicValueMap = {
        prompt: typeof params.prompt === 'string' ? params.prompt : '',
        aspect_ratio: images.length > 0 && raw === 'smart' ? 'auto' : ratio,
        resolution: ['2K', '4K'].includes(String(params.falNanoBananaProResolution)) ? String(params.falNanoBananaProResolution) : '1K',
        num_images: Math.min(4, Math.max(1, Math.round(Number(params.falNanoBananaProNumImages || 1)))),
        limit_generations: true,
        enable_web_search: params.falNanoBananaProWebSearch === true
      }
      if (images.length > 0) body.image_urls = images.slice(0, 14)
      return body
    }
  },
  pricing: {
    currency: '$',
    calculator: (params) => {
      const count = Math.min(4, Math.max(1, Math.round(Number(params.falNanoBananaProNumImages || 1))))
      const multiplier = params.falNanoBananaProResolution === '4K' ? 2 : 1
      return count * 0.15 * multiplier + (params.falNanoBananaProWebSearch === true ? 0.015 : 0)
    },
    description: '1K/2K $0.15/张，4K $0.30/张；联网搜索 +$0.015'
  }
})

export default nanoBananaProModel
