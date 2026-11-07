/** 阿里云百炼官方万相 3.0 视频生成（标准版 / Prime 版，运行时契约） */

import { defineModel } from '../defineModel'
import { resolveUploadedImageSources } from '../shared/mediaPresence'
import type { JsonObject, JsonValue } from '../../types/runtime'

const RATIOS = ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9']
const RESOLUTIONS = ['480P', '720P', '1080P']
// 北京地域刊例价（元/秒），输入与输出视频同价：https://help.aliyun.com/zh/model-studio/model-pricing
// 标准版当前限时 7 折，按原价预估，避免折扣结束后低估费用。
const RATES: Record<string, Record<string, number>> = {
  standard: { '480P': 0.3, '720P': 0.6, '1080P': 1.2 },
  prime: { '480P': 0.45, '720P': 0.9, '1080P': 1.8 },
}

function duration(params: JsonObject): number {
  return Math.min(30, Math.max(2, Math.round(Number(params.bailianWan30Duration || 5))))
}

function resolution(params: JsonObject): string {
  return RESOLUTIONS.includes(String(params.bailianWan30Resolution)) ? String(params.bailianWan30Resolution) : '720P'
}

export const bailianWan30Model = defineModel({
  meta: {
    id: 'bailian-wan-3.0', canonicalModelId: 'wan-3.0', seriesId: 'wan', seriesRank: 3,
    provider: 'bailian', type: 'video',
    tags: ['text-to-video', 'image-to-video', 'start-end-frame', 'reference-mode'],
    polling: { interval: 15000, maxAttempts: 120, expectedAttempts: 16 },
  },
  // 百炼参考视频、参考音频只收公网 URL 或 oss:// 临时地址，生成链路尚未接百炼临时上传，暂只开放图片。
  inputLimits: {
    images: { max: 2 }, videos: { max: 0 }, audios: { max: 0 },
    rules: [{ when: 'bailianWan30Mode === "reference-to-video"', images: { max: 10 }, videos: { max: 0 }, audios: { max: 0 } }],
  },
  params: [
    { id: 'bailianWan30Variant', type: 'dropdown', order: 1, default: 'standard', options: [{ value: 'standard' }, { value: 'prime' }] },
    { id: 'bailianWan30Mode', type: 'dropdown', order: 2, default: 'text-image-to-video', options: [{ value: 'text-image-to-video' }, { value: 'reference-to-video' }] },
    { id: 'bailianWan30AspectRatio', type: 'dropdown', order: 3, default: 'smart', options: [{ value: 'smart' }, ...RATIOS.map(value => ({ value }))] },
    { id: 'bailianWan30Resolution', type: 'dropdown', order: 4, default: '720P', options: RESOLUTIONS.map(value => ({ value })) },
    { id: 'bailianWan30Duration', type: 'number', order: 5, default: 5, min: 2, max: 30, step: 1 },
    { id: 'bailianWan30Audio', type: 'switch', order: 6, default: true },
  ],
  endpoints: '/api/v1/services/aigc/video-generation/video-synthesis',
  request: {
    builder: (params) => {
      const images = resolveUploadedImageSources(params)
      const reference = params.bailianWan30Mode === 'reference-to-video'
      const prompt = typeof params.prompt === 'string' ? params.prompt.slice(0, 20000) : ''
      const rawRatio = String(params.bailianWan30AspectRatio || 'smart')
      const media: JsonValue[] = reference
        ? images.slice(0, 10).map(url => ({ type: 'reference_image', url }))
        : images.slice(0, 2).map((url, index) => ({ type: index === 0 ? 'first_frame' : 'last_frame', url }))
      if (!reference && images.length > 2) throw new Error('万相 3.0 首尾帧最多 2 张图片')
      if (!prompt.trim() && media.length === 0) throw new Error('万相 3.0 需要填写提示词或上传图片')
      const input: JsonObject = {}
      if (prompt.trim()) input.prompt = prompt
      if (media.length > 0) input.media = media
      return {
        model: params.bailianWan30Variant === 'prime' ? 'wan3.0-video-prime' : 'wan3.0-video',
        input,
        parameters: {
          // 官方默认 1080P（最贵），始终显式发送所选分辨率。
          resolution: resolution(params),
          // 智能比例交给模型按素材与意图自适应。
          ratio: RATIOS.includes(rawRatio) ? rawRatio : 'adaptive',
          duration: duration(params),
          audio: params.bailianWan30Audio !== false,
          watermark: false,
        },
      }
    },
  },
  pricing: {
    currency: '¥',
    calculator: (params) => {
      const variant = params.bailianWan30Variant === 'prime' ? 'prime' : 'standard'
      return RATES[variant][resolution(params)] * duration(params)
    },
    description: '标准版每秒 480P ¥0.3、720P ¥0.6、1080P ¥1.2（当前限时 7 折，按原价预估）；Prime 每秒 480P ¥0.45、720P ¥0.9、1080P ¥1.8；开关声音同价',
  },
})

export default bailianWan30Model
