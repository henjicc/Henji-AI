/** APIMart Z-Image Turbo 文生图模型 */

import { defineModel, sharedFieldText, sharedOptionText } from '@/core'

const APIMART_IMAGE_ENDPOINT = '/v1/images/generations'
const ASPECT_RATIOS = ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'] as const

export const apimartZImageTurboModel = defineModel({
  meta: {
    id: 'apimart-z-image-turbo', canonicalModelId: 'z-image-turbo', seriesId: 'z-image', seriesRank: 1,
    provider: 'apimart', type: 'image', i18nScope: 'models.defs.apimart-z-image-turbo',
    name: { key: 'meta.name', fallback: 'Z-Image Turbo' },
    tags: ['text-to-image', 'supports-2k', 'provider-apimart'], aliases: ['z-image-turbo-apimart'],
    polling: { interval: 3000, maxAttempts: 200, expectedAttempts: 40 }
  },
  inputLimits: { images: { max: 0 }, videos: { max: 0 } },
  params: [
    {
      id: 'apimartZImageTurboAspectRatio', type: 'dropdown', order: 1,
      name: sharedFieldText('aspectRatio'), default: 'smart',
      options: [{ value: 'smart', label: sharedOptionText('smart') }, ...ASPECT_RATIOS.map((ratio) => ({ value: ratio, label: ratio }))]
    },
    {
      id: 'apimartZImageTurboResolution', type: 'dropdown', order: 2,
      name: sharedFieldText('resolution'), default: '1K',
      options: ['1K', '2K'].map((value) => ({ value, label: value }))
    },
    {
      id: 'apimartZImageTurboPromptExtend', type: 'switch', order: 3,
      name: { zh: '提示词改写', en: 'Prompt Rewrite' }, default: false
    }
  ],
  linkages: [], endpoints: APIMART_IMAGE_ENDPOINT,
  request: {
    builder: (params) => {
      const supported = ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3']
      const raw = String(params.apimartZImageTurboAspectRatio || 'smart')
      let size = supported.includes(raw) ? raw : '1:1'
      if (raw === 'smart' || raw === 'auto') size = '1:1'
      return {
        model: 'z-image-turbo',
        prompt: typeof params.prompt === 'string' ? params.prompt.slice(0, 800) : '',
        size,
        resolution: params.apimartZImageTurboResolution === '2K' ? '2K' : '1K',
        prompt_extend: params.apimartZImageTurboPromptExtend === true
      }
    }
  },
  pricing: {
    currency: '$', calculator: (params) => params.apimartZImageTurboPromptExtend === true ? 0.02 : 0.01,
    description: '默认 $0.01/张；开启提示词改写约 $0.02/张'
  }
})

export default apimartZImageTurboModel
