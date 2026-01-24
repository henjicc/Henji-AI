/**
 * KIE Sora 2 视频生成模型
 */

import { defineModel } from '@/core'

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
    name: { zh: 'Sora 2', en: 'Sora 2' },
    description: { zh: 'KIE Sora 2 视频生成模型', en: 'KIE Sora 2 video generation model' },
    tags: ['text-to-video', 'image-to-video', 'provider-kie'],
    aliases: ['sora-2-kie'],
    polling: {
      interval: 3000,
      maxAttempts: 150,
      expectedAttempts: 50
    }
  },
  params: [
    {
      id: 'kieSora2Mode',
      type: 'dropdown',
      order: 1,
      name: { zh: '模式', en: 'Mode' },
      default: 'standard',
      options: [
        { value: 'standard', label: { zh: '标准', en: 'Standard' } },
        { value: 'professional', label: { zh: '专业', en: 'Professional' } }
      ]
    },
    {
      id: 'kieSora2AspectRatio',
      type: 'dropdown',
      order: 2,
      name: { zh: '宽高比', en: 'Aspect Ratio' },
      default: '16:9',
      options: [
        { value: 'smart', label: { zh: '智能', en: 'Smart' } },
        { value: '16:9', label: '16:9' },
        { value: '9:16', label: '9:16' }
      ]
    },
    {
      id: 'kieSora2Duration',
      type: 'dropdown',
      order: 3,
      name: { zh: '时长', en: 'Duration' },
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
      name: { zh: '画质', en: 'Quality' },
      default: 'standard',
      options: [
        { value: 'standard', label: { zh: '标准', en: 'Standard' } },
        { value: 'high', label: { zh: '高', en: 'High' } }
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
      const images = params.images || []
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
