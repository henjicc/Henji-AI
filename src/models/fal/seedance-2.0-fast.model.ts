/** Fal Seedance 2.0 Fast 多模态视频模型 */

import { defineModel, sharedFieldText, sharedModeText, sharedOptionText } from '@/core'

export const falSeedance20FastModel = defineModel({
  meta: {
    id: 'fal-ai-seedance-2.0-fast', canonicalModelId: 'seedance-2.0-fast', seriesId: 'seedance', seriesRank: 2.01,
    provider: 'fal', type: 'video', i18nScope: 'models.defs.fal-ai-seedance-2.0-fast',
    name: { key: 'meta.name', fallback: 'Seedance 2.0 Fast' },
    tags: ['text-to-video', 'image-to-video', 'start-end-frame', 'reference-mode', 'mixed-upload-mode', 'supports-audio-generation', 'multi-mode-switch', 'fast-mode', 'provider-fal'],
    aliases: ['seedance-2-fast-fal'], polling: { interval: 3000, maxAttempts: 320, expectedAttempts: 75 }
  },
  inputLimits: {
    images: { max: 2 }, videos: { max: 0 }, audios: { max: 0 },
    rules: [{ when: 'falSeedance20FastMode === "reference-to-video"', images: { max: 9 }, videos: { max: 3 }, audios: { max: 3 } }]
  },
  params: [
    {
      id: 'falSeedance20FastMode', type: 'dropdown', order: 1,
      name: sharedFieldText('mode'), default: 'text-image-to-video',
      options: [
        { value: 'text-image-to-video', label: sharedModeText('textImageToVideo') },
        { value: 'reference-to-video', label: sharedModeText('referenceToVideo') }
      ]
    },
    {
      id: 'falSeedance20FastAspectRatio', type: 'dropdown', order: 2,
      name: sharedFieldText('aspectRatio'), default: 'smart',
      options: [
        { value: 'smart', label: sharedOptionText('smart') },
        ...['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'].map((value) => ({ value, label: value }))
      ]
    },
    {
      id: 'falSeedance20FastResolution', type: 'dropdown', order: 3,
      name: sharedFieldText('resolution'), default: '720p',
      options: ['480p', '720p'].map((value) => ({ value, label: value }))
    },
    {
      id: 'falSeedance20FastDuration', type: 'number', order: 4,
      name: sharedFieldText('duration'), default: 5, min: 4, max: 15, step: 1
    },
    {
      id: 'falSeedance20FastGenerateAudio', type: 'switch', order: 5,
      name: sharedFieldText('generateAudio'), default: true
    },
    {
      id: 'falSeedance20FastBitrate', type: 'dropdown', order: 6,
      name: { zh: '码率', en: 'Bitrate' }, default: 'standard',
      options: [{ value: 'standard', label: { zh: '标准', en: 'Standard' } }, { value: 'high', label: { zh: '高', en: 'High' } }]
    }
  ],
  linkages: [],
  endpoints: {
    selector: async (params) => {
      const uploaded = Array.isArray(params.uploadedFilePaths) ? params.uploadedFilePaths : []
      const images = uploaded.length > 0 ? uploaded : (Array.isArray(params.images) ? params.images : [])
      if (params.falSeedance20FastMode === 'reference-to-video') return 'bytedance/seedance-2.0/fast/reference-to-video'
      return images.length > 0 ? 'bytedance/seedance-2.0/fast/image-to-video' : 'bytedance/seedance-2.0/fast/text-to-video'
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
      const raw = String(params.falSeedance20FastAspectRatio || 'smart')
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
        resolution: params.falSeedance20FastResolution === '480p' ? '480p' : '720p',
        duration: String(Math.min(15, Math.max(4, Math.round(Number(params.falSeedance20FastDuration || 5))))),
        aspect_ratio: raw === 'smart' && (images.length + videos.length) > 0 ? 'auto' : ratio,
        generate_audio: params.falSeedance20FastGenerateAudio !== false,
        bitrate_mode: params.falSeedance20FastBitrate === 'high' ? 'high' : 'standard'
      }
      if (params.falSeedance20FastMode === 'reference-to-video') {
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
      const duration = Math.min(15, Math.max(4, Math.round(Number(params.falSeedance20FastDuration || 5))))
      return duration * (params.falSeedance20FastResolution === '480p' ? 0.1076 : 0.2419)
    },
    description: '输出约：480p $0.1076、720p $0.2419/秒；参考视频输入另计'
  }
})

export default falSeedance20FastModel
