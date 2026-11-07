import { defineModel } from '../defineModel'
import type { JsonObject, JsonValue } from '../../types/runtime'
import { hasUploadedImage, resolveUploadedImageSources } from '../shared/mediaPresence'
import { GPT25_RATIOS } from '../shared/gptImage25'
import { GPT25_OUTPUT_REFERENCE } from '../shared/gptImage25Pricing'

// 字段与价格来源：docs/model-adaptation/GPT-Image-2.6/GPT-Image-2.6_Fal.md（Fal 模型页与 OpenAPI，2026-11-07 读取）。
// 2.6 与 2.5 的尺寸约束、token 单价相同，因此沿用 2.5 的同型号尺寸/token 参考表估算输出费用。
const VARIANTS = ['flare', 'sunburst']
const RESOLUTIONS = ['1K', '2K', '4K']
const QUALITIES = ['auto', 'low', 'medium', 'high', 'xhigh', 'max']
const EFFORTS = ['low', 'medium', 'high']
const BACKGROUNDS = ['auto', 'opaque', 'transparent']
const options = (values: readonly string[]) => values.map(value => ({ value }))

function pick(value: JsonValue, values: readonly string[], fallback: string): string {
  if (value === undefined) return fallback
  if (typeof value !== 'string' || !values.includes(value)) throw new Error(`GPT Image 2.6 参数不支持：${String(value)}`)
  return value
}

function count(value: JsonValue): number {
  if (value === undefined) return 1
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 10) throw new Error('GPT Image 2.6 生成数量必须为 1–10 的整数')
  return value
}

function sizeReference(params: JsonObject) {
  let ratio = pick(params.falGptImage26AspectRatio, ['smart', ...GPT25_RATIOS], 'smart')
  if (ratio === 'smart') {
    const hint = hasUploadedImage(params) && typeof params.__firstImageRatio === 'number'
      && Number.isFinite(params.__firstImageRatio) && params.__firstImageRatio > 0 ? params.__firstImageRatio : 1
    const numeric = (value: string) => { const [w, h] = value.split(':').map(Number); return w / h }
    ratio = GPT25_RATIOS.reduce((best, next) => Math.abs(numeric(next) - hint) < Math.abs(numeric(best) - hint) ? next : best, '1:1')
  }
  const resolution = pick(params.falGptImage26Resolution, RESOLUTIONS, '1K')
  return GPT25_OUTPUT_REFERENCE[ratio + (resolution === '1K' ? '' : '@' + resolution.toLowerCase())]
}

export const falGptImage26Model = defineModel({
  meta: {
    id: 'fal-ai-gpt-image-2.6', canonicalModelId: 'gpt-image-2.6', seriesId: 'gpt-image', seriesRank: 2.6,
    provider: 'fal', type: 'image',
    tags: ['text-to-image', 'image-to-image', 'inpainting', 'transparent-background'],
    polling: { interval: 3000, maxAttempts: 200 },
  },
  inputLimits: { images: { max: 16 }, videos: { max: 0 } },
  params: [
    { id: 'falGptImage26Variant', type: 'dropdown', order: 1, default: 'flare', options: options(VARIANTS) },
    { id: 'falGptImage26AspectRatio', type: 'dropdown', order: 2, default: 'smart', options: options(['smart', ...GPT25_RATIOS]) },
    { id: 'falGptImage26Resolution', type: 'dropdown', order: 3, default: '1K', options: options(RESOLUTIONS) },
    { id: 'falGptImage26Quality', type: 'dropdown', order: 4, default: 'high', options: options(QUALITIES) },
    { id: 'falGptImage26ReasoningEffort', type: 'dropdown', order: 5, default: 'high', options: options(EFFORTS) },
    { id: 'falGptImage26Count', type: 'number', order: 6, default: 1, min: 1, max: 10, step: 1 },
    { id: 'falGptImage26Background', type: 'dropdown', order: 7, default: 'auto', options: options(BACKGROUNDS) },
    { id: 'falGptImage26Mask', type: 'image-upload', order: 8, default: [], valueType: 'array', maxCount: 1, format: 'url', accept: ['image/png'], visible: { condition: hasUploadedImage } },
  ],
  runtimeConstraints: { mediaFields: [{ field: 'mask_url', kind: 'image' }] },
  endpoints: { selector: params => {
    const variant = pick(params.falGptImage26Variant, VARIANTS, 'flare')
    return `openai/gpt-image-2.6/${variant}/${hasUploadedImage(params) ? 'edit' : 'text-to-image'}`
  } },
  request: { builder: params => {
    if (typeof params.prompt !== 'string' || !params.prompt.trim()) throw new Error('请输入 GPT Image 2.6 提示词')
    const { width, height } = sizeReference(params)
    const body: JsonObject = {
      prompt: params.prompt, image_size: { width, height },
      quality: pick(params.falGptImage26Quality, QUALITIES, 'high'),
      reasoning_effort: pick(params.falGptImage26ReasoningEffort, EFFORTS, 'high'),
      background: pick(params.falGptImage26Background, BACKGROUNDS, 'auto'),
      num_images: count(params.falGptImage26Count),
    }
    const images = resolveUploadedImageSources(params)
    if (images.length > 16) throw new Error('GPT Image 2.6 最多支持 16 张参考图')
    if (images.length) body.image_urls = images
    const masks = params.falGptImage26Mask === undefined ? [] : params.falGptImage26Mask
    if (!Array.isArray(masks) || masks.length > 1 || masks.some(m => typeof m !== 'string' || !m.trim())) throw new Error('局部重绘遮罩必须是单张图片')
    if (masks.length) {
      if (!images.length) throw new Error('局部重绘需要先添加参考图')
      body.mask_url = masks[0]
    }
    return body
  } },
  pricing: {
    currency: '$',
    calculator: params => {
      const quality = pick(params.falGptImage26Quality, QUALITIES, 'high')
      const index = ['low', 'medium', 'high', 'xhigh', 'max'].indexOf(quality === 'auto' ? 'max' : quality)
      return sizeReference(params).tokens[index] * 30 / 1000000 * count(params.falGptImage26Count)
    },
    description: '按token计费（图像输出 $30/百万token）；仅为同型号尺寸/token表的输出参考估算，提示词与参考图输入另计；自动质量按max预估',
  },
})
export default falGptImage26Model
