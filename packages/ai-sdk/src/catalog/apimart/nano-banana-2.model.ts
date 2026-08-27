/** APIMart Nano Banana 2 图片生成与编辑模型（运行时契约） */

import { defineModel } from '../defineModel'
import type { JsonValue, JsonObject } from '../../types/runtime'

const APIMART_IMAGE_ENDPOINT = '/v1/images/generations'
const ASPECT_RATIOS = ['1:1', '2:3', '3:2', '1:4', '4:1', '3:4', '4:3', '4:5', '5:4', '1:8', '8:1', '9:16', '16:9', '21:9'] as const

export const apimartNanoBanana2Model = defineModel({
  meta: {
    id: 'apimart-nano-banana-2', canonicalModelId: 'nano-banana-2', seriesId: 'nano-banana', seriesRank: 3,
    provider: 'apimart', type: 'image',
    tags: ['text-to-image', 'image-to-image', 'supports-image-editing', 'supports-multi-image', 'max-images-14', 'supports-4k', 'provider-apimart'],
    aliases: ['nano-banana-2-apimart'],
    polling: { interval: 3000, maxAttempts: 200, expectedAttempts: 40 }
  },
  inputLimits: { images: { max: 14 }, videos: { max: 0 } },
  params: [
    {
      id: 'apimartNanoBanana2Channel', type: 'dropdown', order: 1,
      default: 'standard',
      options: [{ value: 'standard' }, { value: 'official' }]
    },
    {
      id: 'apimartNanoBanana2AspectRatio', type: 'dropdown', order: 2,
      default: 'smart',
      options: [{ value: 'smart' }, ...ASPECT_RATIOS.map((ratio) => ({ value: ratio }))]
    },
    {
      id: 'apimartNanoBanana2Resolution', type: 'dropdown', order: 3,
      default: '1K',
      options: ['0.5K', '1K', '2K', '4K'].map((value) => ({ value }))
    },
    {
      id: 'apimartNanoBanana2GoogleSearch', type: 'switch', order: 4,
      default: false
    },
    {
      id: 'apimartNanoBanana2GoogleImageSearch', type: 'switch', order: 5,
      default: false
    }
  ],
  endpoints: APIMART_IMAGE_ENDPOINT,
  request: {
    builder: (params) => {
      const filterSources = (value: JsonValue): string[] => Array.isArray(value)
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
      const body: JsonObject = {
        model: params.apimartNanoBanana2Channel === 'official'
          ? 'gemini-3.1-flash-image-preview-official'
          : 'gemini-3.1-flash-image-preview',
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
    calculator: (params) => {
      if (params.apimartNanoBanana2Channel === 'official') {
        return params.apimartNanoBanana2Resolution === '4K'
          ? 0.1208 : (params.apimartNanoBanana2Resolution === '2K' ? 0.0808 : 0.0536)
      }
      return params.apimartNanoBanana2Resolution === '4K'
        ? 0.025 : (params.apimartNanoBanana2Resolution === '2K' ? 0.02 : 0.015)
    },
    description: '常规渠道：0.5K/1K $0.015、2K $0.02、4K $0.025/张；官方渠道按 token 结算，估算 0.5K/1K $0.0536、2K $0.0808、4K $0.1208/张'
  }
})

export default apimartNanoBanana2Model
