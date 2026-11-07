/** APIMart Wan 3.0 / Wan 3.0 Prime 视频模型（运行时契约） */

import { defineModel } from '../defineModel'
import {
  resolveUploadedImageSources, resolveUploadedVideoDurationSeconds, resolveUploadedVideoSources,
} from '../shared/mediaPresence'
import type { JsonObject, JsonValue } from '../../types/runtime'

const RATIOS = ['16:9', '4:3', '1:1', '3:4', '9:16']
const RESOLUTIONS = ['480P', '720P', '1080P']
const RATES: Record<string, Record<string, number>> = {
  standard: { '480P': 0.03288, '720P': 0.06575, '1080P': 0.1315 },
  prime: { '480P': 0.05143, '720P': 0.10286, '1080P': 0.20571 },
}

function audioSources(params: JsonObject): string[] {
  const pick = (value: JsonValue): string[] => Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : []
  const uploaded = pick(params.uploadedAudioFilePaths)
  return uploaded.length > 0 ? uploaded : pick(params.audios)
}

function duration(params: JsonObject): number {
  return Math.min(30, Math.max(2, Math.round(Number(params.apimartWan30Duration || 5))))
}

function resolution(params: JsonObject): string {
  return RESOLUTIONS.includes(String(params.apimartWan30Resolution)) ? String(params.apimartWan30Resolution) : '720P'
}

export const apimartWan30Model = defineModel({
  meta: {
    id: 'apimart-wan-3.0', canonicalModelId: 'wan-3.0', seriesId: 'wan', seriesRank: 3,
    provider: 'apimart', type: 'video',
    tags: ['text-to-video', 'image-to-video', 'start-end-frame', 'reference-mode'],
    polling: { interval: 5000, maxAttempts: 240, expectedAttempts: 50 },
  },
  inputLimits: {
    images: { max: 2 }, videos: { max: 0 }, audios: { max: 0 },
    rules: [
      { when: 'apimartWan30Mode === "reference-to-video"', images: { max: 10 }, videos: { max: 5 }, audios: { max: 5 } },
      { videoConstraints: { minDurationSec: 1, maxDurationSec: 15 } },
    ],
  },
  params: [
    { id: 'apimartWan30Variant', type: 'dropdown', order: 1, default: 'standard', options: [{ value: 'standard' }, { value: 'prime' }] },
    { id: 'apimartWan30Mode', type: 'dropdown', order: 2, default: 'text-image-to-video', options: [{ value: 'text-image-to-video' }, { value: 'reference-to-video' }] },
    { id: 'apimartWan30AspectRatio', type: 'dropdown', order: 3, default: 'smart', options: [{ value: 'smart' }, ...RATIOS.map(value => ({ value }))] },
    { id: 'apimartWan30Resolution', type: 'dropdown', order: 4, default: '720P', options: RESOLUTIONS.map(value => ({ value })) },
    { id: 'apimartWan30Duration', type: 'number', order: 5, default: 5, min: 2, max: 30, step: 1 },
    { id: 'apimartWan30Audio', type: 'switch', order: 6, default: true },
  ],
  endpoints: '/v1/videos/generations',
  request: {
    builder: (params) => {
      const images = resolveUploadedImageSources(params)
      const videos = resolveUploadedVideoSources(params)
      const audios = audioSources(params)
      const reference = params.apimartWan30Mode === 'reference-to-video'
      const prompt = typeof params.prompt === 'string' ? params.prompt.slice(0, 20000) : ''
      const rawRatio = String(params.apimartWan30AspectRatio || 'smart')
      const body: JsonObject = {
        model: params.apimartWan30Variant === 'prime' ? 'wan3.0-video-prime' : 'wan3.0-video',
        resolution: resolution(params),
        duration: duration(params),
        audio: params.apimartWan30Audio !== false,
        nsfw_check: false,
      }
      if (prompt.trim()) body.prompt = prompt
      // 智能比例交给模型自适应：有素材时跟随素材，无素材时由提示词决定。
      body.size = RATIOS.includes(rawRatio) ? rawRatio : 'adaptive'

      if (reference) {
        if (images.length + videos.length + audios.length === 0) throw new Error('Wan 3.0 参考生视频至少需要一份参考素材')
        const inputSeconds = resolveUploadedVideoDurationSeconds(params)
        if (inputSeconds > 0 && inputSeconds + duration(params) > 30) throw new Error('Wan 3.0 输入视频总时长加输出时长不能超过 30 秒')
        body.generation_type = 'reference'
        if (images.length > 0) body.image_urls = images.slice(0, 10)
        if (videos.length > 0) body.video_urls = videos.slice(0, 5)
        if (audios.length > 0) body.audio_urls = audios.slice(0, 5)
        if (!body.prompt) throw new Error('Wan 3.0 参考生视频需要填写提示词')
        return body
      }

      if (images.length > 2) throw new Error('Wan 3.0 首尾帧最多 2 张图片')
      if (!body.prompt && images.length === 0) throw new Error('Wan 3.0 文生视频需要填写提示词')
      if (images.length > 0) {
        body.generation_type = 'frame'
        body.image_urls = images
      }
      return body
    },
  },
  pricing: {
    currency: '$',
    calculator: (params) => {
      const variant = params.apimartWan30Variant === 'prime' ? 'prime' : 'standard'
      return RATES[variant][resolution(params)] * duration(params)
    },
    description: 'Wan 3.0 每秒 480P $0.03288、720P $0.06575、1080P $0.1315；Prime 每秒 480P $0.05143、720P $0.10286、1080P $0.20571；开关声音同价',
  },
})

export default apimartWan30Model
