/** APIMart FLUX 3 Image 与 FLUX 3 Image Klein 统一模型（运行时契约） */

import { defineModel } from '../defineModel'
import { hasUploadedImage, resolveUploadedImageSources } from '../shared/mediaPresence'
import type { JsonObject } from '../../types/runtime'

const RATIOS = ['21:9', '2:1', '16:9', '3:2', '7:5', '4:3', '5:4', '1:1', '4:5', '3:4', '5:7', '2:3', '9:16', '1:2', '9:21']
const RESOLUTIONS = ['768sq', '1k', '1.5k', '2k', '4k']
const PRICES: Record<string, Record<string, number>> = {
  standard: { '768sq': 0.0328, '1k': 0.0384, '1.5k': 0.056, '2k': 0.08, '4k': 0.4856 },
  klein: { '768sq': 0.0064, '1k': 0.0072, '1.5k': 0.0088, '2k': 0.0112, '4k': 0.0288 },
}

function resolution(params: JsonObject): string {
  return RESOLUTIONS.includes(String(params.apimartFlux3Resolution)) ? String(params.apimartFlux3Resolution) : '1k'
}

function ratio(params: JsonObject): string {
  const raw = String(params.apimartFlux3AspectRatio || 'smart')
  if (RATIOS.includes(raw)) return raw
  const hint = hasUploadedImage(params) && typeof params.__firstImageRatio === 'number'
    && Number.isFinite(params.__firstImageRatio) && params.__firstImageRatio > 0 ? params.__firstImageRatio : 1
  const numeric = (value: string) => { const [w, h] = value.split(':').map(Number); return w / h }
  return RATIOS.reduce((best, next) => Math.abs(numeric(next) - hint) < Math.abs(numeric(best) - hint) ? next : best, '1:1')
}

export const apimartFlux3ImageModel = defineModel({
  meta: {
    id: 'apimart-flux-3-image', canonicalModelId: 'flux-3-image', seriesId: 'flux', seriesRank: 3,
    provider: 'apimart', type: 'image',
    tags: ['text-to-image', 'image-to-image'],
    polling: { interval: 3000, maxAttempts: 200, expectedAttempts: 30 },
  },
  inputLimits: { images: { max: 10 }, videos: { max: 0 } },
  params: [
    { id: 'apimartFlux3Variant', type: 'dropdown', order: 1, default: 'standard', options: [{ value: 'standard' }, { value: 'klein' }] },
    { id: 'apimartFlux3AspectRatio', type: 'dropdown', order: 2, default: 'smart', options: [{ value: 'smart' }, ...RATIOS.map(value => ({ value }))] },
    { id: 'apimartFlux3Resolution', type: 'dropdown', order: 3, default: '1k', options: RESOLUTIONS.map(value => ({ value })) },
  ],
  endpoints: '/v1/images/generations',
  request: {
    builder: (params) => {
      const prompt = typeof params.prompt === 'string' ? params.prompt.trim() : ''
      if (!prompt) throw new Error('请输入 FLUX 3 Image 提示词')
      const images = resolveUploadedImageSources(params)
      if (images.length > 10) throw new Error('FLUX 3 Image 最多支持 10 张参考图')
      const body: JsonObject = {
        model: params.apimartFlux3Variant === 'klein' ? 'flux-3-image-klein' : 'flux-3-image',
        prompt,
        aspect_ratio: ratio(params),
        resolution: resolution(params),
        n: 1,
      }
      if (images.length > 0) body.image_urls = images
      return body
    },
  },
  pricing: {
    currency: '$',
    calculator: (params) => PRICES[params.apimartFlux3Variant === 'klein' ? 'klein' : 'standard'][resolution(params)],
    description: 'FLUX 3 Image 每张 768sq $0.0328、1k $0.0384、1.5k $0.056、2k $0.08、4k $0.4856；Klein 每张 768sq $0.0064、1k $0.0072、1.5k $0.0088、2k $0.0112、4k $0.0288；参考图不另收费',
  },
})

export default apimartFlux3ImageModel
