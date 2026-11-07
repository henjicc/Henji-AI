import { defineModel } from '../defineModel'
import type { JsonObject, JsonValue } from '../../types/runtime'
import { hasUploadedImage, resolveUploadedImageSources } from '../shared/mediaPresence'
import { GPT25_BACKGROUNDS, GPT25_QUALITIES, GPT25_RATIOS, GPT25_RESOLUTIONS, gpt25Options, gpt25Ratio } from '../shared/gptImage25'
import { GPT25_OUTPUT_REFERENCE } from '../shared/gptImage25Pricing'

const VARIANTS = ['flare', 'sunburst', 'economy']
const ECONOMY_RATIOS = ['1:1', '16:9', '9:16', '3:2', '2:3', '21:9', '4:3']
const COMPLEXITIES = ['low', 'medium', 'high']
function choice(value: JsonValue, values: readonly string[], fallback: string): string {
  if (value === undefined) return fallback
  if (typeof value !== 'string' || !values.includes(value)) throw new Error(`GPT Image 2.6 参数不支持：${String(value)}`)
  return value
}
const variantOf = (params: JsonObject) => choice(params.kieGpt26Variant, VARIANTS, 'flare')
const isTokenBilled = (params: JsonObject) => variantOf(params) !== 'economy'

export const kieGptImage26Model = defineModel({
  meta: {
    id: 'kie-gpt-image-2.6', canonicalModelId: 'gpt-image-2.6', seriesId: 'gpt-image', seriesRank: 2.6,
    provider: 'kie', type: 'image',
    tags: ['text-to-image', 'image-to-image', 'inpainting', 'transparent-background'],
    polling: { interval: 3000, maxAttempts: 200 },
  },
  inputLimits: { images: { max: 16 }, videos: { max: 0 } },
  params: [
    { id: 'kieGpt26Variant', type: 'dropdown', order: 1, default: 'flare', options: gpt25Options(VARIANTS) },
    { id: 'kieGpt26AspectRatio', type: 'dropdown', order: 2, default: 'smart', options: gpt25Options(['smart', ...GPT25_RATIOS]) },
    { id: 'kieGpt26Resolution', type: 'dropdown', order: 3, default: '1K', options: gpt25Options(GPT25_RESOLUTIONS), visible: { condition: isTokenBilled } },
    { id: 'kieGpt26Quality', type: 'dropdown', order: 4, default: 'medium', options: gpt25Options(GPT25_QUALITIES), visible: { condition: isTokenBilled } },
    { id: 'kieGpt26Complexity', type: 'dropdown', order: 5, default: 'high', options: gpt25Options(COMPLEXITIES), visible: { condition: isTokenBilled } },
    { id: 'kieGpt26Background', type: 'dropdown', order: 6, default: 'auto', options: gpt25Options(GPT25_BACKGROUNDS) },
    {
      id: 'kieGpt26Mask', type: 'image-upload', order: 7, default: [], valueType: 'array', maxCount: 1, format: 'url', accept: ['image/png'],
      visible: { condition: params => isTokenBilled(params) && hasUploadedImage(params) },
    },
  ],
  runtimeConstraints: { mediaFields: [{ field: 'mask_url', kind: 'image' }] },
  endpoints: '/api/v1/jobs/createTask',
  request: { builder: (params) => {
    const variant = variantOf(params)
    const economy = variant === 'economy'
    const images = resolveUploadedImageSources(params)
    if (images.length > 16) throw new Error('GPT Image 2.6 最多支持 16 张参考图')
    const maxPrompt = economy ? 20000 : 32000
    if (typeof params.prompt !== 'string' || !params.prompt.trim()) throw new Error('请输入 GPT Image 2.6 提示词')
    if (params.prompt.length > maxPrompt) throw new Error(`GPT Image 2.6 提示词最多 ${maxPrompt} 字符`)
    const input: JsonObject = {
      prompt: params.prompt,
      aspect_ratio: gpt25Ratio(params, params.kieGpt26AspectRatio, economy ? ECONOMY_RATIOS : GPT25_RATIOS),
      background: choice(params.kieGpt26Background, GPT25_BACKGROUNDS, 'auto'),
    }
    if (!economy) {
      input.resolution = choice(params.kieGpt26Resolution, GPT25_RESOLUTIONS, '1K')
      input.quality = choice(params.kieGpt26Quality, GPT25_QUALITIES, 'medium')
      input.complexity = choice(params.kieGpt26Complexity, COMPLEXITIES, 'high')
    }
    if (images.length) input.input_urls = images
    const masks = params.kieGpt26Mask === undefined ? [] : params.kieGpt26Mask
    if (!Array.isArray(masks) || masks.length > 1 || masks.some(m => typeof m !== 'string' || !m.trim())) throw new Error('局部重绘遮罩必须是单张图片')
    if (masks.length && !economy) {
      if (!images.length) throw new Error('局部重绘需要先添加参考图')
      input.mask_url = masks[0]
    }
    return { model: `gpt-image-2-6/${variant}-${images.length ? 'image-to-image' : 'text-to-image'}`, input }
  } },
  pricing: {
    currency: '$', billingMode: 'estimated',
    calculator: (params) => {
      if (!isTokenBilled(params)) return 0.025
      const ratio = gpt25Ratio(params, params.kieGpt26AspectRatio, GPT25_RATIOS)
      const resolution = choice(params.kieGpt26Resolution, GPT25_RESOLUTIONS, '1K')
      const quality = choice(params.kieGpt26Quality, GPT25_QUALITIES, 'medium')
      const index = ['low', 'medium', 'high', 'xhigh', 'max'].indexOf(quality === 'auto' ? 'max' : quality)
      const reference = GPT25_OUTPUT_REFERENCE[ratio + (resolution === '1K' ? '' : '@' + resolution.toLowerCase())]
      return reference.tokens[index] * 27 / 1_000_000
    },
    description: 'Economy 1K $0.025/张；Flare/Sunburst 按 Token 计费（图片输出 $27、图片输入 $7.2、文本输入 $4.5 每百万 Token），按 2.5 同尺寸输出 Token 表估算输出费，输入另计，自动质量按最高档预估',
  },
})
export default kieGptImage26Model
