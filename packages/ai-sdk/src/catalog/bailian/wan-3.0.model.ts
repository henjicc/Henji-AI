/** 阿里云百炼官方万相 3.0 视频生成（标准版 / Prime 版，运行时契约） */

import { defineModel } from '../defineModel'
import { resolveUploadedImageSources, resolveUploadedVideoDurationSeconds, resolveUploadedVideoSources } from '../shared/mediaPresence'
import type { JsonObject, JsonValue } from '../../types/runtime'

const RATIOS = ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9']
const RESOLUTIONS = ['480P', '720P', '1080P']
// 北京地域刊例价（元/秒），输入与输出视频同价：https://help.aliyun.com/zh/model-studio/model-pricing
// 标准版当前限时 7 折，按原价预估，避免折扣结束后低估费用。
const RATES: Record<string, Record<string, number>> = {
  standard: { '480P': 0.3, '720P': 0.6, '1080P': 1.2 },
  prime: { '480P': 0.45, '720P': 0.9, '1080P': 1.8 },
}

function audioSources(params: JsonObject): string[] {
  const pick = (value: JsonValue): string[] => Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : []
  const uploaded = pick(params.uploadedAudioFilePaths)
  return uploaded.length > 0 ? uploaded : pick(params.audios)
}

function duration(params: JsonObject): number {
  return Math.min(30, Math.max(2, Math.round(Number(params.bailianWan30Duration || 5))))
}

/** 有参考视频时官方要求输入总时长 + 输出时长 ≤ 30 秒；读得到素材时长就把输出时长收进这个范围。 */
function outputDuration(params: JsonObject): number {
  if (params.bailianWan30Mode !== 'reference-to-video' || resolveUploadedVideoSources(params).length === 0) return duration(params)
  return Math.max(2, Math.min(duration(params), 30 - Math.ceil(resolveUploadedVideoDurationSeconds(params))))
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
  // 参考视频、参考音频各最多 5 段（单段 1–15 秒、合计 ≤ 15 秒），本地文件经百炼临时存储上传成 oss:// 地址。
  inputLimits: {
    images: { max: 2 }, videos: { max: 0 }, audios: { max: 0 },
    rules: [
      { when: 'bailianWan30Mode === "reference-to-video"', images: { max: 10 }, videos: { max: 5 }, audios: { max: 5 } },
      { imageConstraints: { minShortSidePx: 240, maxLongSidePx: 8000, minAspectRatio: 1 / 8, maxAspectRatio: 8 } },
    ],
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
        ? [
            ...images.slice(0, 10).map(url => ({ type: 'reference_image', url })),
            ...resolveUploadedVideoSources(params).slice(0, 5).map(url => ({ type: 'reference_video', url })),
            ...audioSources(params).slice(0, 5).map(url => ({ type: 'reference_audio', url })),
          ]
        : images.slice(0, 2).map((url, index) => ({ type: index === 0 ? 'first_frame' : 'last_frame', url }))
      if (!reference && images.length > 2) throw new Error('万相 3.0 首尾帧最多 2 张图片')
      if (!prompt.trim() && media.length === 0) throw new Error('万相 3.0 需要填写提示词或上传素材')
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
          duration: outputDuration(params),
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
      // 输入视频与输出同价按秒计；读不到参考视频时长时按输出时长估，并封顶到合计 15 秒。
      const inputSeconds = params.bailianWan30Mode === 'reference-to-video' && resolveUploadedVideoSources(params).length > 0
        ? Math.min(15, resolveUploadedVideoDurationSeconds(params, duration(params)))
        : 0
      return RATES[variant][resolution(params)] * (outputDuration(params) + inputSeconds)
    },
    description: '标准版每秒 480P ¥0.3、720P ¥0.6、1080P ¥1.2（当前限时 7 折，按原价预估）；Prime 每秒 480P ¥0.45、720P ¥0.9、1080P ¥1.8；参考视频的时长与输出同价计入；开关声音同价',
  },
})

export default bailianWan30Model
