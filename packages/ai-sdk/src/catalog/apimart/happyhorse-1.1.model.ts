/** APIMart HappyHorse 1.1 文生、图生与参考图生视频模型（运行时契约） */

import { defineModel } from '../defineModel'
import { hasUploadedImage, resolveUploadedImageSources } from '../shared/mediaPresence'
import type { JsonObject } from '../../types/runtime'

const RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4']

function duration(params: JsonObject): number {
  return Math.min(15, Math.max(3, Math.round(Number(params.apimartHappyHorse11Duration || 5))))
}

export const apimartHappyHorse11Model = defineModel({
  meta: {
    id: 'apimart-happyhorse-1.1', canonicalModelId: 'happyhorse-1.1', seriesId: 'happyhorse', seriesRank: 1.1,
    provider: 'apimart', type: 'video',
    tags: ['text-to-video', 'image-to-video', 'reference-mode'],
    polling: { interval: 5000, maxAttempts: 180, expectedAttempts: 60 },
  },
  inputLimits: {
    images: { max: 1 }, videos: { max: 0 },
    rules: [
      { imageConstraints: { minShortSidePx: 300, minAspectRatio: 0.4, maxAspectRatio: 2.5 } },
      // 参考图官方只硬性要求短边 / 长边 ≥ 0.4，短边 ≥ 720 px 只是推荐。
      { when: 'apimartHappyHorse11Mode === "reference-to-video"', images: { min: 1, max: 9 }, imageConstraints: { minAspectRatio: 0.4, maxAspectRatio: 2.5 } },
    ],
  },
  params: [
    {
      id: 'apimartHappyHorse11Mode', type: 'dropdown', order: 1, default: 'text-image-to-video',
      options: [{ value: 'text-image-to-video' }, { value: 'reference-to-video' }],
    },
    // 图生视频的比例由首帧决定，平台会忽略 size。
    {
      id: 'apimartHappyHorse11AspectRatio', type: 'dropdown', order: 2, default: 'smart',
      visible: { condition: params => params.apimartHappyHorse11Mode === 'reference-to-video' || !hasUploadedImage(params) },
      options: [{ value: 'smart' }, ...RATIOS.map(value => ({ value }))],
    },
    { id: 'apimartHappyHorse11Resolution', type: 'dropdown', order: 3, default: '1080P', options: [{ value: '720P' }, { value: '1080P' }] },
    { id: 'apimartHappyHorse11Duration', type: 'number', order: 4, default: 5, min: 3, max: 15, step: 1 },
  ],
  endpoints: '/v1/videos/generations',
  request: {
    builder: (params) => {
      const images = resolveUploadedImageSources(params)
      const reference = params.apimartHappyHorse11Mode === 'reference-to-video'
      if (reference ? images.length === 0 || images.length > 9 : images.length > 1) {
        throw new Error(reference ? 'HappyHorse 1.1 参考模式需要 1–9 张图片' : 'HappyHorse 1.1 图生视频只接受 1 张首帧')
      }
      const prompt = typeof params.prompt === 'string' ? params.prompt.trim() : ''
      if (!prompt && (reference || images.length === 0)) throw new Error('HappyHorse 1.1 需要填写提示词')
      if (prompt.length > 2500) throw new Error('HappyHorse 1.1 提示词最多 2500 字符')
      const body: JsonObject = {
        model: 'happyhorse-1.1',
        resolution: params.apimartHappyHorse11Resolution === '720P' ? '720P' : '1080P',
        duration: duration(params),
        nsfw_check: false,
      }
      if (prompt) body.prompt = prompt
      if (!reference && images.length === 1) {
        body.first_frame_image = images[0]
        return body
      }
      const raw = String(params.apimartHappyHorse11AspectRatio || 'smart')
      const hint = hasUploadedImage(params) && typeof params.__firstImageRatio === 'number'
        && Number.isFinite(params.__firstImageRatio) && params.__firstImageRatio > 0 ? params.__firstImageRatio : 16 / 9
      const numeric = (value: string) => { const [w, h] = value.split(':').map(Number); return w / h }
      body.size = RATIOS.includes(raw) ? raw : RATIOS.reduce((best, next) => Math.abs(numeric(next) - hint) < Math.abs(numeric(best) - hint) ? next : best, '16:9')
      if (reference) body.image_urls = images
      return body
    },
  },
  pricing: {
    currency: '$',
    calculator: (params) => duration(params) * (params.apimartHappyHorse11Resolution === '720P' ? 0.13 : 0.172),
    description: '720P $0.13/秒，1080P $0.172/秒；文生、图生、参考图生同价',
  },
})

export default apimartHappyHorse11Model
