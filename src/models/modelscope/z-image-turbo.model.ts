/**
 * ModelScope Z-Image-Turbo 模型
 */

import { defineModel, sharedFieldText } from '@/core'
import { buildModelscopeRequest, MODELSCOPE_ASPECT_RATIO_OPTIONS, MODELSCOPE_CREATE_TASK_ENDPOINT } from './utils'

export const modelscopeZImageTurboModel = defineModel({
  meta: {
    id: 'Tongyi-MAI/Z-Image-Turbo',
    provider: 'modelscope',
    type: 'image',
        i18nScope: 'models.defs.Tongyi-MAI/Z-Image-Turbo',
    name: { key: 'meta.name', fallback: 'Z-Image-Turbo' },
    description: { key: 'meta.description', fallback: 'ModelScope Z-Image-Turbo text-to-image model' },
    tags: ['text-to-image', 'provider-modelscope'],
    polling: {
      interval: 3000,
      maxAttempts: 120,
      expectedAttempts: 40
    }
  },
  inputLimits: {
    images: { max: 0 },
    videos: { max: 0 }
  },
  params: [
    {
      id: 'modelscopeImageSize',
      type: 'dropdown',
      order: 1,
      name: sharedFieldText('aspectRatio'),
      default: '1:1',
      options: MODELSCOPE_ASPECT_RATIO_OPTIONS
    },
    {
      id: 'resolutionBaseSize',
      type: 'number',
      order: 2,
      name: sharedFieldText('baseSize'),
      default: 1440,
      min: 512,
      max: 2048,
      step: 8
    },
    {
      id: 'modelscopeSteps',
      type: 'number',
      order: 3,
      name: sharedFieldText('steps'),
      default: 10,
      min: 1,
      max: 100,
      step: 1
    },
    {
      id: 'modelscopeNegativePrompt',
      type: 'text',
      order: 4,
      name: sharedFieldText('negativePrompt'),
      default: ''
    }
  ],
  linkages: [],
  endpoints: MODELSCOPE_CREATE_TASK_ENDPOINT,
  request: {
    builder: (params) => buildModelscopeRequest(params, {
      modelId: 'Tongyi-MAI/Z-Image-Turbo',
      allowGuidance: false,
      allowNegativePrompt: true,
      allowImage: false,
      baseSize: 1440
    })
  },
  pricing: {
    currency: '¥',
    calculator: () => 0.12,
    description: '基础价格 ¥0.12/次'
  }
})

export default modelscopeZImageTurboModel
