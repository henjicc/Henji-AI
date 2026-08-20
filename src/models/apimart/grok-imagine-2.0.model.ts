/** APIMart Grok Imagine 2.0 文生图模型 */

import { defineModel, sharedFieldText, sharedOptionText } from '@/core'

const APIMART_IMAGE_ENDPOINT = '/v1/images/generations'
const ASPECT_RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9'] as const

export const apimartGrokImagine20Model = defineModel({
  meta: {
    id: 'apimart-grok-imagine-2.0', canonicalModelId: 'grok-imagine-image-2.0', seriesId: 'grok-imagine-image', seriesRank: 2,
    provider: 'apimart', type: 'image', i18nScope: 'models.defs.apimart-grok-imagine-2.0',
    name: { key: 'meta.name', fallback: 'Grok Imagine Image 2.0' },
    tags: ['text-to-image', 'multi-output', 'provider-apimart'], aliases: ['grok-imagine-2-apimart'],
    polling: { interval: 3000, maxAttempts: 200, expectedAttempts: 40 }
  },
  inputLimits: { images: { max: 0 }, videos: { max: 0 } },
  params: [
    {
      id: 'apimartGrokImagine20AspectRatio', type: 'dropdown', order: 1,
      name: sharedFieldText('aspectRatio'), default: 'smart',
      options: [{ value: 'smart', label: sharedOptionText('smart') }, ...ASPECT_RATIOS.map((ratio) => ({ value: ratio, label: ratio }))]
    },
    {
      id: 'apimartGrokImagine20Resolution', type: 'dropdown', order: 2,
      name: sharedFieldText('resolution'), default: 'quality',
      options: [{ value: 'quality', label: { zh: '高质量', en: 'Quality' } }]
    },
    {
      id: 'apimartGrokImagine20Count', type: 'number', order: 3,
      name: { zh: '生成数量', en: 'Output Count' }, default: 1, min: 1, max: 12, step: 1
    }
  ],
  linkages: [], endpoints: APIMART_IMAGE_ENDPOINT,
  request: {
    builder: (params) => {
      const supported = ['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9']
      const raw = String(params.apimartGrokImagine20AspectRatio || 'smart')
      const size = supported.includes(raw) ? raw : '1:1'
      const count = Math.min(12, Math.max(1, Math.round(Number(params.apimartGrokImagine20Count || 1))))
      return {
        model: 'grok-imagine-2.0-ext',
        prompt: typeof params.prompt === 'string' ? params.prompt : '',
        n: count,
        size,
        resolution: 'quality'
      }
    }
  },
  pricing: {
    currency: '$',
    calculator: (params) => Math.min(12, Math.max(1, Math.round(Number(params.apimartGrokImagine20Count || 1)))) * 0.015,
    description: '当前实时价格 $0.015/张'
  }
})

export default apimartGrokImagine20Model
