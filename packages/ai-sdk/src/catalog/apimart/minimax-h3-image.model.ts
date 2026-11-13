/** APIMart MiniMax H3 Image 标准版与 Highspeed 统一模型（运行时契约） */

import { defineModel } from '../defineModel'
import { hasUploadedImage, resolveUploadedImageSources } from '../shared/mediaPresence'
import type { JsonObject } from '../../types/runtime'

// 字段与价格来源：docs/model-adaptation/MiniMax-H3-Image/MiniMax-H3-Image_APIMart.md（APIMart 文档与模型页，2026-11-14 读取）
// 官方比例范围为 1:3–3:1，以下比例都在范围内。
const RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'] as const
const RESOLUTIONS = ['1K', '2K', '4K'] as const
// 平台按 token 计费，模型页只给单张文生图估价；Highspeed 的图片输入输出单价是标准版的 2 倍。
const ESTIMATED_PRICE: Record<string, number> = { '1K': 0.0189, '2K': 0.0189, '4K': 0.0628 }

const isHighspeed = (params: JsonObject): boolean => params.apimartMiniMaxH3ImageVersion === 'highspeed'

function resolution(params: JsonObject): string {
  return RESOLUTIONS.includes(params.apimartMiniMaxH3ImageResolution as typeof RESOLUTIONS[number])
    ? String(params.apimartMiniMaxH3ImageResolution)
    : '2K'
}

function count(params: JsonObject): number {
  return Math.min(10, Math.max(1, Math.round(Number(params.apimartMiniMaxH3ImageCount) || 1)))
}

/**
 * 智能比例取第一张图最接近的支持比例，没有图时用 1:1；文生图始终发明确比例，关闭扩写时平台要求这一点。
 * 编辑时扩写恒开、可用 auto：有参考图却读不到其比例时交给 auto，避免按 1:1 裁掉画面。
 */
function size(params: JsonObject): string {
  const raw = String(params.apimartMiniMaxH3ImageAspectRatio || 'smart')
  const ratios: readonly string[] = RATIOS
  if (ratios.includes(raw)) return raw
  const known = typeof params.__firstImageRatio === 'number' && Number.isFinite(params.__firstImageRatio) && params.__firstImageRatio > 0
  // 与端点选择同一取图口径：只有真的走编辑时才能发 auto。
  if (!known && resolveUploadedImageSources(params).length > 0) return 'auto'
  const hint = typeof params.__firstImageRatio === 'number' && Number.isFinite(params.__firstImageRatio) && params.__firstImageRatio > 0 ? params.__firstImageRatio : 1
  const value = (ratio: string) => { const [w, h] = ratio.split(':').map(Number); return w / h }
  return ratios.reduce((best, next) => Math.abs(value(next) - hint) < Math.abs(value(best) - hint) ? next : best, '1:1')
}

export const apimartMiniMaxH3ImageModel = defineModel({
  meta: {
    id: 'apimart-minimax-h3-image', canonicalModelId: 'minimax-h3-image', seriesId: 'minimax-image', seriesRank: 3,
    provider: 'apimart', type: 'image',
    tags: ['text-to-image', 'image-to-image'],
    polling: { interval: 3000, maxAttempts: 200 },
  },
  inputLimits: { images: { max: 16 }, videos: { max: 0 } },
  params: [
    { id: 'apimartMiniMaxH3ImageVersion', type: 'dropdown', order: 1, default: 'standard', options: [{ value: 'standard' }, { value: 'highspeed' }] },
    { id: 'apimartMiniMaxH3ImageAspectRatio', type: 'dropdown', order: 2, default: 'smart', options: [{ value: 'smart' }, ...RATIOS.map(value => ({ value }))] },
    { id: 'apimartMiniMaxH3ImageResolution', type: 'dropdown', order: 3, default: '2K', options: RESOLUTIONS.map(value => ({ value })) },
    { id: 'apimartMiniMaxH3ImageCount', type: 'number', order: 4, default: 1, min: 1, max: 10, step: 1 },
    // 编辑时平台始终扩写提示词，关闭会被拒绝。
    { id: 'apimartMiniMaxH3ImagePromptExpansion', type: 'switch', order: 5, default: true, visible: { condition: (params: JsonObject) => !hasUploadedImage(params) } },
  ],
  endpoints: '/v1/images/generations',
  request: {
    builder: (params) => {
      const prompt = typeof params.prompt === 'string' ? params.prompt.trim() : ''
      if (!prompt) throw new Error('MiniMax H3 Image 的提示词不能为空')
      if (prompt.length > 32000) throw new Error('MiniMax H3 Image 提示词最多 32000 字符')
      const images = resolveUploadedImageSources(params)
      if (images.length > 16) throw new Error('MiniMax H3 Image 最多接受 16 张参考图')
      // 平台缺省 4K，必须显式发送分辨率。
      const body: JsonObject = {
        model: isHighspeed(params) ? 'minimax-h3-image-highspeed' : 'minimax-h3-image',
        prompt,
        size: size(params),
        resolution: resolution(params),
        n: count(params),
      }
      if (images.length > 0) body.image_urls = images
      else if (params.apimartMiniMaxH3ImagePromptExpansion === false) body.prompt_optimizer = false
      return body
    },
  },
  pricing: {
    currency: '$',
    billingMode: 'estimated',
    calculator: params => ESTIMATED_PRICE[resolution(params)] * (isHighspeed(params) ? 2 : 1) * count(params),
    description: '按 token 计费，此处为平台给出的单张文生图估价：标准版 1K/2K 约 $0.0189、4K 约 $0.0628/张，Highspeed 翻倍；编辑时参考图另按图片输入 token 计费，平台未公布单价，未计入估价',
  },
})

export default apimartMiniMaxH3ImageModel
