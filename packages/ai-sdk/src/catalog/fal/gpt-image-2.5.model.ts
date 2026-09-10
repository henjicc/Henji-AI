import { defineModel } from '../defineModel'
import type { JsonObject } from '../../types/runtime'
import { hasUploadedImage } from '../shared/mediaPresence'
import { GPT25_BACKGROUNDS, GPT25_QUALITIES, GPT25_RATIOS, GPT25_RESOLUTIONS, gpt25Choice, gpt25Count, gpt25Images, gpt25Options, gpt25Prompt } from '../shared/gptImage25'
import { gpt25OutputEstimate, gpt25SizeReference } from '../shared/gptImage25Pricing'

export const falGptImage25Model = defineModel({
  meta: {
    id: 'fal-ai-gpt-image-2.5', canonicalModelId: 'gpt-image-2.5', seriesId: 'gpt-image', seriesRank: 2.5,
    provider: 'fal', type: 'image',
    tags: ['text-to-image', 'image-to-image', 'supports-image-editing', 'supports-multi-image', 'multi-output', 'supports-4k', 'provider-fal'],
    polling: { interval: 3000, maxAttempts: 200 },
  },
  inputLimits: { images: { max: 16 }, videos: { max: 0 } },
  params: [
    { id: 'gpt25Variant', type: 'dropdown', order: 1, default: 'flare', options: gpt25Options(['flare', 'sunburst']) },
    { id: 'gpt25AspectRatio', type: 'dropdown', order: 2, default: 'smart', options: gpt25Options(['smart', ...GPT25_RATIOS]) },
    { id: 'gpt25Resolution', type: 'dropdown', order: 3, default: '1K', options: gpt25Options(GPT25_RESOLUTIONS) },
    { id: 'gpt25Quality', type: 'dropdown', order: 4, default: 'high', options: gpt25Options(GPT25_QUALITIES) },
    { id: 'gpt25Count', type: 'number', order: 5, default: 1, min: 1, max: 10, step: 1 },
    { id: 'gpt25Background', type: 'dropdown', order: 6, default: 'auto', options: gpt25Options(GPT25_BACKGROUNDS) },
    { id: 'gpt25Mask', type: 'image-upload', order: 7, default: [], valueType: 'array', maxCount: 1, format: 'url', accept: ['image/png'], visible: { condition: hasUploadedImage } },
  ],
  runtimeConstraints: { mediaFields: [{ field: 'mask_url', kind: 'image' }] },
  endpoints: { selector: params => {
    const variant = gpt25Choice(params.gpt25Variant, ['flare', 'sunburst'], 'flare')
    return `openai/gpt-image-2.5/${variant}/${hasUploadedImage(params) ? 'edit' : 'text-to-image'}`
  } },
  request: { builder: params => {
    const { width, height } = gpt25SizeReference(params)
    const body: JsonObject = {
      prompt: gpt25Prompt(params), image_size: { width, height },
      quality: gpt25Choice(params.gpt25Quality, GPT25_QUALITIES, 'high'),
      background: gpt25Choice(params.gpt25Background, GPT25_BACKGROUNDS, 'auto'),
      num_images: gpt25Count(params.gpt25Count, 10),
    }
    const images = gpt25Images(params)
    if (images.length) body.image_urls = images
    const masks = params.gpt25Mask === undefined ? [] : params.gpt25Mask
    if (!Array.isArray(masks) || masks.length > 1 || masks.some(m => typeof m !== 'string' || !m.trim())) throw new Error('局部重绘遮罩必须是单张图片')
    if (masks.length) {
      if (!images.length) throw new Error('局部重绘需要先添加参考图')
      body.mask_url = masks[0]
    }
    return body
  } },
  pricing: {
    currency: '$', calculator: params => gpt25OutputEstimate(params, 30, 'high'),
    description: '按token计费；仅为同型号尺寸/token表的输出参考估算，提示词与参考图输入另计；自动质量按max预估',
  },
})
export default falGptImage25Model
