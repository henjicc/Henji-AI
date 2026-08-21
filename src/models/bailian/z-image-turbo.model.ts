/** 阿里云百炼官方 Z-Image Turbo 文生图模型 */

import { defineModel, sharedFieldText, sharedOptionText } from '@/core'

const ASPECT_RATIOS = ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '7:9', '9:7', '21:9', '9:21'] as const

export const bailianZImageTurboModel = defineModel({
  meta: {
    id: 'bailian-z-image-turbo', canonicalModelId: 'z-image-turbo', seriesId: 'z-image', seriesRank: 1,
    provider: 'bailian', type: 'image', i18nScope: 'models.defs.bailian-z-image-turbo',
    name: { key: 'meta.name', fallback: 'Z-Image Turbo' },
    tags: ['text-to-image', 'provider-bailian'], aliases: ['z-image-turbo-official']
  },
  inputLimits: { images: { max: 0 }, videos: { max: 0 } },
  params: [
    {
      id: 'bailianZImageTurboAspectRatio', type: 'dropdown', order: 1,
      name: sharedFieldText('aspectRatio'), default: 'smart',
      options: [{ value: 'smart', label: sharedOptionText('smart') }, ...ASPECT_RATIOS.map((ratio) => ({ value: ratio, label: ratio }))]
    },
    {
      id: 'bailianZImageTurboResolution', type: 'dropdown', order: 2,
      name: sharedFieldText('resolution'), default: '1K',
      options: ['1K', '2K'].map((value) => ({ value, label: value }))
    },
    {
      id: 'bailianZImageTurboPromptExtend', type: 'switch', order: 3,
      name: { zh: '提示词改写', en: 'Prompt Rewrite' }, default: false
    }
  ],
  linkages: [], endpoints: '/api/v1/services/aigc/multimodal-generation/generation',
  request: {
    builder: (params) => {
      const ratios = ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '7:9', '9:7', '21:9', '9:21']
      const raw = String(params.bailianZImageTurboAspectRatio || 'smart')
      const aspectRatio = ratios.includes(raw) ? raw : '1:1'
      const pair = aspectRatio.split(':').map(Number)
      const ratio = pair[0] / pair[1]
      const base = params.bailianZImageTurboResolution === '2K' ? 2048 : 1024
      const width = Math.max(512, Math.round(Math.sqrt(base * base * ratio) / 8) * 8)
      const height = Math.max(512, Math.round(Math.sqrt(base * base / ratio) / 8) * 8)
      return {
        model: 'z-image-turbo',
        input: {
          messages: [{ role: 'user', content: [{ text: typeof params.prompt === 'string' ? params.prompt.slice(0, 800) : '' }] }]
        },
        parameters: {
          size: `${width}*${height}`,
          prompt_extend: params.bailianZImageTurboPromptExtend === true,
          watermark: false
        }
      }
    }
  },
  pricing: {
    currency: '¥', calculator: (params) => params.bailianZImageTurboPromptExtend === true ? 0.2 : 0.1,
    description: '关闭提示词改写 ¥0.10/张，开启 ¥0.20/张'
  }
})

export default bailianZImageTurboModel
