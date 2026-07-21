/**
 * KIE GPT Image 2 图片生成模型
 */

import { defineModel, sharedFieldText, sharedOptionText } from '@/core'

const KIE_CREATE_TASK_ENDPOINT = '/api/v1/jobs/createTask'

export const kieGptImage2Model = defineModel({
  meta: {
    id: 'kie-gpt-image-2',
    provider: 'kie',
    type: 'image',
    i18nScope: 'models.defs.kie-gpt-image-2',
    name: { key: 'meta.name', fallback: 'GPT Image 2' },
    description: { key: 'meta.description', fallback: 'KIE GPT Image 2 image generation and editing model' },
    tags: [
      'text-to-image',
      'image-to-image',
      'supports-image-editing',
      'supports-multi-image',
      'reference-mode',
      'supports-4k',
      'max-images-6',
      'provider-kie'
    ],
    aliases: ['gpt-image-2-kie']
  },
  inputLimits: {
    images: { max: 6 },
    videos: { max: 0 }
  },
  params: [
    {
      id: 'kieGptImage2AspectRatio',
      type: 'dropdown',
      order: 1,
      name: sharedFieldText('aspectRatio'),
      default: 'smart',
      options: [
        { value: 'smart', label: sharedOptionText('smart') },
        { value: '1:1', label: '1:1' },
        { value: '5:4', label: '5:4' },
        { value: '4:3', label: '4:3' },
        { value: '3:2', label: '3:2' },
        { value: '16:9', label: '16:9' },
        { value: '21:9', label: '21:9' },
        { value: '4:5', label: '4:5' },
        { value: '3:4', label: '3:4' },
        { value: '2:3', label: '2:3' },
        { value: '9:16', label: '9:16' }
      ]
    },
    {
      id: 'kieGptImage2Resolution',
      type: 'dropdown',
      order: 2,
      name: sharedFieldText('resolution'),
      default: '1K',
      options: [
        { value: '1K', label: '1K' },
        { value: '2K', label: '2K' },
        { value: '4K', label: '4K' }
      ]
    }
  ],
  linkages: [
    {
      trigger: 'kieGptImage2AspectRatio',
      effect: 'filterOptions',
      target: 'kieGptImage2Resolution',
      filter: (aspectRatio, options) => {
        if (aspectRatio === '1:1') {
          return options.filter(option => option.value !== '4K')
        }
        return options
      }
    },
    {
      trigger: 'kieGptImage2AspectRatio',
      effect: 'setValue',
      target: 'kieGptImage2Resolution',
      condition: (aspectRatio, allParams) => {
        return aspectRatio === '1:1' && allParams.kieGptImage2Resolution === '4K'
      },
      value: '2K'
    },
    {
      trigger: 'kieGptImage2Resolution',
      effect: 'setValue',
      target: 'kieGptImage2Resolution',
      condition: (resolution, allParams) => {
        return resolution === '4K' && allParams.kieGptImage2AspectRatio === '1:1'
      },
      value: '2K'
    }
  ],
  endpoints: KIE_CREATE_TASK_ENDPOINT,
  request: {
    builder: (params) => {
      const parseRatio = (raw: string): number | null => {
        const pair = raw.split(':').map(Number)
        if (pair.length !== 2 || !Number.isFinite(pair[0]) || !Number.isFinite(pair[1]) || pair[0] <= 0 || pair[1] <= 0) {
          return null
        }
        return pair[0] / pair[1]
      }
      const pickClosestRatio = (target: number): string => {
        const options = ['21:9', '16:9', '3:2', '4:3', '5:4', '1:1', '4:5', '3:4', '2:3', '9:16']
        let best = '1:1'
        let bestDiff = Number.POSITIVE_INFINITY
        for (const ratioText of options) {
          const ratio = parseRatio(ratioText)
          if (!ratio) {
            continue
          }
          const diff = Math.abs(ratio - target)
          if (diff < bestDiff) {
            best = ratioText
            bestDiff = diff
          }
        }
        return best
      }
      const filterMediaSources = (values: DynamicValue): string[] => {
        return Array.isArray(values)
          ? values.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
          : []
      }

      const uploadedFilePaths = filterMediaSources(params.uploadedFilePaths)
      const legacyImages = filterMediaSources(params.images)
      const images = uploadedFilePaths.length > 0 ? uploadedFilePaths : legacyImages
      const prompt = typeof params.prompt === 'string' ? params.prompt : ''
      const rawAspectRatio = params.kieGptImage2AspectRatio || params.aspect_ratio
      const rawResolution = params.kieGptImage2Resolution || params.resolution || '1K'
      const ratioHint = typeof params.__firstImageRatio === 'number' &&
        Number.isFinite(params.__firstImageRatio) &&
        params.__firstImageRatio > 0
        ? params.__firstImageRatio
        : null

      const aspectRatioText = typeof rawAspectRatio === 'string' ? rawAspectRatio : ''
      const aspectRatio = !aspectRatioText || aspectRatioText === 'smart' || aspectRatioText === 'auto'
        ? (ratioHint ? pickClosestRatio(ratioHint) : '1:1')
        : aspectRatioText
      const resolution = String(rawResolution)

      if (aspectRatio === '1:1' && resolution === '4K') {
        throw new Error('GPT Image 2 does not support 4K output for 1:1 aspect ratio')
      }

      const input: DynamicValueMap = {
        prompt,
        aspect_ratio: aspectRatio,
        resolution
      }

      if (images.length > 0) {
        input.input_urls = images
      }

      return {
        model: images.length > 0 ? 'gpt-image-2-image-to-image' : 'gpt-image-2-text-to-image',
        input
      }
    }
  },
  pricing: {
    currency: '$',
    calculator: (params) => {
      const resolution = params.kieGptImage2Resolution || params.resolution
      if (resolution === '4K') return 0.04
      if (resolution === '2K') return 0.025
      return 0.015
    },
    description: '1K $0.015 / 2K $0.025 / 4K $0.040'
  }
})

export default kieGptImage2Model
