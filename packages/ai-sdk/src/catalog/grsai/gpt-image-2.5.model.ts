import { defineModel } from '../defineModel'
import type { JsonObject } from '../../types/runtime'
import { GPT25_RATIOS, GPT25_RESOLUTIONS, gpt25Choice, gpt25Images, gpt25Options, gpt25Prompt, gpt25Ratio } from '../shared/gptImage25'
import { GRSAI_GPT25_SIZES } from './gptImage25Sizes'

const regularRatios = GPT25_RATIOS.filter(r => r !== '1:3' && r !== '3:1')

export const grsaiGptImage25Model = defineModel({
  meta: {
    id: 'grsai-gpt-image-2.5', canonicalModelId: 'gpt-image-2.5', seriesId: 'gpt-image', seriesRank: 2.5,
    provider: 'grsai', type: 'image',
    tags: ['text-to-image', 'image-to-image', 'supports-image-editing', 'supports-multi-image', 'supports-4k', 'provider-grsai'],
    polling: { interval: 3000, maxAttempts: 200 },
  },
  // 应用本地上限；Grsai官方未声明参考图数量上限。
  inputLimits: { images: { max: 16 }, videos: { max: 0 } },
  params: [
    { id: 'gpt25Variant', type: 'dropdown', order: 1, default: 'flare', options: gpt25Options(['standard', 'flare', 'sunburst']) },
    { id: 'gpt25AspectRatio', type: 'dropdown', order: 2, default: 'smart', options: gpt25Options(['smart', ...GPT25_RATIOS]) },
    { id: 'gpt25Resolution', type: 'dropdown', order: 3, default: '1K', options: gpt25Options(GPT25_RESOLUTIONS), visible: { condition: p => p.gpt25Variant !== 'standard' } },
    { id: 'gpt25Quality', type: 'dropdown', order: 4, default: 'medium', options: gpt25Options(['low', 'medium', 'high', 'xhigh', 'max']), visible: { condition: p => p.gpt25Variant !== 'standard' } },
    { id: 'gpt25Transparent', type: 'switch', order: 5, default: false, visible: { condition: p => p.gpt25Variant !== 'standard' } },
  ],
  endpoints: '/v1/api/generate',
  request: { builder: params => {
    const variant = gpt25Choice(params.gpt25Variant, ['standard', 'flare', 'sunburst'], 'flare')
    const standard = variant === 'standard'
    const resolution = standard ? '1K' : gpt25Choice(params.gpt25Resolution, GPT25_RESOLUTIONS, '1K')
    const candidates = standard || resolution === '2K' ? regularRatios : GPT25_RATIOS
    const ratio = gpt25Ratio(params, params.gpt25AspectRatio, candidates)
    const size = standard ? ratio : GRSAI_GPT25_SIZES[ratio]?.[resolution]
    if (!size) throw new Error('该比例与分辨率组合尚无官方像素规格')
    const body: JsonObject = {
      model: standard ? 'gpt-image-2.5' : `gpt-image-2.5-${variant}`,
      prompt: gpt25Prompt(params),
      aspectRatio: size,
    }
    if (!standard) {
      body.quality = gpt25Choice(params.gpt25Quality, variant === 'sunburst' ? ['low', 'medium', 'high', 'xhigh', 'max'] : ['low', 'medium', 'high'], 'medium')
      if (params.gpt25Transparent !== undefined && typeof params.gpt25Transparent !== 'boolean') throw new Error('透明背景参数必须为布尔值')
      if (params.gpt25Transparent === true) body.background = 'transparent'
    }
    const images = gpt25Images(params)
    if (images.length) body.images = images
    return body
  } },
  pricing: {
    currency: '¥',
    calculator: params => ({ standard: 0.06, flare: 0.2, sunburst: 0.24 }[gpt25Choice(params.gpt25Variant, ['standard', 'flare', 'sunburst'], 'flare')] ?? 0.2),
    description: '每次600/2000/2400积分；基础充值档标准¥0.06、Flare¥0.20、Sunburst¥0.24；高额充值档低至¥0.03/0.10/0.12',
  },
})
export default grsaiGptImage25Model
