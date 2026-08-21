/**
 * KIE Grok Imagine Image 2.0 图片生成与直接图片编辑模型
 *
 * Segment Map 返回结构化分割信息，不是媒体生成结果，因此不接入通用生成节点；
 * Segment Edit 依赖 Segment Map 的结构化结果，同样留给独立图层编辑工作流。
 */

import { defineModel, sharedFieldText, sharedOptionText } from '@/core'

const KIE_CREATE_TASK_ENDPOINT = '/api/v1/jobs/createTask'

export const kieGrokImagine20Model = defineModel({
  meta: {
    id: 'kie-grok-imagine-2.0',
    canonicalModelId: 'grok-imagine-image-2.0',
    seriesId: 'grok-imagine-image',
    seriesRank: 2,
    provider: 'kie',
    type: 'image',
    i18nScope: 'models.defs.kie-grok-imagine-2.0',
    name: { key: 'meta.name', fallback: 'Grok Imagine Image 2.0' },
    tags: ['text-to-image', 'image-to-image', 'supports-image-editing', 'multi-mode-switch', 'provider-kie'],
    aliases: ['grok-imagine-image-2-kie']
  },
  inputLimits: {
    images: { max: 5 },
    videos: { max: 0 }
  },
  params: [
    {
      id: 'kieGrokImagine20AspectRatio',
      type: 'dropdown',
      order: 1,
      name: sharedFieldText('aspectRatio'),
      default: 'smart',
      options: [
        { value: 'smart', label: sharedOptionText('smart') },
        { value: '1:1', label: '1:1' },
        { value: '2:3', label: '2:3' },
        { value: '3:2', label: '3:2' },
        { value: '16:9', label: '16:9' },
        { value: '9:16', label: '9:16' }
      ]
    }
  ],
  linkages: [],
  endpoints: KIE_CREATE_TASK_ENDPOINT,
  request: {
    builder: (params) => {
      const prompt = typeof params.prompt === 'string' ? params.prompt : ''
      const clean = (value: DynamicValue): string[] => Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : []
      const uploaded = clean(params.uploadedFilePaths)
      const images = uploaded.length > 0 ? uploaded : clean(params.images)
      const supported = ['1:1', '2:3', '3:2', '16:9', '9:16']
      const rawRatio = String(params.kieGrokImagine20AspectRatio || 'smart')
      const aspectRatio = images.length > 0 && (rawRatio === 'smart' || rawRatio === 'auto')
        ? 'auto'
        : (supported.includes(rawRatio) ? rawRatio : '1:1')

      if (images.length > 0) {
        return {
          model: 'grok-imagine-image-2-0/image-edit',
          input: { prompt, aspect_ratio: aspectRatio, image_urls: images.slice(0, 5) }
        }
      }

      return {
        model: 'grok-imagine-image-2-0/text-to-image',
        input: {
          prompt,
          aspect_ratio: aspectRatio
        }
      }
    }
  },
  pricing: {
    currency: '$',
    calculator: () => 0.02,
    description: '文生图与直接图片编辑均为 $0.02/张；分割工作流不属于通用媒体生成结果'
  }
})

export default kieGrokImagine20Model
