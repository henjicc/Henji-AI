/** APIMart Nano Banana Pro 图片生成与编辑模型 */

import { defineModel, sharedFieldText, sharedOptionText } from '@/core'

const APIMART_IMAGE_ENDPOINT = '/v1/images/generations'
const ASPECT_RATIOS = ['21:9', '16:9', '3:2', '4:3', '5:4', '1:1', '4:5', '3:4', '2:3', '9:16'] as const

export const apimartNanoBananaProModel = defineModel({
  meta: {
    id: 'apimart-nano-banana-pro', canonicalModelId: 'nano-banana-pro', seriesId: 'nano-banana', seriesRank: 2,
    provider: 'apimart', type: 'image', i18nScope: 'models.defs.apimart-nano-banana-pro',
    name: { key: 'meta.name', fallback: 'Nano Banana Pro' },
    tags: ['text-to-image', 'image-to-image', 'supports-image-editing', 'supports-multi-image', 'max-images-14', 'supports-4k', 'provider-apimart'],
    aliases: ['nano-banana-pro-apimart'],
    polling: { interval: 3000, maxAttempts: 200, expectedAttempts: 40 }
  },
  inputLimits: { images: { max: 14 }, videos: { max: 0 } },
  params: [
    {
      id: 'apimartNanoBananaProAspectRatio', type: 'dropdown', order: 1,
      name: sharedFieldText('aspectRatio'), default: 'smart',
      options: [{ value: 'smart', label: sharedOptionText('smart') }, ...ASPECT_RATIOS.map((ratio) => ({ value: ratio, label: ratio }))]
    },
    {
      id: 'apimartNanoBananaProResolution', type: 'dropdown', order: 2,
      name: sharedFieldText('resolution'), default: '1K',
      options: ['1K', '2K', '4K'].map((value) => ({ value, label: value }))
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
      const supported = ['21:9', '16:9', '3:2', '4:3', '5:4', '1:1', '4:5', '3:4', '2:3', '9:16']
      const raw = String(params.apimartNanoBananaProAspectRatio || 'smart')
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
      const resolution = ['2K', '4K'].includes(String(params.apimartNanoBananaProResolution))
        ? String(params.apimartNanoBananaProResolution) : '1K'
      const body: DynamicValueMap = {
        model: 'gemini-3-pro-image-preview',
        prompt: typeof params.prompt === 'string' ? params.prompt : '',
        size,
        resolution
      }
      if (images.length > 0) body.image_urls = images.slice(0, 14)
      return body
    }
  },
  pricing: {
    currency: '$', calculator: (params) => params.apimartNanoBananaProResolution === '4K' ? 0.04 : 0.03,
    description: '默认/1K/2K $0.03/张，4K $0.04/张'
  }
})

export default apimartNanoBananaProModel
