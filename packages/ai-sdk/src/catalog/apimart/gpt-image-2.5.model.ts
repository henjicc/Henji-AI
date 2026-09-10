import { defineModel } from '../defineModel'
import type { JsonObject } from '../../types/runtime'
import { GPT25_BACKGROUNDS, GPT25_EXT_RATIOS, GPT25_QUALITIES, GPT25_RATIOS, GPT25_RESOLUTIONS, gpt25Choice, gpt25Count, gpt25Images, gpt25Options, gpt25Prompt, gpt25Ratio } from '../shared/gptImage25'
import { gpt25OutputEstimate } from '../shared/gptImage25Pricing'

export const apimartGptImage25Model = defineModel({
  meta: {
    id: 'apimart-gpt-image-2.5', canonicalModelId: 'gpt-image-2.5', seriesId: 'gpt-image', seriesRank: 2.5,
    provider: 'apimart', type: 'image',
    tags: ['text-to-image', 'image-to-image', 'supports-image-editing', 'supports-multi-image', 'multi-output', 'supports-4k', 'provider-apimart'],
    polling: { interval: 3000, maxAttempts: 200 },
  },
  inputLimits: { images: { max: 16 }, videos: { max: 0 } },
  params: [
    { id: 'gpt25Channel', type: 'dropdown', order: 1, default: 'ext', options: gpt25Options(['ext', 'official']) },
    { id: 'gpt25Variant', type: 'dropdown', order: 2, default: 'flare', options: gpt25Options(['flare', 'sunburst']) },
    { id: 'gpt25AspectRatio', type: 'dropdown', order: 3, default: 'smart', options: gpt25Options(['smart', ...GPT25_RATIOS]) },
    { id: 'gpt25Resolution', type: 'dropdown', order: 4, default: '1K', options: gpt25Options(GPT25_RESOLUTIONS) },
    { id: 'gpt25Quality', type: 'dropdown', order: 5, default: 'medium', options: gpt25Options(GPT25_QUALITIES), visible: { condition: p => p.gpt25Channel === 'official' } },
    { id: 'gpt25Count', type: 'number', order: 6, default: 1, min: 1, max: 4, step: 1 },
    { id: 'gpt25Background', type: 'dropdown', order: 7, default: 'auto', options: gpt25Options(GPT25_BACKGROUNDS), visible: { condition: p => p.gpt25Channel === 'official' } },
  ],
  endpoints: '/v1/images/generations',
  request: { builder: params => {
    const channel = gpt25Choice(params.gpt25Channel, ['ext', 'official'], 'ext')
    const variant = gpt25Choice(params.gpt25Variant, ['flare', 'sunburst'], 'flare')
    const resolution = gpt25Choice(params.gpt25Resolution, GPT25_RESOLUTIONS, '1K')
    const body: JsonObject = {
      model: channel === 'ext' ? 'gpt-image-2.5-ext' : `gpt-image-2.5-${variant}`,
      prompt: gpt25Prompt(params), n: gpt25Count(params.gpt25Count, 4),
      size: gpt25Ratio(params, params.gpt25AspectRatio, channel === 'ext' ? GPT25_EXT_RATIOS : GPT25_RATIOS),
      resolution: channel === 'ext' ? resolution : resolution.toLowerCase(),
    }
    if (channel === 'ext') body.version = variant
    else {
      body.quality = gpt25Choice(params.gpt25Quality, GPT25_QUALITIES, 'medium')
      body.background = gpt25Choice(params.gpt25Background, GPT25_BACKGROUNDS, 'auto')
    }
    const images = gpt25Images(params)
    if (images.length) body.image_urls = images
    return body
  } },
  pricing: {
    currency: '$',
    calculator: params => params.gpt25Channel === 'official'
      ? gpt25OutputEstimate(params, 24, 'medium')
      : gpt25Count(params.gpt25Count, 4) * ({ '1K': 0.0085, '2K': 0.014, '4K': 0.021 }[gpt25Choice(params.gpt25Resolution, GPT25_RESOLUTIONS, '1K')] ?? 0.0085),
    description: 'Ext按张：1K $0.0085 / 2K $0.014 / 4K $0.021；官方渠道按token，估算仅含输出，输入另计，自动质量按max预估',
  },
})
export default apimartGptImage25Model
