/** APIMart Veo 3.1 Ext 与官方渠道统一模型（运行时契约） */

import { defineModel } from '../defineModel'
import { resolveUploadedImageSources } from '../shared/mediaPresence'
import type { JsonObject } from '../../types/runtime'

const RESOLUTIONS = ['720p', '1080p', '4k']
const EXT_PRICES: Record<string, { standard: number; uhd: number }> = {
  fast: { standard: 0.14, uhd: 0.64 },
  quality: { standard: 1, uhd: 1.5 },
  lite: { standard: 0.07, uhd: 0.57 },
}
const OFFICIAL_RATES: Record<string, Record<string, [number, number]>> = {
  fast: { '720p': [0.064, 0.08], '1080p': [0.08, 0.096], '4k': [0.2, 0.24] },
  quality: { '720p': [0.16, 0.32], '1080p': [0.16, 0.32], '4k': [0.32, 0.48] },
}

function isOfficial(params: JsonObject): boolean {
  return params.apimartVeo31Channel === 'official'
}

/** 官方渠道没有 Lite，切到官方时按 Fast 处理。 */
function variant(params: JsonObject): 'fast' | 'quality' | 'lite' {
  const value = params.apimartVeo31Variant
  if (value === 'quality') return 'quality'
  if (value === 'lite' && !isOfficial(params)) return 'lite'
  return 'fast'
}

function resolution(params: JsonObject): string {
  return RESOLUTIONS.includes(String(params.apimartVeo31Resolution)) ? String(params.apimartVeo31Resolution) : '720p'
}

function officialDuration(params: JsonObject): number {
  const value = Number(params.apimartVeo31Duration)
  return [4, 6, 8].includes(value) ? value : 8
}

export const apimartVeo31Model = defineModel({
  meta: {
    id: 'apimart-veo-3.1', canonicalModelId: 'veo-3.1', provider: 'apimart', type: 'video',
    tags: ['text-to-video', 'image-to-video', 'start-end-frame', 'reference-mode'],
    polling: { interval: 5000, maxAttempts: 240, expectedAttempts: 40 },
  },
  inputLimits: {
    images: { max: 2 }, videos: { max: 0 },
    rules: [
      { when: 'apimartVeo31Channel !== "official" && apimartVeo31Variant === "lite"', images: { max: 0 } },
      { when: 'apimartVeo31Channel !== "official" && apimartVeo31Variant === "fast" && apimartVeo31Mode === "reference-to-video"', images: { min: 1, max: 3 } },
    ],
  },
  requirements: [{
    id: 'apimart-veo-31-prompt',
    require: { prompt: true },
    message: { title: '提示词必需', message: 'Veo 3.1 需要填写提示词。', type: 'warning' },
  }],
  params: [
    { id: 'apimartVeo31Channel', type: 'dropdown', order: 1, default: 'ext', options: [{ value: 'ext' }, { value: 'official' }] },
    { id: 'apimartVeo31Variant', type: 'dropdown', order: 2, default: 'fast', options: [{ value: 'fast' }, { value: 'quality' }, { value: 'lite' }] },
    // 参考图生视频只有 Ext 渠道的 Fast 支持。
    {
      id: 'apimartVeo31Mode', type: 'dropdown', order: 3, default: 'text-image-to-video',
      options: [{ value: 'text-image-to-video' }, { value: 'reference-to-video' }],
      visible: { condition: 'apimartVeo31Channel !== "official" && apimartVeo31Variant === "fast"' },
    },
    { id: 'apimartVeo31AspectRatio', type: 'dropdown', order: 4, default: '16:9', options: [{ value: '16:9' }, { value: '9:16' }] },
    { id: 'apimartVeo31Resolution', type: 'dropdown', order: 5, default: '720p', options: RESOLUTIONS.map(value => ({ value })) },
    // Ext 渠道固定 8 秒。
    {
      id: 'apimartVeo31Duration', type: 'dropdown', order: 6, default: 8, options: [{ value: 4 }, { value: 6 }, { value: 8 }],
      visible: { condition: 'apimartVeo31Channel === "official"' },
    },
    { id: 'apimartVeo31GenerateAudio', type: 'switch', order: 7, default: true, visible: { condition: 'apimartVeo31Channel === "official"' } },
  ],
  endpoints: '/v1/videos/generations',
  request: {
    builder: (params) => {
      const prompt = typeof params.prompt === 'string' ? params.prompt.trim() : ''
      if (!prompt) throw new Error('Veo 3.1 需要填写提示词')
      const images = resolveUploadedImageSources(params)
      const current = variant(params)
      const tier = resolution(params)
      const aspectRatio = params.apimartVeo31AspectRatio === '9:16' ? '9:16' : '16:9'

      if (isOfficial(params)) {
        if (images.length > 2) throw new Error('Veo 3.1 官方渠道最多支持首帧和尾帧 2 张图片')
        const body: JsonObject = {
          model: `veo3.1-${current}-official`, prompt, duration: officialDuration(params), aspect_ratio: aspectRatio,
          resolution: tier === '4k' ? '4K' : tier, generate_audio: params.apimartVeo31GenerateAudio !== false,
          nsfw_check: false,
        }
        if (images[0]) body.first_frame_image = images[0]
        if (images[1]) body.last_frame_image = images[1]
        return body
      }

      const body: JsonObject = {
        model: `veo3.1-${current}`, prompt, duration: 8, aspect_ratio: aspectRatio, resolution: tier, nsfw_check: false,
      }
      if (current === 'lite') {
        if (images.length > 0) throw new Error('Veo 3.1 Lite 不支持参考图')
        return body
      }
      const reference = current === 'fast' && params.apimartVeo31Mode === 'reference-to-video'
      if (reference) {
        if (images.length === 0 || images.length > 3) throw new Error('Veo 3.1 参考图生视频需要 1–3 张参考图')
        body.generation_type = 'reference'
        body.image_urls = images
      } else if (images.length > 0) {
        if (images.length > 2) throw new Error('Veo 3.1 首尾帧最多 2 张图片')
        body.generation_type = 'frame'
        body.image_urls = images
      }
      return body
    },
  },
  pricing: {
    currency: '$',
    calculator: (params) => {
      const current = variant(params)
      const tier = resolution(params)
      if (isOfficial(params)) {
        const rates = OFFICIAL_RATES[current === 'quality' ? 'quality' : 'fast'][tier]
        return rates[params.apimartVeo31GenerateAudio === false ? 0 : 1] * officialDuration(params)
      }
      const prices = EXT_PRICES[current]
      return tier === '4k' ? prices.uhd : prices.standard
    },
    description: 'Ext 渠道每条 8 秒：Fast 720p/1080p $0.14、4k $0.64；Quality $1 / $1.5；Lite $0.07 / $0.57。官方渠道按秒：Fast 720p $0.064（含音频 $0.08）、1080p $0.08（$0.096）、4K $0.2（$0.24）；Quality 720p/1080p $0.16（$0.32）、4K $0.32（$0.48）',
  },
})

export default apimartVeo31Model
