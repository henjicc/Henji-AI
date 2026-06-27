/**
 * ModelScope 自定义模型
 */

import { defineModel, sharedFieldText, sharedOptionText } from '@/core'
import { buildModelscopeRequest, MODELSCOPE_ASPECT_RATIO_OPTIONS, MODELSCOPE_CREATE_TASK_ENDPOINT } from './utils'

const MODELSCOPE_CUSTOM_STORAGE_KEY = 'modelscope_custom_models'

const getCustomModel = (modelId: string): { id?: string; modelType?: { imageEditing?: boolean } } | undefined => {
  try {
    if (typeof localStorage === 'undefined') return undefined
    const stored = localStorage.getItem(MODELSCOPE_CUSTOM_STORAGE_KEY)
    if (!stored) return undefined
    const parsed = JSON.parse(stored)
    if (!Array.isArray(parsed)) return undefined
    return parsed.find((item: DynamicValue) => {
      if (!item || typeof item !== 'object') return false
      const record = item as DynamicValueMap
      return record.id === modelId
    }) as { id?: string; modelType?: { imageEditing?: boolean } } | undefined
  } catch {
    return undefined
  }
}

const resolveCustomInputLimits = (params: DynamicValueMap) => {
  const customId = typeof params.modelscopeCustomModel === 'string' ? params.modelscopeCustomModel.trim() : ''
  if (!customId) {
    return { images: { max: 0 }, videos: { max: 0 } }
  }

  const model = getCustomModel(customId)
  const supportsImageEditing = model?.modelType?.imageEditing === true

  return {
    images: { max: supportsImageEditing ? 1 : 0 },
    videos: { max: 0 }
  }
}

export const modelscopeCustomModel = defineModel({
  meta: {
    id: 'modelscope-custom',
    provider: 'modelscope',
    type: 'image',
        i18nScope: 'models.defs.modelscope-custom',
    name: { key: 'meta.name', fallback: 'ModelScope Custom' },
    description: { key: 'meta.description', fallback: 'ModelScope custom model by ID' },
    tags: ['text-to-image', 'image-to-image', 'provider-modelscope'],
    polling: {
      interval: 3000,
      maxAttempts: 120,
      expectedAttempts: 40
    }
  },
  inputLimits: resolveCustomInputLimits,
  params: [
    {
      id: 'modelscopeCustomModel',
      type: 'composite',
      order: 1,
      name: sharedFieldText('model'),
      default: '',
      valueType: 'string',
      panel: 'modelscope-custom-model'
    },
    {
      id: 'modelscopeImageSize',
      type: 'dropdown',
      order: 2,
      name: sharedFieldText('aspectRatio'),
      default: '1:1',
      options: [
        { value: 'smart', label: sharedOptionText('smart') },
        ...MODELSCOPE_ASPECT_RATIO_OPTIONS
      ]
    },
    {
      id: 'resolutionBaseSize',
      type: 'number',
      order: 3,
      name: sharedFieldText('baseSize'),
      default: 1024,
      min: 512,
      max: 2048,
      step: 8
    },
    {
      id: 'modelscopeSteps',
      type: 'number',
      order: 4,
      name: sharedFieldText('steps'),
      default: 30,
      min: 1,
      max: 100,
      step: 1
    },
    {
      id: 'modelscopeGuidance',
      type: 'number',
      order: 5,
      name: sharedFieldText('guidance'),
      default: 7.5,
      min: 1.5,
      max: 20,
      step: 0.5
    }
  ],
  linkages: [],
  endpoints: MODELSCOPE_CREATE_TASK_ENDPOINT,
  request: {
    builder: (params) => {
      const customId = typeof params.modelscopeCustomModel === 'string' ? params.modelscopeCustomModel.trim() : ''
      if (!customId) {
        throw new Error('请先填写自定义模型ID')
      }
      return buildModelscopeRequest(params, {
        modelId: customId,
        allowGuidance: true,
        allowNegativePrompt: false,
        allowImage: true,
        baseSize: 1024
      })
    }
  },
  pricing: {
    currency: '¥',
    calculator: () => 0.12,
    description: '基础价格 ¥0.12/次'
  }
})

export default modelscopeCustomModel
