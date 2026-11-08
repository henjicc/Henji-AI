/** APIMart MiniMax H3 Max 文生、首尾帧与多模态参考视频模型（运行时契约） */

import { defineModel } from '../defineModel'
import { countUploadedImages, resolveUploadedImageSources, resolveUploadedVideoDurationSeconds, resolveUploadedVideoSources, hasUploadedImage } from '../shared/mediaPresence'
import type { JsonObject, JsonValue } from '../../types/runtime'

const RATIOS = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16']
const RESOLUTIONS = ['480P', '768P', '1080P']
const OUTPUT_RATES: Record<string, number> = { '480P': 0.03768, '768P': 0.05712, '1080P': 0.128 }
const VIDEO_INPUT_RATES: Record<string, number> = { '480P': 0.04232, '768P': 0.11088, '1080P': 0.11936 }

function resolution(params: JsonObject): string {
  return RESOLUTIONS.includes(String(params.apimartMiniMaxH3MaxResolution)) ? String(params.apimartMiniMaxH3MaxResolution) : '768P'
}

function duration(params: JsonObject): number {
  return Math.min(15, Math.max(5, Math.round(Number(params.apimartMiniMaxH3MaxDuration || 5))))
}

function audioSources(params: JsonObject): string[] {
  const pick = (value: JsonValue): string[] => Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : []
  const uploaded = pick(params.uploadedAudioFilePaths)
  return uploaded.length > 0 ? uploaded : pick(params.audios)
}

export const apimartMiniMaxH3MaxModel = defineModel({
  meta: {
    id: 'apimart-minimax-h3-max', canonicalModelId: 'minimax-h3-max', seriesId: 'hailuo', seriesRank: 3.1,
    provider: 'apimart', type: 'video',
    tags: ['text-to-video', 'image-to-video', 'start-end-frame', 'reference-mode'],
    polling: { interval: 5000, maxAttempts: 180, expectedAttempts: 50 },
  },
  inputLimits: {
    images: { max: 2 }, videos: { max: 0 }, audios: { max: 0 },
    rules: [
      { when: 'apimartMiniMaxH3MaxMode === "reference-to-video"', images: { max: 9 }, videos: { max: 3 }, audios: { max: 3 } },
      { videoConstraints: { minDurationSec: 2, maxDurationSec: 15, maxSizeMB: 50 },
        imageConstraints: { minShortSidePx: 256, maxLongSidePx: 5760, minAspectRatio: 0.4, maxAspectRatio: 2.5 } },
    ],
  },
  requirements: [{
    id: 'apimart-minimax-h3-max-prompt',
    require: { prompt: true },
    message: { title: '提示词必需', message: 'MiniMax H3 Max 需要填写提示词。', type: 'warning' },
  }],
  params: [
    {
      id: 'apimartMiniMaxH3MaxMode', type: 'dropdown', order: 1, default: 'text-image-to-video',
      options: [{ value: 'text-image-to-video' }, { value: 'reference-to-video' }],
    },
    { id: 'apimartMiniMaxH3MaxAspectRatio', type: 'dropdown', order: 2, visible: { condition: (params) => params.apimartMiniMaxH3MaxMode === 'reference-to-video' || !hasUploadedImage(params) }, default: 'smart', options: [{ value: 'smart' }, ...RATIOS.map(value => ({ value }))] },
    { id: 'apimartMiniMaxH3MaxResolution', type: 'dropdown', order: 3, default: '768P', options: RESOLUTIONS.map(value => ({ value })) },
    { id: 'apimartMiniMaxH3MaxDuration', type: 'number', order: 4, default: 5, min: 5, max: 15, step: 1 },
  ],
  endpoints: '/v1/videos/generations',
  request: {
    builder: (params) => {
      const images = resolveUploadedImageSources(params)
      const videos = resolveUploadedVideoSources(params)
      const audios = audioSources(params)
      const prompt = typeof params.prompt === 'string' ? params.prompt.trim() : ''
      if (!prompt) throw new Error('MiniMax H3 Max 的提示词不能为空')
      if (prompt.length > 7000) throw new Error('MiniMax H3 Max 提示词最多 7000 字符')
      const raw = String(params.apimartMiniMaxH3MaxAspectRatio || 'smart')
      const body: JsonObject = {
        model: 'MiniMax-H3-Max', prompt, duration: duration(params), resolution: resolution(params),
      }
      if (params.apimartMiniMaxH3MaxMode === 'reference-to-video') {
        if (images.length + videos.length === 0) throw new Error('MiniMax H3 Max 参考生视频至少需要一张参考图或一段参考视频')
        body.aspect_ratio = RATIOS.includes(raw) ? raw : 'adaptive'
        if (images.length > 0) body.image_urls = images.slice(0, 9)
        if (videos.length > 0) body.video_urls = videos.slice(0, 3)
        if (audios.length > 0) body.audio_urls = audios.slice(0, 3)
      } else if (images.length > 0) {
        // 图生视频的比例由输入图片决定，不发送比例。
        body.first_frame_image = images[0]
        if (images[1]) body.last_frame_image = images[1]
      } else {
        body.aspect_ratio = RATIOS.includes(raw) ? raw : '16:9'
      }
      return body
    },
  },
  pricing: {
    currency: '$',
    calculator: (params) => {
      const tier = resolution(params)
      const reference = params.apimartMiniMaxH3MaxMode === 'reference-to-video'
      // 读不到素材时长时按输出时长估，不按 0 秒低估；平台规定参考视频合计不超过 15 秒。
      const videoSeconds = reference ? Math.min(15, resolveUploadedVideoDurationSeconds(params, duration(params))) : 0
      return OUTPUT_RATES[tier] * duration(params)
        + Math.max(0, countUploadedImages(params) - 2) * 0.05712
        + VIDEO_INPUT_RATES[tier] * videoSeconds
    },
    description: '每秒 480P $0.03768、768P $0.05712、1080P $0.128；输入图片前 2 张免费，之后 $0.05712/张；参考视频按源时长每秒 480P $0.04232、768P $0.11088、1080P $0.11936；参考音频免费',
  },
})

export default apimartMiniMaxH3MaxModel
