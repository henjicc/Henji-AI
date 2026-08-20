/**
 * KIE Grok Imagine Image 2.0 图片生成与任务式编辑模型
 *
 * Segment Map 返回结构化分割信息，不是媒体生成结果，因此不接入通用生成节点；
 * 图片编辑端点接受前序生成/分割任务 ID，并继续返回可落地的图片 URL。
 */

import { defineModel, sharedFieldText } from '@/core'

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
    images: { max: 0 },
    videos: { max: 0 }
  },
  params: [
    {
      id: 'kieGrokImagine20Mode',
      type: 'dropdown',
      order: 1,
      name: sharedFieldText('mode'),
      default: 'text-to-image',
      options: [
        { value: 'text-to-image', label: { zh: '文生图', en: 'Text to Image' } },
        { value: 'image-edit', label: { zh: '任务图片编辑', en: 'Task Image Edit' } }
      ]
    },
    {
      id: 'kieGrokImagine20AspectRatio',
      type: 'dropdown',
      order: 2,
      name: sharedFieldText('aspectRatio'),
      default: '1:1',
      visible: {
        condition: (params) => params.kieGrokImagine20Mode !== 'image-edit'
      },
      options: [
        { value: '1:1', label: '1:1' },
        { value: '2:3', label: '2:3' },
        { value: '3:2', label: '3:2' },
        { value: '16:9', label: '16:9' },
        { value: '9:16', label: '9:16' }
      ]
    },
    {
      id: 'kieGrokImagine20TaskId',
      type: 'text',
      order: 3,
      name: { zh: '来源任务 ID', en: 'Source Task ID' },
      default: '',
      required: true,
      visible: {
        condition: (params) => params.kieGrokImagine20Mode === 'image-edit'
      }
    },
    {
      id: 'kieGrokImagine20MaskIndexes',
      type: 'text',
      order: 4,
      name: { zh: '区域索引', en: 'Mask Indexes' },
      default: '',
      placeholder: { zh: '例如 0,2', en: 'For example: 0,2' },
      visible: {
        condition: (params) => params.kieGrokImagine20Mode === 'image-edit'
      }
    }
  ],
  linkages: [],
  endpoints: KIE_CREATE_TASK_ENDPOINT,
  request: {
    builder: (params) => {
      const mode = params.kieGrokImagine20Mode === 'image-edit' ? 'image-edit' : 'text-to-image'
      const prompt = typeof params.prompt === 'string' ? params.prompt : ''
      if (mode === 'image-edit') {
        const taskId = typeof params.kieGrokImagine20TaskId === 'string'
          ? params.kieGrokImagine20TaskId.trim()
          : ''
        if (!taskId) {
          throw new Error('Grok Imagine Image 2.0 image edit requires a source task ID')
        }
        const input: DynamicValueMap = { prompt, task_id: taskId }
        if (typeof params.kieGrokImagine20MaskIndexes === 'string') {
          const maskIndexes = params.kieGrokImagine20MaskIndexes
            .split(',')
            .map((item) => Number(item.trim()))
            .filter((item) => Number.isInteger(item) && item >= 0)
          if (maskIndexes.length > 0) {
            input.mask_indexs = maskIndexes
          }
        }
        return { model: 'grok-imagine-image-2-0/image-edit', input }
      }

      return {
        model: 'grok-imagine-image-2-0/text-to-image',
        input: {
          prompt,
          aspect_ratio: params.kieGrokImagine20AspectRatio || '1:1'
        }
      }
    }
  },
  pricing: {
    currency: '$',
    calculator: () => 0.02,
    description: '文生图与图片编辑均为 $0.02/张；Segment Map 免费但不属于媒体生成结果'
  }
})

export default kieGrokImagine20Model
