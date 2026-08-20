/** APIMart Seedream 5.0 Pro 图片生成与编辑模型 */

import { defineModel, sharedFieldText, sharedOptionText } from '@/core'

const APIMART_IMAGE_ENDPOINT = '/v1/images/generations'
const ASPECT_RATIOS = ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'] as const

export const apimartSeedream50ProModel = defineModel({
  meta: {
    id: 'apimart-seedream-5.0-pro', canonicalModelId: 'seedream-5.0-pro', seriesId: 'seedream', seriesRank: 5.1,
    provider: 'apimart', type: 'image', i18nScope: 'models.defs.apimart-seedream-5.0-pro',
    name: { key: 'meta.name', fallback: 'Seedream 5.0 Pro' },
    tags: ['text-to-image', 'image-to-image', 'supports-image-editing', 'supports-multi-image', 'max-images-10', 'provider-apimart'],
    aliases: ['seedream-5-pro-apimart'], polling: { interval: 3000, maxAttempts: 200, expectedAttempts: 40 }
  },
  inputLimits: { images: { max: 10 }, videos: { max: 0 } },
  params: [
    {
      id: 'apimartSeedream50ProAspectRatio', type: 'dropdown', order: 1,
      name: sharedFieldText('aspectRatio'), default: 'smart',
      options: [{ value: 'smart', label: sharedOptionText('smart') }, ...ASPECT_RATIOS.map((ratio) => ({ value: ratio, label: ratio }))]
    },
    {
      id: 'apimartSeedream50ProResolution', type: 'dropdown', order: 2,
      name: sharedFieldText('resolution'), default: '1.5K',
      options: ['1K', '1.5K', '2K'].map((value) => ({ value, label: value }))
    },
    {
      id: 'apimartSeedream50ProBackground', type: 'dropdown', order: 3,
      name: { zh: '背景', en: 'Background' }, default: 'opaque',
      options: [
        { value: 'opaque', label: { zh: '不透明', en: 'Opaque' } },
        { value: 'transparent', label: { zh: '透明', en: 'Transparent' } }
      ]
    }
  ],
  linkages: [], endpoints: APIMART_IMAGE_ENDPOINT,
  request: {
    builder: (params) => {
      const filterSources = (value: DynamicValue): string[] => Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : []
      const uploaded = filterSources(params.uploadedFilePaths)
      const images = uploaded.length > 0 ? uploaded : filterSources(params.images)
      const supported = ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9']
      const raw = String(params.apimartSeedream50ProAspectRatio || 'smart')
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
      const resolution = ['1K', '2K'].includes(String(params.apimartSeedream50ProResolution))
        ? String(params.apimartSeedream50ProResolution) : '1.5K'
      const body: DynamicValueMap = {
        model: 'seedream-5-0-pro', prompt: typeof params.prompt === 'string' ? params.prompt : '',
        size, resolution,
        background: params.apimartSeedream50ProBackground === 'transparent' ? 'transparent' : 'opaque'
      }
      if (images.length > 0) body.image_urls = images.slice(0, 10)
      return body
    }
  },
  pricing: {
    currency: '$',
    calculator: (params) => params.apimartSeedream50ProResolution === '2K'
      ? 0.05856 : (params.apimartSeedream50ProResolution === '1K' ? 0.02928 : 0.036),
    description: '1K $0.02928/张，1.5K 默认 $0.036/张，2K $0.05856/张'
  }
})

export default apimartSeedream50ProModel
