/** Fal Seedance 2.0 Mini 多模态视频模型 */

import { defineModel, sharedFieldText, sharedModeText, sharedOptionText } from '@/core'

export const falSeedance20MiniModel = defineModel({
  meta: {
    id: 'fal-ai-seedance-2.0-mini', canonicalModelId: 'seedance-2.0-mini', seriesId: 'seedance', seriesRank: 2.001,
    provider: 'fal', type: 'video', i18nScope: 'models.defs.fal-ai-seedance-2.0-mini',
    name: { key: 'meta.name', fallback: 'Seedance 2.0 Mini' },
    tags: ['text-to-video', 'image-to-video', 'start-end-frame', 'reference-mode', 'mixed-upload-mode', 'supports-audio-generation', 'multi-mode-switch', 'fast-mode', 'provider-fal'],
    aliases: ['seedance-2-mini-fal'], polling: { interval: 3000, maxAttempts: 300, expectedAttempts: 65 }
  },
  inputLimits: {
    images: { max: 2 }, videos: { max: 0 }, audios: { max: 0 },
    rules: [{ when: 'falSeedance20MiniMode === "reference-to-video"', images: { max: 9 }, videos: { max: 3 }, audios: { max: 3 } }]
  },
  params: [
    {
      id: 'falSeedance20MiniMode', type: 'dropdown', order: 1,
      name: sharedFieldText('mode'), default: 'text-image-to-video',
      options: [
        { value: 'text-image-to-video', label: sharedModeText('textImageToVideo') },
        { value: 'reference-to-video', label: sharedModeText('referenceToVideo') }
      ]
    },
    {
      id: 'falSeedance20MiniAspectRatio', type: 'dropdown', order: 2,
      name: sharedFieldText('aspectRatio'), default: 'smart',
      options: [
        { value: 'smart', label: sharedOptionText('smart') },
        ...['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'].map((value) => ({ value, label: value }))
      ]
    },
    {
      id: 'falSeedance20MiniResolution', type: 'dropdown', order: 3,
      name: sharedFieldText('resolution'), default: '720p',
      options: ['480p', '720p'].map((value) => ({ value, label: value }))
    },
    {
      id: 'falSeedance20MiniDuration', type: 'number', order: 4,
      name: sharedFieldText('duration'), default: 5, min: 4, max: 15, step: 1
    },
    {
      id: 'falSeedance20MiniGenerateAudio', type: 'switch', order: 5,
      name: sharedFieldText('generateAudio'), default: true
    }
  ],
  linkages: [],
  endpoints: {
    selector: async (params) => {
      const uploaded = Array.isArray(params.uploadedFilePaths) ? params.uploadedFilePaths : []
      const images = uploaded.length > 0 ? uploaded : (Array.isArray(params.images) ? params.images : [])
      if (params.falSeedance20MiniMode === 'reference-to-video') return 'bytedance/seedance-2.0/mini/reference-to-video'
      return images.length > 0 ? 'bytedance/seedance-2.0/mini/image-to-video' : 'bytedance/seedance-2.0/mini/text-to-video'
    }
  },
  request: {
    builder: (params) => {
      const clean = (value: DynamicValue): string[] => Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : []
      const pick = (primary: DynamicValue, fallback: DynamicValue): string[] => {
        const first = clean(primary)
        return first.length > 0 ? first : clean(fallback)
      }
      const images = pick(params.uploadedFilePaths, params.images)
      const videos = pick(params.uploadedVideoFilePaths, params.videos)
      const audios = pick(params.uploadedAudioFilePaths, params.audios)
      const ratios = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16']
      const raw = String(params.falSeedance20MiniAspectRatio || 'smart')
      const hint = typeof params.__firstImageRatio === 'number' && Number.isFinite(params.__firstImageRatio) && params.__firstImageRatio > 0 ? params.__firstImageRatio : 16 / 9
      let ratio = ratios.includes(raw) ? raw : '16:9'
      if (raw === 'smart' || raw === 'auto') {
        let difference = Number.POSITIVE_INFINITY
        for (const candidate of ratios) {
          const pair = candidate.split(':').map(Number)
          const next = Math.abs(pair[0] / pair[1] - hint)
          if (next < difference) { difference = next; ratio = candidate }
        }
      }
      const body: DynamicValueMap = {
        prompt: typeof params.prompt === 'string' ? params.prompt : '',
        resolution: params.falSeedance20MiniResolution === '480p' ? '480p' : '720p',
        duration: String(Math.min(15, Math.max(4, Math.round(Number(params.falSeedance20MiniDuration || 5))))),
        aspect_ratio: raw === 'smart' && (images.length + videos.length) > 0 ? 'auto' : ratio,
        generate_audio: params.falSeedance20MiniGenerateAudio !== false
      }
      if (params.falSeedance20MiniMode === 'reference-to-video') {
        if (images.length + videos.length + audios.length > 12) {
          throw new Error('Fal Seedance 2.0 Mini 的参考素材总数不能超过 12 个')
        }
        if (audios.length > 0 && images.length + videos.length === 0) {
          throw new Error('Fal Seedance 2.0 Mini 的参考音频必须与参考图片或参考视频一起使用')
        }
        if (images.length > 0) body.image_urls = images.slice(0, 9)
        if (videos.length > 0) body.video_urls = videos.slice(0, 3)
        if (audios.length > 0) body.audio_urls = audios.slice(0, 3)
      } else if (images.length > 0) {
        body.image_url = images[0]
        if (images.length > 1) body.end_image_url = images[1]
      }
      return body
    }
  },
  pricing: {
    currency: '$',
    calculator: (params) => {
      const duration = Math.min(15, Math.max(4, Math.round(Number(params.falSeedance20MiniDuration || 5))))
      const baseRate = params.falSeedance20MiniResolution === '480p' ? 0.0721 : 0.1547
      const uploadedVideos = Array.isArray(params.uploadedVideoFilePaths) ? params.uploadedVideoFilePaths : []
      const videos = uploadedVideos.length > 0 ? uploadedVideos : (Array.isArray(params.videos) ? params.videos : [])
      const hasVideo = params.falSeedance20MiniMode === 'reference-to-video' && videos.length > 0
      const inputDuration = typeof params.__firstVideoDurationSeconds === 'number' && params.__firstVideoDurationSeconds > 0
        ? params.__firstVideoDurationSeconds * videos.length
        : 0
      return (duration + (hasVideo ? inputDuration : 0)) * baseRate * (hasVideo ? 0.6 : 1)
    },
    description: '输出约：480p $0.0721、720p $0.1547/秒；有视频参考时费率乘 0.6，并按输入与输出总时长计费'
  }
})

export default falSeedance20MiniModel
