/** 火山方舟官方 Seedream 5.0 Pro 图片生成与编辑模型 */

import { defineModel, sharedFieldText, sharedOptionText } from '@/core'

const ASPECT_RATIOS = ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'] as const

export const volcengineSeedream50ProModel = defineModel({
  meta: {
    id: 'volcengine-seedream-5.0-pro', canonicalModelId: 'seedream-5.0-pro', seriesId: 'seedream', seriesRank: 5.1,
    provider: 'volcengine', type: 'image', i18nScope: 'models.defs.volcengine-seedream-5.0-pro',
    name: { key: 'meta.name', fallback: 'Seedream 5.0 Pro' },
    tags: ['text-to-image', 'image-to-image', 'supports-image-editing', 'supports-multi-image', 'max-images-10', 'provider-volcengine'],
    aliases: ['seedream-5-pro-official']
  },
  inputLimits: { images: { max: 10 }, videos: { max: 0 } },
  params: [
    {
      id: 'volcengineSeedream50ProAspectRatio', type: 'dropdown', order: 1,
      name: sharedFieldText('aspectRatio'), default: 'smart',
      options: [{ value: 'smart', label: sharedOptionText('smart') }, ...ASPECT_RATIOS.map((ratio) => ({ value: ratio, label: ratio }))]
    },
    {
      id: 'volcengineSeedream50ProResolution', type: 'dropdown', order: 2,
      name: sharedFieldText('resolution'), default: '1.5K',
      options: ['1K', '1.5K', '2K'].map((value) => ({ value, label: value }))
    },
    {
      id: 'volcengineSeedream50ProBackground', type: 'dropdown', order: 3,
      name: { zh: '背景', en: 'Background' }, default: 'opaque',
      options: [
        { value: 'opaque', label: { zh: '不透明', en: 'Opaque' } },
        { value: 'transparent', label: { zh: '透明', en: 'Transparent' } }
      ]
    }
  ],
  linkages: [], endpoints: '/api/v3/images/generations',
  request: {
    builder: (params) => {
      const filterSources = (value: DynamicValue): string[] => Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : []
      const uploaded = filterSources(params.uploadedFilePaths)
      const images = (uploaded.length > 0 ? uploaded : filterSources(params.images)).slice(0, 10)
      const ratios = ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9']
      const raw = String(params.volcengineSeedream50ProAspectRatio || 'smart')
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
      const resolution = String(params.volcengineSeedream50ProResolution || '1.5K')
      const base = resolution === '2K' ? 2048 : (resolution === '1K' ? 1024 : 1536)
      const width = Math.round(Math.sqrt(base * base * ratio) / 16) * 16
      const height = Math.round(Math.sqrt(base * base / ratio) / 16) * 16
      const body: DynamicValueMap = {
        model: 'doubao-seedream-5-0-pro-260628',
        prompt: typeof params.prompt === 'string' ? params.prompt : '',
        size: `${width}x${height}`,
        background: params.volcengineSeedream50ProBackground === 'transparent' ? 'transparent' : 'opaque',
        response_format: 'url', watermark: false
      }
      if (images.length > 0) body.image = images
      return body
    }
  },
  pricing: {
    currency: '¥', fixed: 0.3,
    description: '当前按近期方舟调用样本估算 ¥0.30/张；正式价格以方舟账单为准'
  }
})

export default volcengineSeedream50ProModel
