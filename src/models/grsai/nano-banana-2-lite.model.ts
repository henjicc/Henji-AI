/**
 * Grsai Nano Banana 2 Lite 图片生成模型
 *
 * 与 Nano Banana 2 是两个独立产品模型（canonicalModelId 不同），不是同一模型下的渠道/分辨率选项，
 * 详见 docs/model-adaptation/Nano-Banana-2-Lite/Nano-Banana-2-Lite_Grsai.md。
 *
 * dashboard 上价格/规格与本模型完全相同的 `nano-banana-fast` 是初代「香蕉」世代的遗留命名，
 * 本项目已明确排除、不适配，不要把它当成本模型的备用渠道加回来
 * （见 docs/model-adaptation/供应商/Grsai.md 第 7 节）。
 */

import { defineModel, sharedFieldText, sharedOptionText } from '@/core'

const GRSAI_GENERATE_ENDPOINT = '/v1/api/generate'
const RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9'] as const

export const grsaiNanoBanana2LiteModel = defineModel({
  meta: {
    id: 'grsai-nano-banana-2-lite',
    canonicalModelId: 'nano-banana-2-lite',
    seriesId: 'nano-banana',
    seriesRank: 1,
    provider: 'grsai',
    type: 'image',
    i18nScope: 'models.defs.grsai-nano-banana-2-lite',
    name: { key: 'meta.name', fallback: 'Nano Banana 2 Lite' },
    tags: ['text-to-image', 'image-to-image', 'supports-image-editing', 'supports-multi-image', 'provider-grsai'],
    aliases: ['nano-banana-2-lite-grsai'],
    polling: { interval: 3000, maxAttempts: 200, expectedAttempts: 35 }
  },
  inputLimits: { images: { max: 14 }, videos: { max: 0 } },
  params: [
    {
      id: 'grsaiNanoBanana2LiteAspectRatio', type: 'dropdown', order: 1,
      name: sharedFieldText('aspectRatio'), default: 'smart',
      options: [
        { value: 'smart', label: sharedOptionText('smart') },
        ...RATIOS.map((ratio) => ({ value: ratio, label: ratio }))
      ]
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
      const images = uploaded.length > 0 ? uploaded : filterSources(params.images)
      const prompt = typeof params.prompt === 'string' ? params.prompt : ''

      const ratios = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9']
      const raw = String(params.grsaiNanoBanana2LiteAspectRatio || 'smart')
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

      const body: DynamicValueMap = { model: 'nano-banana-2-lite', prompt, aspectRatio: ratio }
      if (images.length > 0) body.images = images
      return body
    }
  },
  pricing: {
    currency: '¥',
    calculator: () => 0.044,
    description: '¥0.044/次（无优惠上限价，¥999 档位起低至 ¥0.022）'
  }
})

export default grsaiNanoBanana2LiteModel
