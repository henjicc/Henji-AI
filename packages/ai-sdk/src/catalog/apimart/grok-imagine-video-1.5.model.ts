/** APIMart Grok Imagine Video 1.5 官方与 Ext 渠道统一模型（运行时契约） */

import { defineModel } from '../defineModel'
import { countUploadedImages, hasUploadedImage, resolveUploadedImageSources } from '../shared/mediaPresence'
import type { JsonObject } from '../../types/runtime'

const OFFICIAL_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3']
const EXT_RATIOS = ['16:9', '9:16', '1:1', '3:2', '2:3']
const OFFICIAL_RATES: Record<string, number> = { '480p': 0.064, '720p': 0.112, '1080p': 0.2 }
const EXT_RATES: Record<string, number> = { '480p': 0.0102, '720p': 0.01912 }

function isExt(params: JsonObject): boolean {
  return params.apimartGrokVideo15Channel === 'ext'
}

function resolution(params: JsonObject): string {
  const allowed = isExt(params) ? ['480p', '720p'] : ['480p', '720p', '1080p']
  return allowed.includes(String(params.apimartGrokVideo15Resolution)) ? String(params.apimartGrokVideo15Resolution) : '480p'
}

/** 官方 1–15 秒，Ext 6–15 秒。 */
function duration(params: JsonObject): number {
  return Math.min(15, Math.max(isExt(params) ? 6 : 1, Math.round(Number(params.apimartGrokVideo15Duration || 8))))
}

function ratio(params: JsonObject): string {
  const candidates = isExt(params) ? EXT_RATIOS : OFFICIAL_RATIOS
  const raw = String(params.apimartGrokVideo15AspectRatio || 'smart')
  if (candidates.includes(raw)) return raw
  const hint = hasUploadedImage(params) && typeof params.__firstImageRatio === 'number'
    && Number.isFinite(params.__firstImageRatio) && params.__firstImageRatio > 0 ? params.__firstImageRatio : 16 / 9
  const numeric = (value: string) => { const [w, h] = value.split(':').map(Number); return w / h }
  return candidates.reduce((best, next) => Math.abs(numeric(next) - hint) < Math.abs(numeric(best) - hint) ? next : best, '16:9')
}

export const apimartGrokImagineVideo15Model = defineModel({
  meta: {
    id: 'apimart-grok-imagine-video-1.5', canonicalModelId: 'grok-imagine-video-1.5',
    seriesId: 'grok-imagine-video', seriesRank: 1.5, provider: 'apimart', type: 'video',
    tags: ['text-to-video', 'image-to-video', 'reference-mode'],
    polling: { interval: 4000, maxAttempts: 180, expectedAttempts: 40 },
  },
  inputLimits: { images: { max: 7 }, videos: { max: 0 } },
  requirements: [{
    id: 'apimart-grok-video-15-prompt',
    require: { prompt: true },
    message: { title: '提示词必需', message: 'Grok Imagine Video 1.5 需要填写提示词。', type: 'warning' },
  }],
  params: [
    { id: 'apimartGrokVideo15Channel', type: 'dropdown', order: 1, default: 'official', options: [{ value: 'official' }, { value: 'ext' }] },
    { id: 'apimartGrokVideo15AspectRatio', type: 'dropdown', order: 2, default: 'smart', options: [{ value: 'smart' }, ...OFFICIAL_RATIOS.map(value => ({ value }))] },
    { id: 'apimartGrokVideo15Resolution', type: 'dropdown', order: 3, default: '480p', options: ['480p', '720p', '1080p'].map(value => ({ value })) },
    { id: 'apimartGrokVideo15Duration', type: 'number', order: 4, default: 8, min: 1, max: 15, step: 1 },
  ],
  endpoints: '/v1/videos/generations',
  request: {
    builder: (params) => {
      const prompt = typeof params.prompt === 'string' ? params.prompt.trim() : ''
      if (!prompt) throw new Error('Grok Imagine Video 1.5 需要填写提示词')
      if (Array.from(prompt).length > 8000) throw new Error('Grok Imagine Video 1.5 提示词最多 8000 字符')
      const images = resolveUploadedImageSources(params)
      if (images.length > 7) throw new Error('Grok Imagine Video 1.5 最多支持 7 张参考图')
      const ext = isExt(params)
      const body: JsonObject = {
        model: ext ? 'grok-imagine-1.5-video-ext' : 'grok-imagine-video-1.5',
        prompt,
        duration: duration(params),
        resolution: resolution(params),
        nsfw_check: false,
      }
      // Ext 用 size 传比例，官方用 aspect_ratio。
      if (ext) body.size = ratio(params)
      else body.aspect_ratio = ratio(params)
      if (images.length > 0) body.image_urls = images
      return body
    },
  },
  pricing: {
    currency: '$',
    calculator: (params) => isExt(params)
      ? EXT_RATES[resolution(params)] * duration(params)
      : OFFICIAL_RATES[resolution(params)] * duration(params) + countUploadedImages(params) * 0.008,
    description: '官方渠道 480p $0.064、720p $0.112、1080p $0.2 每秒，参考图 $0.008/张；Ext 渠道 480p $0.0102、720p $0.01912 每秒',
  },
})

export default apimartGrokImagineVideo15Model
