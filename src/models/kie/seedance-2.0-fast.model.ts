/**
 * KIE Seedance 2.0 Fast 视频生成模型
 */

import { defineModel, sharedFieldText, sharedModeText, sharedOptionText } from '@/core'
import { hasUploadedVideo } from './mediaSources'

const KIE_CREATE_TASK_ENDPOINT = '/api/v1/jobs/createTask'

export const kieSeedance20FastModel = defineModel({
  meta: {
    id: 'kie-seedance-2.0-fast',
    seriesId: 'seedance',
    seriesRank: 2.0,
    provider: 'kie',
    type: 'video',
    i18nScope: 'models.defs.kie-seedance-2.0-fast',
    name: { key: 'meta.name', fallback: 'Seedance 2.0 Fast' },
    description: { key: 'meta.description', fallback: 'KIE Seedance 2.0 Fast video generation model with text/image-to-video and multi-modal reference-to-video modes' },
    tags: ['text-to-video', 'image-to-video', 'start-end-frame', 'reference-mode', 'multi-mode-switch', 'mixed-upload-mode', 'supports-audio-generation', 'fast-mode', 'provider-kie'],
    polling: {
      interval: 3000,
      maxAttempts: 180,
      expectedAttempts: 60
    }
  },
  inputLimits: {
    images: { max: 2 },
    videos: { max: 0 },
    audios: { max: 0 },
    rules: [
      {
        when: 'kieSeedance20FastMode === "reference-to-video"',
        images: { max: 9 },
        videos: { max: 3 },
        audios: { max: 3 }
      }
    ]
  },
  params: [
    {
      id: 'kieSeedance20FastMode',
      type: 'dropdown',
      order: 1,
      name: sharedFieldText('mode'),
      default: 'text-image-to-video',
      options: [
        { value: 'text-image-to-video', label: sharedModeText('textImageToVideo') },
        { value: 'reference-to-video', label: sharedModeText('referenceToVideo') }
      ]
    },
    {
      id: 'kieSeedance20FastAspectRatio',
      type: 'dropdown',
      order: 2,
      name: sharedFieldText('aspectRatio'),
      default: 'smart',
      options: [
        { value: 'smart', label: sharedOptionText('smart') },
        { value: '1:1', label: '1:1' },
        { value: '4:3', label: '4:3' },
        { value: '3:4', label: '3:4' },
        { value: '16:9', label: '16:9' },
        { value: '9:16', label: '9:16' },
        { value: '21:9', label: '21:9' }
      ]
    },
    {
      id: 'kieSeedance20FastResolution',
      type: 'dropdown',
      order: 3,
      name: sharedFieldText('resolution'),
      default: '720p',
      options: [
        { value: '480p', label: '480p' },
        { value: '720p', label: '720p' }
      ]
    },
    {
      id: 'kieSeedance20FastDuration',
      type: 'number',
      order: 4,
      name: sharedFieldText('duration'),
      default: 5,
      min: 4,
      max: 15,
      step: 1
    },
    {
      id: 'kieSeedance20FastGenerateAudio',
      type: 'switch',
      order: 5,
      name: sharedFieldText('generateAudio'),
      default: true
    },
    {
      id: 'kieSeedance20FastWebSearch',
      type: 'switch',
      order: 6,
      name: { zh: '联网搜索', en: 'Web Search' },
      default: false
    }
  ],
  linkages: [],
  endpoints: KIE_CREATE_TASK_ENDPOINT,
  request: {
    builder: (params) => {
      const filterSources = (value: DynamicValue): string[] => Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : []
      const pickSources = (primary: DynamicValue, fallback: DynamicValue): string[] => {
        const preferred = filterSources(primary)
        return preferred.length > 0 ? preferred : filterSources(fallback)
      }
      const images = pickSources(params.uploadedFilePaths, params.images)
      const videos = pickSources(params.uploadedVideoFilePaths, params.videos)
      const audios = pickSources(params.uploadedAudioFilePaths, params.audios)
      const prompt = params.prompt || ''
      const mode = params.kieSeedance20FastMode === 'reference-to-video' ? 'reference-to-video' : 'text-image-to-video'
      const resolution = params.kieSeedance20FastResolution || params.resolution || '720p'
      const duration = Number(params.kieSeedance20FastDuration ?? params.duration ?? 5)
      const generateAudio = params.kieSeedance20FastGenerateAudio !== undefined ? params.kieSeedance20FastGenerateAudio === true : true
      const webSearch = params.kieSeedance20FastWebSearch === true
      const aspectRatio = params.kieSeedance20FastAspectRatio || params.aspect_ratio || 'smart'

      const supportedAspectRatios = ['1:1', '4:3', '3:4', '16:9', '9:16', '21:9']
      const normalizeRatio = (value: string): string => {
        if (value && value !== 'smart' && value !== 'auto' && supportedAspectRatios.includes(value)) {
          return value
        }
        const ratioHint = typeof params.__firstImageRatio === 'number' && Number.isFinite(params.__firstImageRatio) && params.__firstImageRatio > 0
          ? params.__firstImageRatio
          : 1
        let best = '1:1'
        let bestDiff = Number.POSITIVE_INFINITY
        for (const ratioText of supportedAspectRatios) {
          const pair = ratioText.split(':').map(Number)
          const ratio = pair[0] / Math.max(1, pair[1])
          const diff = Math.abs(ratio - ratioHint)
          if (diff < bestDiff) {
            bestDiff = diff
            best = ratioText
          }
        }
        return best
      }

      const input: DynamicValueMap = {
        prompt,
        aspect_ratio: normalizeRatio(String(aspectRatio)),
        resolution,
        duration,
        generate_audio: generateAudio,
        web_search: webSearch,
        nsfw_checker: true
      }

      if (mode === 'reference-to-video') {
        if (images.length > 0) {
          input.reference_image_urls = images.slice(0, 9)
        }
        if (videos.length > 0) {
          input.reference_video_urls = videos.slice(0, 3)
        }
        if (audios.length > 0) {
          input.reference_audio_urls = audios.slice(0, 3)
        }
      } else {
        if (images[0]) {
          input.first_frame_url = images[0]
        }
        if (images[1]) {
          input.last_frame_url = images[1]
        }
      }

      return {
        model: 'bytedance/seedance-2-fast',
        input
      }
    }
  },
  pricing: {
    currency: '$',
    calculator: (params) => {
      const resolution = String(params.kieSeedance20FastResolution || '720p')
      const duration = Number(params.kieSeedance20FastDuration || 5)
      const mode = params.kieSeedance20FastMode === 'reference-to-video' ? 'reference-to-video' : 'text-image-to-video'
      const hasVideoInput = mode === 'reference-to-video' && hasUploadedVideo(params)

      const perSecond: Record<string, { noVideo: number; withVideo: number }> = {
        '480p': { noVideo: 0.0775, withVideo: 0.045 },
        '720p': { noVideo: 0.165, withVideo: 0.10 }
      }
      const rate = perSecond[resolution] ?? perSecond['720p']
      return (hasVideoInput ? rate.withVideo : rate.noVideo) * duration
    },
    description: '480p: $0.0775/$0.045 per second (no/with video input); 720p: $0.165/$0.10'
  }
})

export default kieSeedance20FastModel
