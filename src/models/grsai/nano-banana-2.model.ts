/** Grsai Nano Banana 2 标准/CL 渠道统一模型（Lite 是独立产品，见 nano-banana-2-lite.model.ts） */

import { defineModel, sharedFieldText, sharedOptionText } from '@/core'

const GRSAI_GENERATE_ENDPOINT = '/v1/api/generate'

// CL 渠道的分辨率是绑定在渠道本身上的独立计价档位（不同分辨率对应不同 model 名与价格），
// 不是标准渠道那种价格不变的自由分辨率选择，因此三档 CL 直接展开成三个渠道选项。
const RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9', '1:4', '4:1', '1:8', '8:1'] as const

export const grsaiNanoBanana2Model = defineModel({
  meta: {
    id: 'grsai-nano-banana-2',
    canonicalModelId: 'nano-banana-2',
    seriesId: 'nano-banana',
    seriesRank: 2,
    provider: 'grsai',
    type: 'image',
    i18nScope: 'models.defs.grsai-nano-banana-2',
    name: { key: 'meta.name', fallback: 'Nano Banana 2' },
    tags: ['text-to-image', 'image-to-image', 'supports-image-editing', 'supports-multi-image', 'supports-4k', 'provider-grsai'],
    aliases: ['nano-banana-2-grsai'],
    polling: { interval: 3000, maxAttempts: 200, expectedAttempts: 40 }
  },
  // Grsai 文档未标注参考图数量上限，沿用同一模型在其它供应商上的常见上限。
  inputLimits: { images: { max: 14 }, videos: { max: 0 } },
  params: [
    {
      id: 'grsaiNanoBanana2Channel', type: 'dropdown', order: 1, role: 'channel',
      name: sharedFieldText('apiChannel'), default: 'standard',
      options: [
        { value: 'standard', label: { zh: '标准', en: 'Standard' } },
        { value: 'cl-1k', label: { zh: 'CL · 1K', en: 'CL · 1K' } },
        { value: 'cl-2k', label: { zh: 'CL · 2K', en: 'CL · 2K' } },
        { value: 'cl-4k', label: { zh: 'CL · 4K', en: 'CL · 4K' } }
      ]
    },
    {
      id: 'grsaiNanoBanana2AspectRatio', type: 'dropdown', order: 2,
      name: sharedFieldText('aspectRatio'), default: 'smart',
      options: [
        { value: 'smart', label: sharedOptionText('smart') },
        ...RATIOS.map((ratio) => ({ value: ratio, label: ratio }))
      ]
    },
    {
      id: 'grsaiNanoBanana2Resolution', type: 'dropdown', order: 3,
      name: sharedFieldText('resolution'), default: '1K',
      visible: { condition: (params) => params.grsaiNanoBanana2Channel === 'standard' },
      options: ['1K', '2K', '4K'].map((value) => ({ value, label: value }))
    }
  ],
  linkages: [],
  endpoints: GRSAI_GENERATE_ENDPOINT,
  request: {
    builder: (params) => {
      const filterSources = (value: DynamicValue): string[] => Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : []
      const uploaded = filterSources(params.uploadedFilePaths)
      const images = filterSources(params.images)
      const allImages = uploaded.length > 0 ? uploaded : images
      const prompt = typeof params.prompt === 'string' ? params.prompt : ''

      const ratios = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9', '1:4', '4:1', '1:8', '8:1']
      const raw = String(params.grsaiNanoBanana2AspectRatio || 'smart')
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

      const channel = String(params.grsaiNanoBanana2Channel || 'standard')
      const channelToModel: Record<string, { model: string; imageSize: string }> = {
        standard: { model: 'nano-banana-2', imageSize: '' },
        'cl-1k': { model: 'nano-banana-2-cl', imageSize: '1K' },
        'cl-2k': { model: 'nano-banana-2-2k-cl', imageSize: '2K' },
        'cl-4k': { model: 'nano-banana-2-4k-cl', imageSize: '4K' }
      }
      const resolved = channelToModel[channel] ?? channelToModel.standard
      const imageSize = resolved.imageSize || (['1K', '2K', '4K'].includes(String(params.grsaiNanoBanana2Resolution))
        ? String(params.grsaiNanoBanana2Resolution)
        : '1K')

      const body: DynamicValueMap = { model: resolved.model, prompt, aspectRatio: ratio, imageSize }
      if (allImages.length > 0) body.images = allImages
      return body
    }
  },
  pricing: {
    currency: '¥',
    calculator: (params) => {
      const price: Record<string, number> = { standard: 0.12, 'cl-1k': 0.6, 'cl-2k': 0.9, 'cl-4k': 1.3 }
      return price[String(params.grsaiNanoBanana2Channel)] ?? price.standard
    },
    description: '标准渠道 ¥0.12/次（低至 ¥0.06）；CL 1K ¥0.6/次、CL 2K ¥0.9/次、CL 4K ¥1.3/次（均为对应最高档折扣价的一倍，无优惠上限价）'
  }
})

export default grsaiNanoBanana2Model
