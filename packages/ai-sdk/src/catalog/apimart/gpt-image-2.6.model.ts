/** APIMart GPT Image 2.6 Ext 与官方渠道统一模型（运行时契约） */

import { defineModel } from '../defineModel'
import { GPT25_OUTPUT_REFERENCE } from '../shared/gptImage25Pricing'
import { hasUploadedImage, resolveUploadedImageSources } from '../shared/mediaPresence'
import type { JsonObject, JsonValue } from '../../types/runtime'

const RATIOS = ['1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '16:9', '9:16', '2:1', '1:2', '21:9', '9:21', '3:1', '1:3']
const EXT_RATIOS = ['1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '16:9', '9:16', '21:9']
const QUALITIES = ['auto', 'low', 'medium', 'high', 'xhigh', 'max']
const RESOLUTIONS = ['1K', '2K', '4K']
const COMPLEXITIES = ['low', 'medium', 'high']
const BACKGROUNDS = ['auto', 'opaque', 'transparent']
// 2.6 与 2.5 的像素尺寸映射相同；定价页说明 low 输出 token 为 2.5 的 4.2 倍、medium 为 3.3 倍，其余档位不变。
const TOKEN_MULTIPLIERS = [4.2, 3.3, 1, 1, 1]
const options = (values: readonly string[]) => values.map(value => ({ value }))

function choice(value: JsonValue, values: readonly string[], fallback: string): string {
  if (value === undefined) return fallback
  if (typeof value !== 'string' || !values.includes(value)) throw new Error(`GPT Image 2.6 参数不支持：${String(value)}`)
  return value
}

function count(params: JsonObject): number {
  if (params.gpt26Channel !== 'official') return 1
  const value = params.gpt26Count
  if (value === undefined) return 1
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 4) {
    throw new Error('GPT Image 2.6 生成数量必须为 1–4 的整数')
  }
  return value
}

function ratio(params: JsonObject, candidates: readonly string[]): string {
  const raw = choice(params.gpt26AspectRatio, ['smart', ...candidates], 'smart')
  if (raw !== 'smart') return raw
  const hint = hasUploadedImage(params) && typeof params.__firstImageRatio === 'number'
    && Number.isFinite(params.__firstImageRatio) && params.__firstImageRatio > 0 ? params.__firstImageRatio : 1
  const numeric = (value: string) => { const [w, h] = value.split(':').map(Number); return w / h }
  return candidates.reduce((best, next) => Math.abs(numeric(next) - hint) < Math.abs(numeric(best) - hint) ? next : best, '1:1')
}

function officialOutputEstimate(params: JsonObject): number {
  const quality = choice(params.gpt26Quality, QUALITIES, 'medium')
  const index = ['low', 'medium', 'high', 'xhigh', 'max'].indexOf(quality === 'auto' ? 'max' : quality)
  const resolution = choice(params.gpt26Resolution, RESOLUTIONS, '1K')
  const reference = GPT25_OUTPUT_REFERENCE[ratio(params, RATIOS) + (resolution === '1K' ? '' : '@' + resolution.toLowerCase())]
  // 黄金价图片输出 240 Credits / 1M tokens，即 $24 / 1M tokens。
  return Math.ceil(reference.tokens[index] * TOKEN_MULTIPLIERS[index]) * 24 / 1000000 * count(params)
}

export const apimartGptImage26Model = defineModel({
  meta: {
    id: 'apimart-gpt-image-2.6', canonicalModelId: 'gpt-image-2.6', seriesId: 'gpt-image', seriesRank: 2.6,
    provider: 'apimart', type: 'image',
    tags: ['text-to-image', 'image-to-image', 'transparent-background'],
    polling: { interval: 3000, maxAttempts: 200 },
  },
  inputLimits: { images: { max: 16 }, videos: { max: 0 } },
  params: [
    { id: 'gpt26Channel', type: 'dropdown', order: 1, default: 'ext', options: options(['ext', 'official']) },
    { id: 'gpt26Variant', type: 'dropdown', order: 2, default: 'flare', options: options(['flare', 'sunburst']) },
    { id: 'gpt26AspectRatio', type: 'dropdown', order: 3, default: 'smart', options: options(['smart', ...RATIOS]) },
    // Ext 渠道当前只开放 1K，2K/4K 会返回 model_price_not_configured。
    { id: 'gpt26Resolution', type: 'dropdown', order: 4, default: '1K', options: options(RESOLUTIONS), visible: { condition: p => p.gpt26Channel === 'official' } },
    { id: 'gpt26Quality', type: 'dropdown', order: 5, default: 'medium', options: options(QUALITIES) },
    { id: 'gpt26Complexity', type: 'dropdown', order: 6, default: 'high', options: options(COMPLEXITIES) },
    // Ext 渠道 n=2–4 会建任务后失败退款，只在官方渠道开放多张。
    { id: 'gpt26Count', type: 'number', order: 7, default: 1, min: 1, max: 4, step: 1, visible: { condition: p => p.gpt26Channel === 'official' } },
    { id: 'gpt26Background', type: 'dropdown', order: 8, default: 'auto', options: options(BACKGROUNDS), visible: { condition: p => p.gpt26Channel === 'official' } },
  ],
  endpoints: '/v1/images/generations',
  request: { builder: params => {
    const channel = choice(params.gpt26Channel, ['ext', 'official'], 'ext')
    const variant = choice(params.gpt26Variant, ['flare', 'sunburst'], 'flare')
    if (typeof params.prompt !== 'string' || !params.prompt.trim()) throw new Error('请输入 GPT Image 2.6 提示词')
    if (params.prompt.length > 32000) throw new Error('GPT Image 2.6 提示词最多 32000 字符')
    const images = resolveUploadedImageSources(params)
    if (images.length > 16) throw new Error('GPT Image 2.6 最多支持 16 张参考图')
    const body: JsonObject = {
      model: channel === 'ext' ? 'gpt-image-2.6-ext' : `gpt-image-2.6-${variant}`,
      prompt: params.prompt,
      n: count(params),
      size: ratio(params, channel === 'ext' ? EXT_RATIOS : RATIOS),
      resolution: channel === 'ext' ? '1k' : choice(params.gpt26Resolution, RESOLUTIONS, '1K').toLowerCase(),
      quality: choice(params.gpt26Quality, QUALITIES, 'medium'),
      complexity: choice(params.gpt26Complexity, COMPLEXITIES, 'high'),
    }
    if (channel === 'ext') body.version = variant
    else body.background = choice(params.gpt26Background, BACKGROUNDS, 'auto')
    if (images.length) body.image_urls = images
    return body
  } },
  pricing: {
    currency: '$',
    calculator: params => params.gpt26Channel === 'official' ? officialOutputEstimate(params) : 0.0085,
    description: 'Ext 渠道 Flare / Sunburst 均为 1K $0.0085/张；官方渠道按 token 计费，估算仅含图片输出（$24/1M tokens），提示词与参考图输入另计，自动质量按 max 预估',
  },
})

export default apimartGptImage26Model
