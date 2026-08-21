/** APIMart Nano Banana 2 图片生成与编辑模型 */

import { defineModel, sharedFieldText, sharedOptionText } from '@/core'

const APIMART_IMAGE_ENDPOINT = '/v1/images/generations'
const ASPECT_RATIOS = ['1:1', '2:3', '3:2', '1:4', '4:1', '3:4', '4:3', '4:5', '5:4', '1:8', '8:1', '9:16', '16:9', '21:9'] as const

export const apimartNanoBanana2Model = defineModel({
  meta: {
    id: 'apimart-nano-banana-2', canonicalModelId: 'nano-banana-2', seriesId: 'nano-banana', seriesRank: 3,
    provider: 'apimart', type: 'image', i18nScope: 'models.defs.apimart-nano-banana-2',
    name: { key: 'meta.name', fallback: 'Nano Banana 2' },
    tags: ['text-to-image', 'image-to-image', 'supports-image-editing', 'supports-multi-image', 'max-images-14', 'supports-4k', 'provider-apimart'],
    aliases: ['nano-banana-2-apimart'],
    polling: { interval: 3000, maxAttempts: 200, expectedAttempts: 40 }
  },
  inputLimits: { images: { max: 14 }, videos: { max: 0 } },
  params: [
    {
      id: 'apimartNanoBanana2AspectRatio', type: 'dropdown', order: 1,
      name: sharedFieldText('aspectRatio'), default: 'smart',
      options: [{ value: 'smart', label: sharedOptionText('smart') }, ...ASPECT_RATIOS.map((ratio) => ({ value: ratio, label: ratio }))]
    },
    {
      id: 'apimartNanoBanana2Resolution', type: 'dropdown', order: 2,
      name: sharedFieldText('resolution'), default: '1K',
      options: ['0.5K', '1K', '2K', '4K'].map((value) => ({ value, label: value }))
    },
    {
      id: 'apimartNanoBanana2GoogleSearch', type: 'switch', order: 3,
      name: { zh: 'Google 搜索', en: 'Google Search' }, default: false
    },
    {
      id: 'apimartNanoBanana2GoogleImageSearch', type: 'switch', order: 4,
      name: { zh: 'Google 图片搜索', en: 'Google Image Search' }, default: false
    }
  ],
  linkages: [
    {
      trigger: 'apimartNanoBanana2GoogleImageSearch',
      effect: 'autoSwitch',
      target: 'apimartNanoBanana2GoogleSearch',
      condition: (enabled: boolean, allParams: DynamicValueMap) => enabled === true && allParams.apimartNanoBanana2GoogleSearch !== true,
      value: true,
      noRestore: true
    }
  ],
  endpoints: APIMART_IMAGE_ENDPOINT,
  request: {
    builder: (params) => {
      const filterSources = (value: DynamicValue): string[] => Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : []
      const uploaded = filterSources(params.uploadedFilePaths)
      const images = uploaded.length > 0 ? uploaded : filterSources(params.images)
      const supported = ['1:1', '2:3', '3:2', '1:4', '4:1', '3:4', '4:3', '4:5', '5:4', '1:8', '8:1', '9:16', '16:9', '21:9']
      const raw = String(params.apimartNanoBanana2AspectRatio || 'smart')
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
      const resolution = ['0.5K', '2K', '4K'].includes(String(params.apimartNanoBanana2Resolution))
        ? String(params.apimartNanoBanana2Resolution) : '1K'
      const googleImageSearch = params.apimartNanoBanana2GoogleImageSearch === true
      const body: DynamicValueMap = {
        model: 'gemini-3.1-flash-image-preview',
        prompt: typeof params.prompt === 'string' ? params.prompt : '',
        size,
        resolution,
        google_search: params.apimartNanoBanana2GoogleSearch === true || googleImageSearch,
        google_image_search: googleImageSearch
      }
      if (images.length > 0) body.image_urls = images.slice(0, 14)
      return body
    }
  },
  pricing: {
    currency: '$',
    calculator: (params) => params.apimartNanoBanana2Resolution === '4K'
      ? 0.025 : (params.apimartNanoBanana2Resolution === '2K' ? 0.02 : 0.015),
    description: '0.5K/1K $0.015/张，2K $0.02/张，4K $0.025/张'
  }
})

export default apimartNanoBanana2Model
