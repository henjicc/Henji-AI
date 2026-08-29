/** APIMart MiniMax H3 文生、首尾帧与多模态参考视频模型（运行时契约） */

import { defineModel } from '../defineModel'
import { countUploadedImages, resolveUploadedVideoDurationSeconds } from '../shared/mediaPresence'
import type { JsonValue, JsonObject } from '../../types/runtime'

export const apimartMiniMaxH3Model = defineModel({
  meta: {
    id: 'apimart-minimax-h3', canonicalModelId: 'minimax-h3', seriesId: 'minimax-video', seriesRank: 3,
    provider: 'apimart', type: 'video',
    tags: ['text-to-video', 'image-to-video', 'start-end-frame', 'reference-mode', 'multi-mode-switch', 'mixed-upload-mode', 'provider-apimart'],
    aliases: ['minimax-h3-apimart'], polling: { interval: 5000, maxAttempts: 180, expectedAttempts: 60 }
  },
  inputLimits: {
    images: { max: 2 }, videos: { max: 0 }, audios: { max: 0 },
    rules: [{
      when: 'apimartMiniMaxH3Mode === "reference-to-video"',
      images: { max: 9 }, videos: { max: 3 }, audios: { max: 3 }
    }]
  },
  params: [
    {
      id: 'apimartMiniMaxH3Mode', type: 'dropdown', order: 1,
      default: 'text-image-to-video',
      options: [
        { value: 'text-image-to-video' },
        { value: 'reference-to-video' }
      ]
    },
    {
      id: 'apimartMiniMaxH3AspectRatio', type: 'dropdown', order: 2,
      default: 'smart',
      options: [
        { value: 'smart' },
        ...['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'].map((ratio) => ({ value: ratio }))
      ]
    },
    {
      id: 'apimartMiniMaxH3Resolution', type: 'dropdown', order: 3,
      default: '2K',
      options: ['768P', '2K'].map((value) => ({ value }))
    },
    {
      id: 'apimartMiniMaxH3Duration', type: 'number', order: 4,
      default: 5, min: 4, max: 15, step: 1
    }
  ],
  endpoints: '/v1/videos/generations',
  request: {
    builder: (params) => {
      const filterSources = (value: JsonValue): string[] => Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : []
      const pickSources = (primary: JsonValue, fallback: JsonValue): string[] => {
        const preferred = filterSources(primary)
        return preferred.length > 0 ? preferred : filterSources(fallback)
      }
      const images = pickSources(params.uploadedFilePaths, params.images)
      const videos = pickSources(params.uploadedVideoFilePaths, params.videos)
      const audios = pickSources(params.uploadedAudioFilePaths, params.audios)
      const supported = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16']
      const raw = String(params.apimartMiniMaxH3AspectRatio || 'smart')
      let aspectRatio = supported.includes(raw) ? raw : '16:9'
      const referenceMode = params.apimartMiniMaxH3Mode === 'reference-to-video'
      if ((raw === 'smart' || raw === 'auto' || raw === 'adaptive') && referenceMode) aspectRatio = 'adaptive'
      const body: JsonObject = {
        model: 'MiniMax-H3', prompt: typeof params.prompt === 'string' ? params.prompt.trim().slice(0, 7000) : '',
        duration: Math.min(15, Math.max(4, Math.round(Number(params.apimartMiniMaxH3Duration || 5)))),
        resolution: params.apimartMiniMaxH3Resolution === '768P' ? '768P' : '2K',
        nsfw_check: false
      }
      if (!body.prompt) throw new Error('MiniMax H3 的提示词不能为空')
      if (referenceMode) {
        if (audios.length > 0 && images.length + videos.length === 0) {
          throw new Error('MiniMax H3 的参考音频必须与参考图片或参考视频一起使用')
        }
        body.aspect_ratio = aspectRatio
        if (images.length > 0) body.image_urls = images.slice(0, 9)
        if (videos.length > 0) body.video_urls = videos.slice(0, 3)
        if (audios.length > 0) body.audio_urls = audios.slice(0, 3)
      } else if (images.length > 0) {
        body.first_frame_image = images[0]
        if (images[1]) body.last_frame_image = images[1]
      } else {
        body.aspect_ratio = aspectRatio
      }
      return body
    }
  },
  pricing: {
    currency: '$',
    calculator: (params) => {
      const duration = Math.min(15, Math.max(4, Math.round(Number(params.apimartMiniMaxH3Duration || 5))))
      const rate = params.apimartMiniMaxH3Resolution === '2K' ? 0.09144 : 0.05712
      const referenceMode = params.apimartMiniMaxH3Mode === 'reference-to-video'
      const inputVideoDuration = referenceMode ? resolveUploadedVideoDurationSeconds(params) : 0
      const extraImages = referenceMode ? Math.max(0, countUploadedImages(params) - 5) : 0
      return (duration + inputVideoDuration) * rate + extraImages * 0.02288
    },
    description: '768P $0.05712/秒，2K $0.09144/秒；参考视频按时长同价计费，参考图前 5 张免费，之后 $0.02288/张'
  }
})

export default apimartMiniMaxH3Model
