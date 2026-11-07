/** APIMart 万相 2.7 Image 标准版与 Pro 统一模型（运行时契约） */

import { defineModel } from '../defineModel'
import { resolveUploadedImageSources } from '../shared/mediaPresence'
import type { JsonObject } from '../../types/runtime'

// 字段、限制与价格来源：docs/model-adaptation/Wan-2.7-Image/Wan-2.7-Image_APIMart.md（2026-11-07 读取）。
const RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3']
const RESOLUTIONS = ['1K', '2K', '4K']
const PRICES: Record<string, number> = { standard: 0.0216, pro: 0.0544 }

function variant(params: JsonObject): 'standard' | 'pro' {
  return params.apimartWan27ImageVariant === 'pro' ? 'pro' : 'standard'
}

function sequential(params: JsonObject): boolean {
  return params.apimartWan27ImageSequential === true
}

function count(params: JsonObject): number {
  const value = params.apimartWan27ImageCount
  if (value === undefined) return 1
  const max = sequential(params) ? 12 : 4
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > max) {
    throw new Error(`万相 2.7 Image ${sequential(params) ? '组图模式' : ''}生成数量必须为 1–${max} 的整数`)
  }
  return value
}

export const apimartWan27ImageModel = defineModel({
  meta: {
    id: 'apimart-wan-2.7-image', canonicalModelId: 'wan-2.7-image', seriesId: 'wan', seriesRank: 2.7,
    provider: 'apimart', type: 'image',
    tags: ['text-to-image', 'image-to-image'],
    polling: { interval: 3000, maxAttempts: 200, expectedAttempts: 20 },
  },
  inputLimits: { images: { max: 9 }, videos: { max: 0 } },
  params: [
    { id: 'apimartWan27ImageVariant', type: 'dropdown', order: 1, default: 'standard', options: [{ value: 'standard' }, { value: 'pro' }] },
    { id: 'apimartWan27ImageAspectRatio', type: 'dropdown', order: 2, default: 'smart', options: [{ value: 'smart' }, ...RATIOS.map(value => ({ value }))] },
    { id: 'apimartWan27ImageResolution', type: 'dropdown', order: 3, default: '2K', options: RESOLUTIONS.map(value => ({ value })) },
    // 静态上限取组图的 12，非组图时由展示层联动收窄到 4；校验器只认静态范围。
    { id: 'apimartWan27ImageCount', type: 'number', order: 4, default: 1, min: 1, max: 12, step: 1 },
    { id: 'apimartWan27ImageSequential', type: 'switch', order: 5, default: false },
  ],
  endpoints: '/v1/images/generations',
  request: {
    builder: (params) => {
      const prompt = typeof params.prompt === 'string' ? params.prompt.trim() : ''
      const images = resolveUploadedImageSources(params)
      if (!prompt && images.length === 0) throw new Error('请输入万相 2.7 Image 提示词')
      if (images.length > 9) throw new Error('万相 2.7 Image 最多支持 9 张参考图')
      const resolution = RESOLUTIONS.includes(String(params.apimartWan27ImageResolution)) ? String(params.apimartWan27ImageResolution) : '2K'
      // 平台只在 Pro 的非组图文生图开放 4K，其余场景会拒绝。
      if (resolution === '4K' && (variant(params) !== 'pro' || images.length > 0 || sequential(params))) {
        throw new Error('万相 2.7 Image 只有 Pro 版文生图（非组图）支持 4K')
      }
      const body: JsonObject = {
        model: variant(params) === 'pro' ? 'wan2.7-image-pro' : 'wan2.7-image',
        resolution,
        n: count(params),
      }
      if (prompt) body.prompt = prompt.slice(0, 5000)
      if (sequential(params)) body.enable_sequential = true
      if (images.length > 0) {
        // 有输入图时平台把输出比例对齐最后一张图，比例字段不会生效，不发送。
        body.image_urls = images
      } else {
        const raw = String(params.apimartWan27ImageAspectRatio || 'smart')
        body.size = RATIOS.includes(raw) ? raw : '1:1'
      }
      return body
    },
  },
  pricing: {
    currency: '$',
    calculator: params => PRICES[variant(params)] * count(params),
    description: '标准版每张 $0.0216、Pro 每张 $0.0544，按成功生成的张数计费，与分辨率和比例无关；输入图不收费',
  },
})

export default apimartWan27ImageModel
