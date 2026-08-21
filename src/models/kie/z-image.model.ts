/**
 * KIE Z-Image 图片生成模型
 */

import { defineModel, sharedFieldText } from '@/core'

const KIE_CREATE_TASK_ENDPOINT = '/api/v1/jobs/createTask'

export const kieZImageModel = defineModel({
  meta: {
    id: 'kie-z-image',
    canonicalModelId: 'z-image-turbo',
    provider: 'kie',
    type: 'image',
        i18nScope: 'models.defs.kie-z-image',
    name: { key: 'meta.name', fallback: 'Z-Image Turbo' },
    tags: ['text-to-image', 'provider-kie'],
    aliases: ['z-image-kie']
  },
  params: [
    {
      id: 'kieZImageAspectRatio',
      type: 'dropdown',
      order: 1,
      name: sharedFieldText('aspectRatio'),
      default: 'smart',
      required: true,
      options: [
        { value: 'smart', label: { zh: '智能', en: 'Smart' } },
        { value: '1:1', label: '1:1' },
        { value: '4:3', label: '4:3' },
        { value: '3:4', label: '3:4' },
        { value: '16:9', label: '16:9' },
        { value: '9:16', label: '9:16' },
      ]
    }
  ],
  linkages: [],
  endpoints: KIE_CREATE_TASK_ENDPOINT,
  request: {
    builder: (params) => {
      const prompt = typeof params.prompt === 'string' ? params.prompt.slice(0, 1000) : ''
      const rawAspectRatio = String(params.kieZImageAspectRatio || params.aspect_ratio || 'smart')

      const supportedAspectRatios = ['1:1', '4:3', '3:4', '16:9', '9:16']
      const ratioHint = typeof params.__firstImageRatio === 'number' && Number.isFinite(params.__firstImageRatio) && params.__firstImageRatio > 0
        ? params.__firstImageRatio
        : 1
      let aspectRatio = supportedAspectRatios.includes(rawAspectRatio) ? rawAspectRatio : '1:1'
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

      const input: DynamicValueMap = { prompt, aspect_ratio: aspectRatio }

      return {
        model: 'z-image',
        input
      }
    }
  },
  pricing: {
    currency: '$',
    calculator: () => 0.004,
    description: '$0.004/张'
  }
})

export default kieZImageModel
