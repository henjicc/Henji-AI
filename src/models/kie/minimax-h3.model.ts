/**
 * KIE MiniMax H3 文生、首尾帧与多模态参考视频模型
 */

import { defineModel, sharedFieldText, sharedModeText, sharedOptionText } from '@/core'
import { countUploadedImages, countUploadedVideos, hasUploadedImage } from './mediaSources'

const KIE_CREATE_TASK_ENDPOINT = '/api/v1/jobs/createTask'

export const kieMiniMaxH3Model = defineModel({
  meta: {
    id: 'kie-minimax-h3',
    canonicalModelId: 'minimax-h3',
    seriesId: 'minimax-video',
    seriesRank: 3,
    provider: 'kie',
    type: 'video',
    i18nScope: 'models.defs.kie-minimax-h3',
    name: { key: 'meta.name', fallback: 'MiniMax H3' },
    tags: [
      'text-to-video',
      'image-to-video',
      'start-end-frame',
      'reference-mode',
      'multi-mode-switch',
      'mixed-upload-mode',
      'supports-audio-generation',
      'provider-kie'
    ],
    polling: { interval: 5000, maxAttempts: 180, expectedAttempts: 60 }
  },
  inputLimits: {
    images: { max: 2 },
    videos: { max: 0 },
    audios: { max: 0 },
    rules: [
      {
        when: 'kieMiniMaxH3Mode === "reference-to-video"',
        images: { max: 9 },
        videos: { max: 3 },
        audios: { max: 3 }
      }
    ]
  },
  params: [
    {
      id: 'kieMiniMaxH3Mode',
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
      id: 'kieMiniMaxH3AspectRatio',
      type: 'dropdown',
      order: 2,
      name: sharedFieldText('aspectRatio'),
      default: 'smart',
      visible: {
        condition: (params) => params.kieMiniMaxH3Mode === 'reference-to-video' || !hasUploadedImage(params)
      },
      options: [
        { value: 'smart', label: sharedOptionText('smart') },
        { value: '21:9', label: '21:9' },
        { value: '16:9', label: '16:9' },
        { value: '4:3', label: '4:3' },
        { value: '1:1', label: '1:1' },
        { value: '3:4', label: '3:4' },
        { value: '9:16', label: '9:16' }
      ]
    },
    {
      id: 'kieMiniMaxH3Resolution',
      type: 'dropdown',
      order: 3,
      name: sharedFieldText('resolution'),
      default: '768P',
      options: [
        { value: '768P', label: '768P' },
        { value: '2K', label: '2K' }
      ]
    },
    {
      id: 'kieMiniMaxH3Duration',
      type: 'number',
      order: 4,
      name: sharedFieldText('duration'),
      default: 5,
      min: 4,
      max: 15,
      step: 1
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
      const mode = params.kieMiniMaxH3Mode === 'reference-to-video'
        ? 'reference-to-video'
        : 'text-image-to-video'
      const supportedAspectRatios = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16']
      const rawAspectRatio = String(params.kieMiniMaxH3AspectRatio || 'smart')
      const ratioHint = typeof params.__firstImageRatio === 'number' && Number.isFinite(params.__firstImageRatio) && params.__firstImageRatio > 0
        ? params.__firstImageRatio
        : 16 / 9
      let aspectRatio = supportedAspectRatios.includes(rawAspectRatio) ? rawAspectRatio : '16:9'
      if (rawAspectRatio === 'smart' || rawAspectRatio === 'auto') {
        let bestDiff = Number.POSITIVE_INFINITY
        for (const candidate of supportedAspectRatios) {
          const pair = candidate.split(':').map(Number)
          const difference = Math.abs(pair[0] / pair[1] - ratioHint)
          if (difference < bestDiff) {
            bestDiff = difference
            aspectRatio = candidate
          }
        }
      }
      const input: DynamicValueMap = {
        prompt: typeof params.prompt === 'string' ? params.prompt : '',
        duration: Math.min(15, Math.max(4, Number(params.kieMiniMaxH3Duration || 5))),
        resolution: params.kieMiniMaxH3Resolution === '2K' ? '2K' : '768P'
      }

      if (mode === 'reference-to-video') {
        input.aspect_ratio = aspectRatio
        if (images.length > 0) input.image_urls = images.slice(0, 9)
        if (videos.length > 0) input.video_urls = videos.slice(0, 3)
        if (audios.length > 0) input.audio_urls = audios.slice(0, 3)
        return { model: 'minimax-h3/reference-to-video', input }
      }

      if (images.length > 0) {
        input.first_frame_image = images[0]
        if (images[1]) input.last_frame_image = images[1]
        return { model: 'minimax-h3/image-to-video', input }
      }

      input.aspect_ratio = aspectRatio
      return { model: 'minimax-h3/text-to-video', input }
    }
  },
  pricing: {
    currency: '$',
    calculator: (params) => {
      const duration = Math.min(15, Math.max(4, Number(params.kieMiniMaxH3Duration || 5)))
      const rate = params.kieMiniMaxH3Resolution === '2K' ? 0.13 : 0.08
      const firstVideoDuration = typeof params.__firstVideoDurationSeconds === 'number'
        ? Math.max(0, params.__firstVideoDurationSeconds)
        : 0
      const billedSeconds = duration + firstVideoDuration * countUploadedVideos(params)
      const extraImages = Math.max(0, countUploadedImages(params) - 5)
      return billedSeconds * rate + extraImages * 0.04
    },
    description: '768P $0.08/秒，2K $0.13/秒；输入视频时长同价计费，前 5 张参考图免费，之后 $0.04/张'
  }
})

export default kieMiniMaxH3Model
