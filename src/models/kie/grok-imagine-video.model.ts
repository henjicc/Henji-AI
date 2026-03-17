/**
 * KIE Grok Imagine 视频生成模型
 */

import { defineModel, sharedFieldText, sharedOptionText } from '@/core'

const KIE_CREATE_TASK_ENDPOINT = '/api/v1/jobs/createTask'

export const kieGrokImagineVideoModel = defineModel({
  meta: {
    id: 'kie-grok-imagine-video',
    provider: 'kie',
    type: 'video',
        i18nScope: 'models.defs.kie-grok-imagine-video',
    name: { key: 'meta.name', fallback: 'Grok Imagine Video' },
    description: { key: 'meta.description', fallback: 'KIE Grok Imagine video generation model' },
    tags: ['text-to-video', 'image-to-video', 'english-prompt-only', 'provider-kie'],
    aliases: ['grok-imagine-video-kie'],
    polling: {
      interval: 3000,
      maxAttempts: 120,
      expectedAttempts: 40
    }
  },
  inputLimits: {
    images: { max: 1 },
    videos: { max: 0 }
  },
  params: [
    {
      id: 'kieGrokImagineVideoAspectRatio',
      type: 'dropdown',
      order: 1,
      name: sharedFieldText('aspectRatio'),
      default: '2:3',
      options: [
        { value: '2:3', label: '2:3' },
        { value: '3:2', label: '3:2' },
        { value: '16:9', label: '16:9' },
        { value: '9:16', label: '9:16' },
        { value: '1:1', label: '1:1' }
      ]
    },
    {
      id: 'kieGrokImagineVideoMode',
      type: 'dropdown',
      order: 2,
      name: sharedFieldText('mode'),
      default: 'normal',
      options: [
        { value: 'normal', label: sharedOptionText('normal') },
        { value: 'spicy', label: sharedOptionText('spicy') }
      ]
    }
  ],
  linkages: [],
  endpoints: KIE_CREATE_TASK_ENDPOINT,
  request: {
    builder: (params) => {
      const images = params.images || []
      const prompt = params.prompt || ''
      const hasImages = images.length > 0
      const aspectRatio = params.kieGrokImagineVideoAspectRatio || params.aspect_ratio
      const mode = params.kieGrokImagineVideoMode || params.mode

      const model = hasImages
        ? 'grok-imagine/image-to-video'
        : 'grok-imagine/text-to-video'

      const input: Record<string, unknown> = { prompt }

      if (!hasImages && aspectRatio) {
        input.aspect_ratio = aspectRatio
      }

      if (hasImages) {
        input.image_urls = [images[0]]
      }

      if (mode) {
        input.mode = hasImages && mode === 'spicy' ? 'normal' : mode
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

export default kieGrokImagineVideoModel
