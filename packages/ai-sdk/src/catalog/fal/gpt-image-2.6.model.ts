import { defineModel } from '../defineModel'
import type { JsonObject, JsonValue } from '../../types/runtime'
import { hasUploadedImage, resolveUploadedImageSources } from '../shared/mediaPresence'
import { GPT25_RATIOS } from '../shared/gptImage25'
import { GPT25_OUTPUT_REFERENCE } from '../shared/gptImage25Pricing'
import {
  GPT26_FAL_FRAME_COUNT, GPT26_FRAME_DURATION, GPT26_GIF_INPUT_TOKENS_PER_IMAGE, GPT26_OUTPUTS, GPT26_SVG_MODELS,
  assertGpt26Output, gpt26FalFrame, gpt26FrameCount, gpt26FrameDuration, gpt26GifOutputTokens, gpt26Output, gpt26SvgModel,
} from '../shared/gptImage26Output'

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

const outputOf = (params: JsonObject) => gpt26Output(params.falGptImage26Output)
/** 动图所有帧共用一份像素预算、矢量图只能 1 张，两者都固定 1 份输出。 */
const countOf = (params: JsonObject) => outputOf(params) === 'image' ? count(params.falGptImage26Count) : 1

function ratioOf(params: JsonObject): string {
  let ratio = pick(params.falGptImage26AspectRatio, ['smart', ...GPT25_RATIOS], 'smart')
  if (ratio === 'smart') {
    const hint = hasUploadedImage(params) && typeof params.__firstImageRatio === 'number'
      && Number.isFinite(params.__firstImageRatio) && params.__firstImageRatio > 0 ? params.__firstImageRatio : 1
    const numeric = (value: string) => { const [w, h] = value.split(':').map(Number); return w / h }
    ratio = GPT25_RATIOS.reduce((best, next) => Math.abs(numeric(next) - hint) < Math.abs(numeric(best) - hint) ? next : best, '1:1')
  }
  return ratio
}

function sizeReference(params: JsonObject) {
  const ratio = ratioOf(params)
  const resolution = pick(params.falGptImage26Resolution, RESOLUTIONS, '1K')
  return GPT25_OUTPUT_REFERENCE[ratio + (resolution === '1K' ? '' : '@' + resolution.toLowerCase())]
}

