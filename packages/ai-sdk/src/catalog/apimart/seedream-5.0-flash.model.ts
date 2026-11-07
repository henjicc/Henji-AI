/** APIMart Seedream 5.0 Flash 图片生成与编辑模型（运行时契约） */

import { defineModel } from '../defineModel'
import { hasUploadedImage, resolveUploadedImageSources } from '../shared/mediaPresence'
import type { JsonObject } from '../../types/runtime'

const RATIOS = ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '2:1', '1:2', '21:9']
const RESOLUTIONS = ['1K', '1.5K', '2K']

function ratio(params: JsonObject): string {
  const raw = String(params.apimartSeedream50FlashAspectRatio || 'smart')
  if (RATIOS.includes(raw)) return raw
  const hint = hasUploadedImage(params) && typeof params.__firstImageRatio === 'number'
    && Number.isFinite(params.__firstImageRatio) && params.__firstImageRatio > 0 ? params.__firstImageRatio : 1
  const numeric = (value: string) => { const [w, h] = value.split(':').map(Number); return w / h }
  return RATIOS.reduce((best, next) => Math.abs(numeric(next) - hint) < Math.abs(numeric(best) - hint) ? next : best, '1:1')
}

export const apimartSeedream50FlashModel = defineModel({
  meta: {
    id: 'apimart-seedream-5.0-flash', canonicalModelId: 'seedream-5.0-flash', seriesId: 'seedream', seriesRank: 5.05,
    provider: 'apimart', type: 'image',
    tags: ['text-to-image', 'image-to-image'],
    polling: { interval: 3000, maxAttempts: 200, expectedAttempts: 30 },
  },
  inputLimits: { images: { max: 10 }, videos: { max: 0 } },
  params: [
    { id: 'apimartSeedream50FlashAspectRatio', type: 'dropdown', order: 1, default: 'smart', options: [{ value: 'smart' }, ...RATIOS.map(value => ({ value }))] },
    // 1.5K 与 1K 同价、画质更好，所以默认 1.5K。
    { id: 'apimartSeedream50FlashResolution', type: 'dropdown', order: 2, default: '1.5K', options: RESOLUTIONS.map(value => ({ value })) },
  ],
  endpoints: '/v1/images/generations',
  request: {
    builder: (params) => {
      const images = resolveUploadedImageSources(params)
      if (images.length > 10) throw new Error('Seedream 5.0 Flash 最多支持 10 张参考图')
      const body: JsonObject = {
        model: 'seedream-5-0-flash',
        prompt: typeof params.prompt === 'string' ? params.prompt : '',
        size: ratio(params),
        resolution: RESOLUTIONS.includes(String(params.apimartSeedream50FlashResolution)) ? String(params.apimartSeedream50FlashResolution) : '1.5K',
        n: 1,
      }
      if (images.length > 0) body.image_urls = images
      return body
    },
  },
  pricing: {
    currency: '$',
    fixed: 0.01371,
    description: '1K / 1.5K / 2K 统一 $0.01371/张',
  },
})

export default apimartSeedream50FlashModel
