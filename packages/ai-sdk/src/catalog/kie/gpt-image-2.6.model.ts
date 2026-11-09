import { defineModel } from '../defineModel'
import type { JsonObject, JsonValue } from '../../types/runtime'
import { hasUploadedImage, resolveUploadedImageSources } from '../shared/mediaPresence'
import { GPT25_BACKGROUNDS, GPT25_QUALITIES, GPT25_RATIOS, GPT25_RESOLUTIONS, gpt25Options, gpt25Ratio } from '../shared/gptImage25'
import { GPT25_OUTPUT_REFERENCE } from '../shared/gptImage25Pricing'
import {
  GPT26_FRAME_COUNT, GPT26_FRAME_DURATION, GPT26_OUTPUTS, GPT26_SVG_MODELS,
  assertGpt26Output, gpt26FrameCount, gpt26FrameDuration, gpt26GifOutputTokens, gpt26Output, gpt26SheetFrame, gpt26SvgModel,
} from '../shared/gptImage26Output'

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
const outputOf = (params: JsonObject) => gpt26Output(params.kieGpt26Output)
/** Economy 的帧数只接受 auto 与 4/9/16/25/36/64 档，交给模型自动决定，不开放帧数与时长。 */
const hasFrameControls = (params: JsonObject) => outputOf(params) === 'gif' && isTokenBilled(params)

export const kieGptImage26Model = defineModel({
  meta: {
    id: 'kie-gpt-image-2.6', canonicalModelId: 'gpt-image-2.6', seriesId: 'gpt-image', seriesRank: 2.6,
    provider: 'kie', type: 'image',
    tags: ['text-to-image', 'image-to-image', 'inpainting', 'transparent-background', 'animated-image', 'vector-image'],
    polling: { interval: 3000, maxAttempts: 200 },
  },
  inputLimits: { images: { max: 16 }, videos: { max: 0 } },
  params: [
    { id: 'kieGpt26Variant', type: 'dropdown', order: 1, default: 'flare', options: gpt25Options(VARIANTS) },
    { id: 'kieGpt26Output', type: 'dropdown', order: 2, default: 'image', options: gpt25Options(GPT26_OUTPUTS) },
    { id: 'kieGpt26AspectRatio', type: 'dropdown', order: 3, default: 'smart', options: gpt25Options(['smart', ...GPT25_RATIOS]) },
    // 动图尺寸按单帧换算，比例只决定单帧形状，分辨率档位不适用。
    { id: 'kieGpt26Resolution', type: 'dropdown', order: 4, default: '1K', options: gpt25Options(GPT25_RESOLUTIONS), visible: { condition: p => isTokenBilled(p) && outputOf(p) !== 'gif' } },
    { id: 'kieGpt26FrameCount', type: 'number', order: 5, default: GPT26_FRAME_COUNT.default, min: GPT26_FRAME_COUNT.min, max: GPT26_FRAME_COUNT.max, step: 1, visible: { condition: hasFrameControls } },
    { id: 'kieGpt26FrameDuration', type: 'number', order: 6, default: GPT26_FRAME_DURATION.default, min: GPT26_FRAME_DURATION.min, max: GPT26_FRAME_DURATION.max, step: GPT26_FRAME_DURATION.step, visible: { condition: hasFrameControls } },
    { id: 'kieGpt26SvgModel', type: 'dropdown', order: 7, default: GPT26_SVG_MODELS.kie.default, options: gpt25Options(GPT26_SVG_MODELS.kie.values), visible: { condition: p => outputOf(p) === 'svg' } },
    { id: 'kieGpt26Quality', type: 'dropdown', order: 8, default: 'medium', options: gpt25Options(GPT25_QUALITIES), visible: { condition: isTokenBilled } },
    { id: 'kieGpt26Complexity', type: 'dropdown', order: 9, default: 'high', options: gpt25Options(COMPLEXITIES), visible: { condition: isTokenBilled } },
    // 文档对动图能否透明前后矛盾，动图与矢量图都不发送背景。
    { id: 'kieGpt26Background', type: 'dropdown', order: 10, default: 'auto', options: gpt25Options(GPT25_BACKGROUNDS), visible: { condition: p => outputOf(p) === 'image' } },
    {
      id: 'kieGpt26Mask', type: 'image-upload', order: 11, default: [], valueType: 'array', maxCount: 1, format: 'url', accept: ['image/png'],
      visible: { condition: params => isTokenBilled(params) && hasUploadedImage(params) && outputOf(params) === 'image' },
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
    // 动图与矢量图只在文生图端点提供；Economy 没有矢量图。
    const output = outputOf(params)
    assertGpt26Output(output, images.length > 0, false)
    if (economy && output === 'svg') throw new Error('GPT Image 2.6 Economy 不支持矢量图')
    const ratio = gpt25Ratio(params, params.kieGpt26AspectRatio, economy ? ECONOMY_RATIOS : GPT25_RATIOS)
    const input: JsonObject = { prompt: params.prompt }
    if (output === 'image') input.background = choice(params.kieGpt26Background, GPT25_BACKGROUNDS, 'auto')
    if (output !== 'gif' || economy) input.aspect_ratio = ratio
    if (!economy) {
      if (output !== 'gif') input.resolution = choice(params.kieGpt26Resolution, GPT25_RESOLUTIONS, '1K')
      input.quality = choice(params.kieGpt26Quality, GPT25_QUALITIES, 'medium')
      input.complexity = choice(params.kieGpt26Complexity, COMPLEXITIES, 'high')
    }
    if (output === 'gif') {
      input.output_format = 'gif'
      if (!economy) {
        const frames = gpt26FrameCount(params.kieGpt26FrameCount)
        const frame = gpt26SheetFrame(ratio, frames)
        Object.assign(input, { size: `${frame.width}x${frame.height}`, frame_count: frames, frame_duration_ms: gpt26FrameDuration(params.kieGpt26FrameDuration) })
      }
    }
    if (output === 'svg') Object.assign(input, { output_format: 'svg', svg: { model: gpt26SvgModel('kie', params.kieGpt26SvgModel) } })
    if (images.length) input.input_urls = images
    const masks = params.kieGpt26Mask === undefined || output !== 'image' ? [] : params.kieGpt26Mask
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
      if (outputOf(params) === 'gif') return gpt26GifOutputTokens(gpt26SheetFrame(ratio, gpt26FrameCount(params.kieGpt26FrameCount)).sheetPixels, index) * 27 / 1_000_000
      const reference = GPT25_OUTPUT_REFERENCE[ratio + (resolution === '1K' ? '' : '@' + resolution.toLowerCase())]
      return reference.tokens[index] * 27 / 1_000_000
    },
    description: 'Economy 1K $0.025/张；Flare/Sunburst 按 Token 计费（图片输出 $27、图片输入 $7.2、文本输入 $4.5 每百万 Token），按 2.5 同尺寸输出 Token 表估算输出费，输入另计，自动质量按最高档预估；动图按全部帧拼成的整张图估算，矢量图另按矢量化模型的文本 Token 计费、不在估价内',
  },
})
export default kieGptImage26Model
