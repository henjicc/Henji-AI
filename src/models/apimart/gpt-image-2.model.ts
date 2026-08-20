/** APIMart GPT Image 2 图片生成与编辑模型 */

import { defineModel, sharedFieldText, sharedOptionText } from '@/core'

const APIMART_IMAGE_ENDPOINT = '/v1/images/generations'
const ASPECT_RATIOS = [
  '1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '16:9', '9:16',
  '2:1', '1:2', '3:1', '1:3', '21:9', '9:21'
] as const

export const apimartGptImage2Model = defineModel({
  meta: {
    id: 'apimart-gpt-image-2',
    canonicalModelId: 'gpt-image-2',
    seriesId: 'gpt-image',
    seriesRank: 2,
    provider: 'apimart',
    type: 'image',
    i18nScope: 'models.defs.apimart-gpt-image-2',
    name: { key: 'meta.name', fallback: 'GPT Image 2' },
    tags: ['text-to-image', 'image-to-image', 'supports-image-editing', 'supports-multi-image', 'max-images-16', 'supports-4k', 'provider-apimart'],
    aliases: ['gpt-image-2-apimart'],
    polling: { interval: 3000, maxAttempts: 200, expectedAttempts: 40 }
  },
  inputLimits: { images: { max: 16 }, videos: { max: 0 } },
  params: [
    {
      id: 'apimartGptImage2AspectRatio', type: 'dropdown', order: 1,
      name: sharedFieldText('aspectRatio'), default: 'smart',
      options: [
        { value: 'smart', label: sharedOptionText('smart') },
        ...ASPECT_RATIOS.map((ratio) => ({ value: ratio, label: ratio }))
      ]
    },
    {
      id: 'apimartGptImage2Resolution', type: 'dropdown', order: 2,
      name: sharedFieldText('resolution'), default: '1K',
      options: ['1K', '2K', '4K'].map((value) => ({ value, label: value }))
    }
  ],
  linkages: [],
  endpoints: APIMART_IMAGE_ENDPOINT,
  request: {
    builder: (params) => {
      const filterSources = (value: DynamicValue): string[] => Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : []
      const uploaded = filterSources(params.uploadedFilePaths)
      const images = uploaded.length > 0 ? uploaded : filterSources(params.images)
      const supported = ['1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '16:9', '9:16', '2:1', '1:2', '3:1', '1:3', '21:9', '9:21']
      const raw = String(params.apimartGptImage2AspectRatio || 'smart')
      const hint = typeof params.__firstImageRatio === 'number' && Number.isFinite(params.__firstImageRatio) && params.__firstImageRatio > 0
        ? params.__firstImageRatio : 1
      let size = supported.includes(raw) ? raw : '1:1'
      if (raw === 'smart' || raw === 'auto') {
        let difference = Number.POSITIVE_INFINITY
        for (const candidate of supported) {
          const pair = candidate.split(':').map(Number)
          const next = Math.abs(pair[0] / pair[1] - hint)
          if (next < difference) { difference = next; size = candidate }
        }
      }
      const resolution = ['2K', '4K'].includes(String(params.apimartGptImage2Resolution))
        ? String(params.apimartGptImage2Resolution).toLowerCase() : '1k'
      const body: DynamicValueMap = {
        model: 'gpt-image-2',
        prompt: typeof params.prompt === 'string' ? params.prompt.slice(0, 20000) : '',
        n: 1,
        size,
        resolution
      }
      if (images.length > 0) body.image_urls = images.slice(0, 16)
      return body
    }
  },
  pricing: {
    currency: '$',
    calculator: (params) => params.apimartGptImage2Resolution === '4K'
      ? 0.021 : (params.apimartGptImage2Resolution === '2K' ? 0.014 : 0.0085),
    description: '1K $0.0085/张，2K $0.014/张，4K $0.021/张'
  }
})

export default apimartGptImage2Model
