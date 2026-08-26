/** Grsai GPT Image 2 标准/VIP 渠道统一模型 */

import { defineModel, sharedFieldText, sharedOptionText } from '@/core'

const GRSAI_GENERATE_ENDPOINT = '/v1/api/generate'

// 标准渠道只接受比例字符串，VIP 渠道只接受具体像素值；两者取值范围不同，VIP 是标准渠道的超集
// （多出 1:3 / 3:1）。UI 统一展示 VIP 的全集，标准渠道选到多出的两档时回退到最近邻。
// 注意：下面这份仅用于生成 params 选项列表；request.builder 会被单独序列化进独立 VM 执行，
// 不能引用这里的模块级常量，因此 builder 内部重复声明了一份等价数据，两处改动需要一起同步。
const REGULAR_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9', '9:21', '1:2', '2:1'] as const
const VIP_ONLY_RATIOS = ['1:3', '3:1'] as const
const ALL_RATIOS = [...REGULAR_RATIOS, ...VIP_ONLY_RATIOS] as const

export const grsaiGptImage2Model = defineModel({
  meta: {
    id: 'grsai-gpt-image-2',
    canonicalModelId: 'gpt-image-2',
    seriesId: 'gpt-image',
    seriesRank: 1,
    provider: 'grsai',
    type: 'image',
    i18nScope: 'models.defs.grsai-gpt-image-2',
    name: { key: 'meta.name', fallback: 'GPT Image 2' },
    tags: ['text-to-image', 'image-to-image', 'supports-image-editing', 'supports-multi-image', 'supports-4k', 'provider-grsai'],
    aliases: ['gpt-image-2-grsai'],
    polling: { interval: 3000, maxAttempts: 200, expectedAttempts: 40 }
  },
  // Grsai 文档未标注参考图数量上限，沿用同一模型在其它供应商上的常见上限。
  inputLimits: { images: { max: 16 }, videos: { max: 0 } },
  params: [
    {
      id: 'grsaiGptImage2Channel', type: 'dropdown', order: 1, role: 'channel',
      name: sharedFieldText('apiChannel'), default: 'standard',
      options: [
        { value: 'standard', label: { zh: '标准', en: 'Standard' } },
        { value: 'vip', label: { zh: 'VIP', en: 'VIP' } }
      ]
    },
    {
      id: 'grsaiGptImage2AspectRatio', type: 'dropdown', order: 2,
      name: sharedFieldText('aspectRatio'), default: 'smart',
      options: [
        { value: 'smart', label: sharedOptionText('smart') },
        ...ALL_RATIOS.map((ratio) => ({ value: ratio, label: ratio }))
      ]
    },
    {
      id: 'grsaiGptImage2Resolution', type: 'dropdown', order: 3,
      name: sharedFieldText('resolution'), default: '1K',
      visible: { condition: (params) => params.grsaiGptImage2Channel === 'vip' },
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
      const images = uploaded.length > 0 ? uploaded : filterSources(params.images)
      const prompt = typeof params.prompt === 'string' ? params.prompt : ''
      const isVip = params.grsaiGptImage2Channel === 'vip'
      const hint = typeof params.__firstImageRatio === 'number' && Number.isFinite(params.__firstImageRatio) && params.__firstImageRatio > 0
        ? params.__firstImageRatio
        : 1

      const regularRatios = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9', '9:21', '1:2', '2:1']
      const allRatios = [...regularRatios, '1:3', '3:1']
      const candidateSet = isVip ? allRatios : regularRatios
      const raw = String(params.grsaiGptImage2AspectRatio || 'smart')
      let ratio = candidateSet.includes(raw) ? raw : '1:1'
      if (raw === 'smart' || raw === 'auto' || !candidateSet.includes(raw)) {
        let bestDiff = Number.POSITIVE_INFINITY
        for (const candidate of candidateSet) {
          const pair = candidate.split(':').map(Number)
          const diff = Math.abs(pair[0] / pair[1] - hint)
          if (diff < bestDiff) { bestDiff = diff; ratio = candidate }
        }
      }

      const body: DynamicValueMap = { prompt }
      if (images.length > 0) body.images = images

      if (!isVip) {
        body.model = 'gpt-image-2'
        body.aspectRatio = ratio
        return body
      }

      const vipPixelTable: Record<string, Partial<Record<string, string>>> = {
        '1:1': { '1K': '1024x1024', '2K': '2048x2048', '4K': '2880x2880' },
        '16:9': { '1K': '1280x720', '2K': '2048x1152', '4K': '3840x2160' },
        '9:16': { '1K': '720x1280', '2K': '1152x2048', '4K': '2160x3840' },
        '4:3': { '1K': '1152x864', '2K': '2304x1728', '4K': '3264x2448' },
        '3:4': { '1K': '864x1152', '2K': '1728x2304', '4K': '2448x3264' },
        '3:2': { '1K': '1536x1024', '2K': '2048x1360', '4K': '3504x2336' },
        '2:3': { '1K': '1024x1536', '2K': '1360x2048', '4K': '2336x3504' },
        '5:4': { '1K': '1120x896', '2K': '2240x1792', '4K': '3200x2560' },
        '4:5': { '1K': '896x1120', '2K': '1792x2240', '4K': '2560x3200' },
        '21:9': { '1K': '1456x624', '2K': '2912x1248', '4K': '3840x1648' },
        '9:21': { '1K': '624x1456', '2K': '1248x2912', '4K': '1648x3840' },
        '1:3': { '1K': '688x2048', '4K': '1280x3840' },
        '3:1': { '1K': '2048x688', '4K': '3840x1280' },
        '2:1': { '1K': '1536x768', '2K': '3072x1536', '4K': '3840x1920' },
        '1:2': { '1K': '768x1536', '2K': '1536x3072', '4K': '1920x3840' }
      }
      const resolution = ['1K', '2K', '4K'].includes(String(params.grsaiGptImage2Resolution))
        ? String(params.grsaiGptImage2Resolution)
        : '1K'
      const pixelsForRatio = vipPixelTable[ratio] ?? vipPixelTable['1:1']
      const pixels = pixelsForRatio[resolution] ?? pixelsForRatio['1K'] ?? '1024x1024'

      body.model = 'gpt-image-2-vip'
      body.aspectRatio = pixels
      return body
    }
  },
  pricing: {
    currency: '¥',
    calculator: (params) => params.grsaiGptImage2Channel === 'vip' ? 0.2 : 0.06,
    description: '标准渠道 ¥0.06/次（¥999 档位起低至 ¥0.03）；VIP 渠道 ¥0.2/次（低至 ¥0.1），价格与分辨率无关，显示为无优惠上限价'
  }
})

export default grsaiGptImage2Model
