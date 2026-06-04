/**
 * KIE Sora 2 视频生成模型
 */

import { defineModel, sharedFieldText, sharedOptionText } from '@/core'
import { resolveKieImageSources } from './mediaSources'

const KIE_CREATE_TASK_ENDPOINT = '/api/v1/jobs/createTask'

function mapSora2AspectRatio(value: string): string {
  if (value === '16:9') return 'landscape'
  if (value === '9:16') return 'portrait'
  if (value === 'landscape' || value === 'portrait' || value === 'smart') return value
  return 'landscape'
}

export const kieSora2Model = defineModel({
  meta: {
    id: 'kie-sora-2',
    provider: 'kie',
    type: 'video',
        i18nScope: 'models.defs.kie-sora-2',
    name: { key: 'meta.name', fallback: 'Sora 2' },
    description: { key: 'meta.description', fallback: 'KIE Sora 2 video generation model' },
    tags: ['text-to-video', 'image-to-video', 'provider-kie'],
    aliases: ['sora-2-kie'],
    polling: {
      interval: 3000,
      maxAttempts: 150,
      expectedAttempts: 50
    }
  },
  inputLimits: {
    images: { max: 1 },
    videos: { max: 0 }
  },
  params: [
    {
      id: 'kieSora2Mode',
      type: 'dropdown',
      order: 1,
      name: sharedFieldText('mode'),
      default: 'standard',
      options: [
        { value: 'standard', label: sharedOptionText('standard') },
        { value: 'professional', label: sharedOptionText('professional') }
      ]
    },
    {
      id: 'kieSora2AspectRatio',
      type: 'dropdown',
      order: 2,
      name: sharedFieldText('aspectRatio'),
      default: '16:9',
      options: [
        { value: 'smart', label: sharedOptionText('smart') },
        { value: '16:9', label: '16:9' },
        { value: '9:16', label: '9:16' }
      ]
    },
    {
      id: 'kieSora2Duration',
      type: 'dropdown',
      order: 3,
      name: sharedFieldText('duration'),
      default: '10',
      options: [
        { value: '10', label: '10s' },
        { value: '15', label: '15s' }
      ]
    },
    {
      id: 'kieSora2Quality',
      type: 'dropdown',
      order: 4,
      name: sharedFieldText('quality'),
      default: 'standard',
      visible: {
        condition: 'kieSora2Mode === "professional"'
      },
      options: [
        { value: 'standard', label: sharedOptionText('standard') },
        { value: 'high', label: sharedOptionText('high') }
      ]
    }
  ],
  linkages: [
    {
      trigger: 'uploadedImages',
      effect: 'autoSwitch',
      target: 'kieSora2AspectRatio',
      condition: (images: string[], allParams: Record<string, unknown>) => {
        const hasImages = Array.isArray(images) && images.length > 0
        const current = allParams.kieSora2AspectRatio
        return (hasImages && current === '16:9') || (!hasImages && current === 'smart')
      },
      value: (images: string[]) => {
        const hasImages = Array.isArray(images) && images.length > 0
        return hasImages ? 'smart' : '16:9'
      },
      noRestore: true
    }
  ],
  endpoints: KIE_CREATE_TASK_ENDPOINT,
  request: {
    builder: (params) => {
      const images = resolveKieImageSources(params)
      const prompt = params.prompt || ''
      const mode = params.kieSora2Mode || params.mode || 'standard'
      const duration = params.kieSora2Duration || params.duration || '10'
      const aspectRatio = params.kieSora2AspectRatio || params.aspect_ratio || '16:9'
      const quality = params.kieSora2Quality || params.quality || 'standard'

      const usePro = mode === 'professional'

      const model = images.length === 0
        ? (usePro ? 'sora-2-pro-text-to-video' : 'sora-2-text-to-video')
        : (usePro ? 'sora-2-pro-image-to-video' : 'sora-2-image-to-video')

      const mappedRatio = mapSora2AspectRatio(String(aspectRatio))

      const input: Record<string, unknown> = {
        prompt,
        n_frames: duration,
        remove_watermark: true
      }

      if (mappedRatio && mappedRatio !== 'smart') {
        input.aspect_ratio = mappedRatio
      }

      if (usePro) {
        input.size = quality
      }

      if (images.length > 0) {
        input.image_urls = [images[0]]
      }

      return {
        model,
        input
      }
    }
  },
  pricing: {
    currency: '¥',
    calculator: () => 0.12,
    description: '基础价格 ¥0.12/次'
  }
})

export default kieSora2Model
