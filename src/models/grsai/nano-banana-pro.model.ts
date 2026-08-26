/** Grsai Nano Banana Pro 五渠道统一模型（标准 / VT / CL / VIP / 4K VIP） */

import { defineModel, sharedFieldText, sharedOptionText } from '@/core'

const GRSAI_GENERATE_ENDPOINT = '/v1/api/generate'
// API 文档把极端比例（1:4/4:1/1:8/8:1）明确标注为「nano-banana-2 系列额外支持」，字面不含 Pro，
// 故 Pro 只暴露这 11 档基础比例，详见 docs/model-adaptation/Nano-Banana-Pro/Nano-Banana-Pro_Grsai.md。
const RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9', '9:21'] as const

// 只有这三个渠道的分辨率是可自由选择、且不影响价格的「子选项」；cl 与 4k-vip 各自绑死一个分辨率，
// 不通过分辨率下拉表达，直接隐藏该控件。
const MULTI_RESOLUTION_CHANNELS = new Set(['standard', 'vt', 'vip'])

export const grsaiNanoBananaProModel = defineModel({
  meta: {
    id: 'grsai-nano-banana-pro',
    canonicalModelId: 'nano-banana-pro',
    seriesId: 'nano-banana',
    seriesRank: 3,
    provider: 'grsai',
    type: 'image',
    i18nScope: 'models.defs.grsai-nano-banana-pro',
    name: { key: 'meta.name', fallback: 'Nano Banana Pro' },
    tags: ['text-to-image', 'image-to-image', 'supports-image-editing', 'supports-multi-image', 'supports-4k', 'provider-grsai'],
    aliases: ['nano-banana-pro-grsai'],
    polling: { interval: 3000, maxAttempts: 200, expectedAttempts: 45 }
  },
  // Grsai 文档未标注参考图数量上限，沿用同一模型在其它供应商上的常见上限。
  inputLimits: { images: { max: 14 }, videos: { max: 0 } },
  params: [
    {
      id: 'grsaiNanoBananaProChannel', type: 'dropdown', order: 1, role: 'channel',
      name: sharedFieldText('apiChannel'), default: 'standard',
      options: [
        { value: 'standard', label: { zh: '标准', en: 'Standard' } },
        { value: 'vt', label: { zh: 'VT（备用线路）', en: 'VT (Alt Route)' } },
        { value: 'cl', label: { zh: 'CL · 1K', en: 'CL · 1K' } },
        { value: 'vip', label: { zh: 'VIP', en: 'VIP' } },
        { value: '4k-vip', label: { zh: 'VIP · 4K', en: 'VIP · 4K' } }
      ]
    },
    {
      id: 'grsaiNanoBananaProAspectRatio', type: 'dropdown', order: 2,
      name: sharedFieldText('aspectRatio'), default: 'smart',
      options: [
        { value: 'smart', label: sharedOptionText('smart') },
        ...RATIOS.map((ratio) => ({ value: ratio, label: ratio }))
      ]
    },
    {
      id: 'grsaiNanoBananaProResolution', type: 'dropdown', order: 3,
      name: sharedFieldText('resolution'), default: '1K',
      visible: { condition: (params) => MULTI_RESOLUTION_CHANNELS.has(String(params.grsaiNanoBananaProChannel)) },
      options: ['1K', '2K', '4K'].map((value) => ({ value, label: value }))
    }
  ],
  linkages: [
    {
      trigger: 'grsaiNanoBananaProChannel',
      effect: 'filterOptions',
      target: 'grsaiNanoBananaProResolution',
      filter: (channel, options) => channel === 'vip'
        ? options.filter((option) => option.value !== '4K')
        : options
    },
    {
      trigger: 'grsaiNanoBananaProChannel',
      effect: 'autoSwitch',
      target: 'grsaiNanoBananaProResolution',
      condition: (channel, allParams) => channel === 'vip' && allParams.grsaiNanoBananaProResolution === '4K',
      value: '2K'
    }
  ],
  endpoints: GRSAI_GENERATE_ENDPOINT,
  request: {
    builder: (params) => {
      const filterSources = (value: DynamicValue): string[] => Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : []
      const uploaded = filterSources(params.uploadedFilePaths)
      const images = uploaded.length > 0 ? uploaded : filterSources(params.images)
      const prompt = typeof params.prompt === 'string' ? params.prompt : ''

      const ratios = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9', '9:21']
      const raw = String(params.grsaiNanoBananaProAspectRatio || 'smart')
      const hint = typeof params.__firstImageRatio === 'number' && Number.isFinite(params.__firstImageRatio) && params.__firstImageRatio > 0
        ? params.__firstImageRatio
        : 1
      let ratio = ratios.includes(raw) ? raw : '1:1'
      if (raw === 'smart' || raw === 'auto' || !ratios.includes(raw)) {
        let bestDiff = Number.POSITIVE_INFINITY
        for (const candidate of ratios) {
          const pair = candidate.split(':').map(Number)
          const diff = Math.abs(pair[0] / pair[1] - hint)
          if (diff < bestDiff) { bestDiff = diff; ratio = candidate }
        }
      }

      const channel = String(params.grsaiNanoBananaProChannel || 'standard')
      const channelToModel: Record<string, { model: string; fixedImageSize?: string }> = {
        standard: { model: 'nano-banana-pro' },
        vt: { model: 'nano-banana-pro-vt' },
        cl: { model: 'nano-banana-pro-cl', fixedImageSize: '1K' },
        vip: { model: 'nano-banana-pro-vip' },
        '4k-vip': { model: 'nano-banana-pro-4k-vip', fixedImageSize: '4K' }
      }
      const resolved = channelToModel[channel] ?? channelToModel.standard
      const requestedResolution = ['1K', '2K', '4K'].includes(String(params.grsaiNanoBananaProResolution))
        ? String(params.grsaiNanoBananaProResolution)
        : '1K'
      const imageSize = resolved.fixedImageSize
        ?? (channel === 'vip' && requestedResolution === '4K' ? '2K' : requestedResolution)

      const body: DynamicValueMap = { model: resolved.model, prompt, aspectRatio: ratio, imageSize }
      if (images.length > 0) body.images = images
      return body
    }
  },
  pricing: {
    currency: '¥',
    calculator: (params) => {
      const price: Record<string, number> = { standard: 0.18, vt: 0.18, cl: 1, vip: 1, '4k-vip': 1.8 }
      return price[String(params.grsaiNanoBananaProChannel)] ?? price.standard
    },
    description: '标准/VT 渠道 ¥0.18/次（低至 ¥0.09）；CL·1K 与 VIP 渠道 ¥1/次（低至 ¥0.5）；VIP·4K ¥1.8/次（低至 ¥0.9），均为无优惠上限价'
  }
})

export default grsaiNanoBananaProModel
