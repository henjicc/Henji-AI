import { defineModel } from '../defineModel'
import type { JsonObject } from '../../types/runtime'
import { hasUploadedImage } from '../shared/mediaPresence'
import { GPT25_BACKGROUNDS, GPT25_KIE_RATIOS, GPT25_KIE_1K_RATIOS, GPT25_RESOLUTIONS, gpt25Choice, gpt25Images, gpt25Options, gpt25Prompt, gpt25Ratio } from '../shared/gptImage25'

export const kieGptImage25Model = defineModel({
  meta: {
    id: 'kie-gpt-image-2.5', canonicalModelId: 'gpt-image-2.5', seriesId: 'gpt-image', seriesRank: 2.5,
    provider: 'kie', type: 'image',
    tags: ['text-to-image', 'image-to-image', 'supports-image-editing', 'supports-multi-image', 'supports-4k', 'provider-kie'],
  },
  inputLimits: { images: { max: 16 }, videos: { max: 0 } },
  params: [
    { id: 'gpt25Variant', type: 'dropdown', order: 1, default: 'flare', options: gpt25Options(['flare', 'sunburst']) },
    { id: 'gpt25AspectRatio', type: 'dropdown', order: 2, default: 'smart', options: gpt25Options(['smart', ...GPT25_KIE_RATIOS]) },
    { id: 'gpt25Resolution', type: 'dropdown', order: 3, default: '1K', options: gpt25Options(GPT25_RESOLUTIONS) },
    { id: 'gpt25Background', type: 'dropdown', order: 4, default: 'auto', options: gpt25Options(GPT25_BACKGROUNDS) },
  ],
  endpoints: '/api/v1/jobs/createTask',
  request: { builder: (params) => {
    const variant = gpt25Choice(params.gpt25Variant, ['flare', 'sunburst'], 'flare')
    const resolution = gpt25Choice(params.gpt25Resolution, GPT25_RESOLUTIONS, '1K')
    const ratios = resolution === '1K' ? GPT25_KIE_RATIOS : GPT25_KIE_RATIOS.filter(r => !GPT25_KIE_1K_RATIOS.includes(r))
    const input: JsonObject = {
      prompt: gpt25Prompt(params, 20000),
      aspect_ratio: gpt25Ratio(params, params.gpt25AspectRatio, ratios), resolution,
      background: gpt25Choice(params.gpt25Background, GPT25_BACKGROUNDS, 'auto'),
    }
    const images = gpt25Images(params)
    if (images.length) input.input_urls = images
    return { model: `gpt-image-2-5-${variant}-${hasUploadedImage(params) ? 'image-to-image' : 'text-to-image'}`, input }
  } },
  pricing: {
    currency: '$',
    calculator: params => ({ '1K': 0.03, '2K': 0.05, '4K': 0.08 }[gpt25Choice(params.gpt25Resolution, GPT25_RESOLUTIONS, '1K')] ?? 0.03),
    description: 'Flare / Sunburst 文生图与编辑同价：1K $0.03、2K $0.05、4K $0.08/张，不含充值赠送优惠',
  },
})
export default kieGptImage25Model
