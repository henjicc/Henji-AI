/**
 * KIE Seedance 1.5 Pro 视频生成模型
 */

import { defineModel, sharedFieldText, sharedOptionText } from '@/core'
import { resolveKieImageSources } from './mediaSources'

const KIE_CREATE_TASK_ENDPOINT = '/api/v1/jobs/createTask'

export const kieSeedance15ProModel = defineModel({
  meta: {
    id: 'kie-seedance-1.5-pro',
    canonicalModelId: 'seedance-1.5-pro',
    seriesId: 'seedance',
    seriesRank: 1.5,
    provider: 'kie',
    type: 'video',
    i18nScope: 'models.defs.kie-seedance-1.5-pro',
    name: { key: 'meta.name', fallback: 'Seedance 1.5 Pro' },
    tags: ['text-to-video', 'image-to-video', 'start-end-frame', 'provider-kie'],
    polling: {
      interval: 3000,
      maxAttempts: 180,
      expectedAttempts: 60
    }
  },
  inputLimits: {
    images: { max: 2 },
    videos: { max: 0 }
  },
  params: [
    {
      id: 'kieSeedance15ProAspectRatio',
      type: 'dropdown',
      order: 1,
      name: sharedFieldText('aspectRatio'),
      default: 'smart',
      options: [
        { value: 'smart', label: sharedOptionText('smart') },
        { value: '1:1', label: '1:1' },
        { value: '21:9', label: '21:9' },
        { value: '4:3', label: '4:3' },
        { value: '3:4', label: '3:4' },
        { value: '16:9', label: '16:9' },
        { value: '9:16', label: '9:16' }
      ]
    },
    {
      id: 'kieSeedance15ProResolution',
      type: 'dropdown',
      order: 2,
      name: sharedFieldText('resolution'),
      default: '720p',
      options: [
        { value: '480p', label: '480p' },
        { value: '720p', label: '720p' },
        { value: '1080p', label: '1080p' }
      ]
    },
    {
      id: 'kieSeedance15ProDuration',
      type: 'dropdown',
      order: 3,
      name: sharedFieldText('duration'),
      default: 8,
      options: [
        { value: 4, label: '4s' },
        { value: 6, label: '6s' },
        { value: 8, label: '8s' },
        { value: 10, label: '10s' },
        { value: 12, label: '12s' }
      ]
    },
    {
      id: 'kieSeedance15ProGenerateAudio',
      type: 'switch',
      order: 4,
      name: sharedFieldText('generateAudio'),
      default: false
    },
    {
      id: 'kieSeedance15ProFixedLens',
      type: 'switch',
      order: 5,
      name: sharedFieldText('cameraFixed'),
      default: false
    }
  ],
  linkages: [],
  endpoints: KIE_CREATE_TASK_ENDPOINT,
  request: {
    builder: (params) => {
      const images = resolveKieImageSources(params)
      const prompt = params.prompt || ''
      const resolution = params.kieSeedance15ProResolution || params.resolution || '720p'
      const duration = Number(params.kieSeedance15ProDuration ?? params.duration ?? 8)
      const generateAudio = params.kieSeedance15ProGenerateAudio === true
      const fixedLens = params.kieSeedance15ProFixedLens === true
      const aspectRatio = params.kieSeedance15ProAspectRatio || params.aspect_ratio || 'smart'

      const supportedRatios = ['1:1', '21:9', '4:3', '3:4', '16:9', '9:16']
      const normalizeRatio = (value: string): string => {
        if (value && value !== 'smart' && value !== 'auto' && supportedRatios.includes(value)) {
          return value
        }
        const ratioHint = typeof params.__firstImageRatio === 'number' && Number.isFinite(params.__firstImageRatio) && params.__firstImageRatio > 0
          ? params.__firstImageRatio
          : 1
        let best = '1:1'
        let bestDiff = Number.POSITIVE_INFINITY
        for (const ratioText of supportedRatios) {
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
        fixed_lens: fixedLens,
        generate_audio: generateAudio,
        nsfw_checker: true
      }

      if (images.length > 0) {
        input.input_urls = images
      }

      return {
        model: 'bytedance/seedance-1.5-pro',
        input
      }
    }
  },
  pricing: {
    currency: '$',
    calculator: (params) => {
      const resolution = String(params.kieSeedance15ProResolution || '720p')
      const duration = Number(params.kieSeedance15ProDuration || 8)
      const generateAudio = params.kieSeedance15ProGenerateAudio === true

      const perSecond: Record<string, { silent: number; audio: number }> = {
        '480p': { silent: 0.00875, audio: 0.0175 },
        '720p': { silent: 0.0175, audio: 0.035 },
        '1080p': { silent: 0.0375, audio: 0.075 }
      }
      const rate = perSecond[resolution] ?? perSecond['720p']
      return (generateAudio ? rate.audio : rate.silent) * duration
    },
    description: '480p: $0.00875/$0.0175 per second (no audio/with audio); 720p: $0.0175/$0.035; 1080p: $0.0375/$0.075'
  }
})

export default kieSeedance15ProModel