export const falGptImage26Model = defineModel({
  meta: {
    id: 'fal-ai-gpt-image-2.6', canonicalModelId: 'gpt-image-2.6', seriesId: 'gpt-image', seriesRank: 2.6,
    provider: 'fal', type: 'image',
    tags: ['text-to-image', 'image-to-image', 'inpainting', 'transparent-background', 'animated-image', 'vector-image'],
    polling: { interval: 3000, maxAttempts: 200 },
  },
  inputLimits: { images: { max: 16 }, videos: { max: 0 } },
  params: [
    { id: 'falGptImage26Variant', type: 'dropdown', order: 1, default: 'flare', options: options(VARIANTS) },
    { id: 'falGptImage26Output', type: 'dropdown', order: 2, default: 'image', options: options(GPT26_OUTPUTS) },
    { id: 'falGptImage26AspectRatio', type: 'dropdown', order: 3, default: 'smart', options: options(['smart', ...GPT25_RATIOS]) },
    // 动图的 image_size 是单帧尺寸，按像素预算换算，不用分辨率档位。
    { id: 'falGptImage26Resolution', type: 'dropdown', order: 4, default: '1K', options: options(RESOLUTIONS), visible: { condition: p => outputOf(p) !== 'gif' } },
    { id: 'falGptImage26FrameCount', type: 'number', order: 5, default: GPT26_FAL_FRAME_COUNT.default, min: GPT26_FAL_FRAME_COUNT.min, max: GPT26_FAL_FRAME_COUNT.max, step: 1, visible: { condition: p => outputOf(p) === 'gif' } },
    { id: 'falGptImage26FrameDuration', type: 'number', order: 6, default: GPT26_FRAME_DURATION.default, min: GPT26_FRAME_DURATION.min, max: GPT26_FRAME_DURATION.max, step: GPT26_FRAME_DURATION.step, visible: { condition: p => outputOf(p) === 'gif' } },
    { id: 'falGptImage26SvgModel', type: 'dropdown', order: 7, default: GPT26_SVG_MODELS.fal.default, options: options(GPT26_SVG_MODELS.fal.values), visible: { condition: p => outputOf(p) === 'svg' } },
    { id: 'falGptImage26Quality', type: 'dropdown', order: 8, default: 'high', options: options(QUALITIES) },
    { id: 'falGptImage26ReasoningEffort', type: 'dropdown', order: 9, default: 'high', options: options(EFFORTS) },
    { id: 'falGptImage26Count', type: 'number', order: 10, default: 1, min: 1, max: 10, step: 1, visible: { condition: p => outputOf(p) === 'image' } },
    { id: 'falGptImage26Background', type: 'dropdown', order: 11, default: 'auto', options: options(BACKGROUNDS), visible: { condition: p => outputOf(p) === 'image' } },
    { id: 'falGptImage26Mask', type: 'image-upload', order: 12, default: [], valueType: 'array', maxCount: 1, format: 'url', accept: ['image/png'], visible: { condition: p => hasUploadedImage(p) && outputOf(p) === 'image' } },
  ],
  runtimeConstraints: { mediaFields: [{ field: 'mask_url', kind: 'image' }] },
  endpoints: { selector: params => {
    const variant = pick(params.falGptImage26Variant, VARIANTS, 'flare')
    return `openai/gpt-image-2.6/${variant}/${hasUploadedImage(params) ? 'edit' : 'text-to-image'}`
  } },
  request: { builder: params => {
    if (typeof params.prompt !== 'string' || !params.prompt.trim()) throw new Error('请输入 GPT Image 2.6 提示词')
    const output = outputOf(params)
    const images = resolveUploadedImageSources(params)
    if (images.length > 16) throw new Error('GPT Image 2.6 最多支持 16 张参考图')
    assertGpt26Output(output, images.length > 0, true)
    const frames = output === 'gif' ? gpt26FrameCount(params.falGptImage26FrameCount, GPT26_FAL_FRAME_COUNT) : 0
    const { width, height } = output === 'gif' ? gpt26FalFrame(ratioOf(params), frames) : sizeReference(params)
    const body: JsonObject = {
      prompt: params.prompt, image_size: { width, height },
      quality: pick(params.falGptImage26Quality, QUALITIES, 'high'),
      reasoning_effort: pick(params.falGptImage26ReasoningEffort, EFFORTS, 'high'),
      num_images: countOf(params),
    }
    if (output === 'image') body.background = pick(params.falGptImage26Background, BACKGROUNDS, 'auto')
    if (output === 'gif') Object.assign(body, { output_format: 'gif', frame_count: frames, frame_duration_ms: gpt26FrameDuration(params.falGptImage26FrameDuration) })
    if (output === 'svg') Object.assign(body, { output_format: 'svg', svg_model: gpt26SvgModel('fal', params.falGptImage26SvgModel) })
    if (images.length) body.image_urls = images
    const masks = params.falGptImage26Mask === undefined || output !== 'image' ? [] : params.falGptImage26Mask
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
      if (outputOf(params) === 'gif') {
        const frame = gpt26FalFrame(ratioOf(params), gpt26FrameCount(params.falGptImage26FrameCount, GPT26_FAL_FRAME_COUNT))
        // 图像输入 $8/百万 token，参考图按每张 1536 token 估。
        return (gpt26GifOutputTokens(frame.sheetPixels, index) * 30 + resolveUploadedImageSources(params).length * GPT26_GIF_INPUT_TOKENS_PER_IMAGE * 8) / 1000000
      }
      return sizeReference(params).tokens[index] * 30 / 1000000 * countOf(params)
    },
    description: '按token计费（图像输出 $30/百万token）；仅为同型号尺寸/token表的输出参考估算，提示词与参考图输入另计；自动质量按max预估；动图按全部帧的总像素折算并含参考图输入，矢量图另按矢量化模型的文本 token 计费、不在估价内',
  },
})
export default falGptImage26Model
