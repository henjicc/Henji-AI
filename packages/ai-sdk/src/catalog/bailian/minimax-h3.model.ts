/** 阿里云百炼托管的 MiniMax H3 视频生成（运行时契约）：https://help.aliyun.com/zh/model-studio/minimax-video-generation-api-reference */

import { defineModel } from '../defineModel'
import {
  countUploadedImages,
  hasUploadedImage,
  resolveUploadedAudioSources,
  resolveUploadedImageSources,
  resolveUploadedVideoDurationSeconds,
  resolveUploadedVideoSources,
} from '../shared/mediaPresence'
import type { JsonObject, JsonValue } from '../../types/runtime'

const RATIOS = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16']
// 北京地域刊例价（元/秒），输入参考视频按生成分辨率同价计费：https://help.aliyun.com/zh/model-studio/minimax-h3
const RATES: Record<string, number> = { '768P': 0.5, '2K': 0.8 }

function resolution(params: JsonObject): string {
  return params.bailianMiniMaxH3Resolution === '768P' ? '768P' : '2K'
}

function duration(params: JsonObject): number {
  return Math.min(15, Math.max(4, Math.round(Number(params.bailianMiniMaxH3Duration || 6))))
}

const isReference = (params: JsonObject) => params.bailianMiniMaxH3Mode === 'reference-to-video'

export const bailianMiniMaxH3Model = defineModel({
  meta: {
    id: 'bailian-minimax-h3', canonicalModelId: 'minimax-h3', seriesId: 'hailuo', seriesRank: 3,
    provider: 'bailian', type: 'video',
    tags: ['text-to-video', 'image-to-video', 'start-end-frame', 'reference-mode'],
    polling: { interval: 15000, maxAttempts: 120, expectedAttempts: 12 },
  },
  // 参考视频、参考音频各最多 3 段（单段 2–15 秒、合计 ≤ 15 秒），本地文件经百炼临时存储上传成 oss:// 地址。
  inputLimits: {
    images: { max: 2 }, videos: { max: 0 }, audios: { max: 0 },
    rules: [
      { when: 'bailianMiniMaxH3Mode === "reference-to-video"', images: { max: 9 }, videos: { max: 3 }, audios: { max: 3 } },
      {
        imageConstraints: { minShortSidePx: 256, maxLongSidePx: 5760, minAspectRatio: 0.4, maxAspectRatio: 2.5 },
        videoConstraints: { minShortSidePx: 256, maxLongSidePx: 5760, minAspectRatio: 0.4, maxAspectRatio: 2.5 },
      },
    ],
  },
  params: [
    { id: 'bailianMiniMaxH3Mode', type: 'dropdown', order: 1, default: 'text-image-to-video', options: [{ value: 'text-image-to-video' }, { value: 'reference-to-video' }] },
    {
      id: 'bailianMiniMaxH3AspectRatio', type: 'dropdown', order: 2, default: 'smart',
      // 图生视频的比例由输入图片决定，官方忽略所传比例。
      visible: { condition: (params: JsonObject) => isReference(params) || !hasUploadedImage(params) },
      options: [{ value: 'smart' }, ...RATIOS.map(value => ({ value }))],
    },
    { id: 'bailianMiniMaxH3Resolution', type: 'dropdown', order: 3, default: '2K', options: [{ value: '768P' }, { value: '2K' }] },
    { id: 'bailianMiniMaxH3Duration', type: 'number', order: 4, default: 6, min: 4, max: 15, step: 1 },
  ],
  endpoints: '/api/v1/services/aigc/video-generation/video-synthesis',
  request: {
    builder: (params) => {
      const prompt = typeof params.prompt === 'string' ? params.prompt.trim().slice(0, 7000) : ''
      if (!prompt) throw new Error('MiniMax H3 的提示词不能为空')
      const images = resolveUploadedImageSources(params)
      const rawRatio = String(params.bailianMiniMaxH3AspectRatio || 'smart')
      const ratio = RATIOS.includes(rawRatio) ? rawRatio : undefined
      const parameters: JsonObject = { resolution: resolution(params), duration: duration(params), watermark: false }
      let media: JsonValue[] = []
      if (isReference(params)) {
        const videos = resolveUploadedVideoSources(params)
        const audios = resolveUploadedAudioSources(params)
        // 参考音频不能单独使用是 MiniMax 上游限制（APIMart 文档写明），百炼文档只列了组合方式。
        if (images.length + videos.length === 0) throw new Error('MiniMax H3 参考生视频至少需要一张参考图或一段参考视频')
        media = [
          ...images.slice(0, 9).map(url => ({ type: 'image_url', url })),
          ...videos.slice(0, 3).map(url => ({ type: 'feature', url })),
          ...audios.slice(0, 3).map(url => ({ type: 'driving_audio', url })),
        ]
        parameters.ratio = ratio ?? 'adaptive'
      } else if (images.length > 0) {
        if (images.length > 2) throw new Error('MiniMax H3 首尾帧最多 2 张图片')
        media = images.map((url, index) => ({ type: index === 0 ? 'first_frame' : 'last_frame', url }))
      } else {
        // 文生视频必须指定具体比例，不接受 adaptive。
        parameters.ratio = ratio ?? '16:9'
      }
      const input: JsonObject = { prompt }
      if (media.length > 0) input.media = media
      return { model: 'MiniMax/MiniMax-H3', input, parameters }
    },
  },
  pricing: {
    currency: '¥',
    calculator: (params) => {
      const rate = RATES[resolution(params)]
      const inputSeconds = isReference(params) && resolveUploadedVideoSources(params).length > 0
        ? Math.min(15, resolveUploadedVideoDurationSeconds(params, 15))
        : 0
      const extraImages = isReference(params) ? Math.max(0, countUploadedImages(params) - 5) : 0
      return rate * (duration(params) + inputSeconds) + extraImages * 0.2
    },
    description: '768P 每秒 ¥0.5，2K 每秒 ¥0.8；参考视频时长按生成分辨率同价计入；参考图 5 张以内免费，超出每张 ¥0.2；音频免费',
  },
})

export default bailianMiniMaxH3Model
