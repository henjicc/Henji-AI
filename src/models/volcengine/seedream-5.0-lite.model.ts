/** 火山方舟官方 Seedream 5.0 Lite 图片生成与编辑模型 */

import { defineModel, sharedFieldText, sharedOptionText } from '@/core'

const ASPECT_RATIOS = ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'] as const

export const volcengineSeedream50LiteModel = defineModel({
  meta: {
    id: 'volcengine-seedream-5.0-lite', canonicalModelId: 'seedream-5.0-lite', seriesId: 'seedream', seriesRank: 5,
    provider: 'volcengine', type: 'image', i18nScope: 'models.defs.volcengine-seedream-5.0-lite',
    name: { key: 'meta.name', fallback: 'Seedream 5.0 Lite' },
    tags: ['text-to-image', 'image-to-image', 'supports-image-editing', 'supports-multi-image', 'max-images-14', 'multi-output', 'supports-4k', 'provider-volcengine'],
    aliases: ['seedream-5-lite-official']
  },
  inputLimits: { images: { max: 14 }, videos: { max: 0 } },
  params: [
    {
      id: 'volcengineSeedream50LiteAspectRatio', type: 'dropdown', order: 1,
      name: sharedFieldText('aspectRatio'), default: 'smart',
      options: [{ value: 'smart', label: sharedOptionText('smart') }, ...ASPECT_RATIOS.map((ratio) => ({ value: ratio, label: ratio }))]
    },
    {
      id: 'volcengineSeedream50LiteResolution', type: 'dropdown', order: 2,
      name: sharedFieldText('resolution'), default: '2K',
      options: ['2K', '3K', '4K'].map((value) => ({ value, label: value }))
    },
    {
      id: 'volcengineSeedream50LiteCount', type: 'number', order: 3,
      name: { zh: '最大生成数量', en: 'Maximum Outputs' }, default: 1, min: 1, max: 15, step: 1
    }
  ],
  linkages: [], endpoints: '/api/v3/images/generations',
  request: {
    builder: (params) => {
      const filterSources = (value: DynamicValue): string[] => Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : []
      const uploaded = filterSources(params.uploadedFilePaths)
      const images = (uploaded.length > 0 ? uploaded : filterSources(params.images)).slice(0, 14)
      const ratios = ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9']
      const raw = String(params.volcengineSeedream50LiteAspectRatio || 'smart')
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
      const resolution = String(params.volcengineSeedream50LiteResolution || '2K')
      const sizes: Record<string, Record<string, string>> = {
        '2K': { '1:1': '2048x2048', '4:3': '2304x1728', '3:4': '1728x2304', '16:9': '2848x1600', '9:16': '1600x2848', '3:2': '2496x1664', '2:3': '1664x2496', '21:9': '3136x1344' },
        '3K': { '1:1': '3072x3072', '4:3': '3456x2592', '3:4': '2592x3456', '16:9': '4096x2304', '9:16': '2304x4096', '3:2': '3744x2496', '2:3': '2496x3744', '21:9': '4704x2016' },
        '4K': { '1:1': '4096x4096', '4:3': '4704x3520', '3:4': '3520x4704', '16:9': '5504x3040', '9:16': '3040x5504', '3:2': '4992x3328', '2:3': '3328x4992', '21:9': '6240x2656' }
      }
      const requestedCount = Math.min(15, Math.max(1, Math.round(Number(params.volcengineSeedream50LiteCount || 1))))
      const count = Math.max(1, Math.min(requestedCount, 15 - images.length))
      const body: DynamicValueMap = {
        model: 'doubao-seedream-5-0-260128',
        prompt: typeof params.prompt === 'string' ? params.prompt : '',
        size: sizes[resolution]?.[aspectRatio] || sizes['2K']['1:1'],
        sequential_image_generation: count > 1 ? 'auto' : 'disabled',
        stream: false, response_format: 'url', watermark: false
      }
      if (count > 1) body.sequential_image_generation_options = { max_images: count }
      if (images.length > 0) body.image = images
      return body
    }
  },
  pricing: {
    currency: '¥',
    calculator: (params) => {
      const images = Array.isArray(params.uploadedFilePaths)
        ? params.uploadedFilePaths.length
        : (Array.isArray(params.images) ? params.images.length : 0)
      const requested = Math.min(15, Math.max(1, Math.round(Number(params.volcengineSeedream50LiteCount || 1))))
      return Math.max(1, Math.min(requested, 15 - Math.min(14, images))) * 0.22
    },
    description: '当前官方公开价 ¥0.22/张；组图按实际成功张数计费'
  }
})

export default volcengineSeedream50LiteModel
