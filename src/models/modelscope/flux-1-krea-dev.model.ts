/**
 * ModelScope FLUX.1-Krea-dev 模型
 */

import { defineModel, sharedFieldText } from '@/core'
import { buildModelscopeRequest, MODELSCOPE_ASPECT_RATIO_OPTIONS, MODELSCOPE_CREATE_TASK_ENDPOINT } from './utils'

export const modelscopeFluxKreaDevModel = defineModel({
  meta: {
    id: 'black-forest-labs/FLUX.1-Krea-dev',
    provider: 'modelscope',
    type: 'image',
        i18nScope: 'models.defs.black-forest-labs/FLUX.1-Krea-dev',
    name: { key: 'meta.name', fallback: 'FLUX.1-Krea-dev' },
    description: { key: 'meta.description', fallback: 'ModelScope FLUX.1-Krea-dev text-to-image model' },
    tags: ['text-to-image', 'english-prompt-only', 'provider-modelscope'],
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
      default: 1024,
      min: 512,
      max: 2048,
      step: 8
    },
    {
      id: 'modelscopeSteps',
      type: 'number',
      order: 3,
      name: sharedFieldText('steps'),
      default: 30,
      min: 1,
      max: 100,
      step: 1
    },
    {
      id: 'modelscopeGuidance',
      type: 'number',
      order: 4,
      name: sharedFieldText('guidance'),
      default: 7.5,
      min: 1.5,
      max: 20,
      step: 0.5
    },
    {
      id: 'modelscopeNegativePrompt',
      type: 'text',
      order: 5,
      name: sharedFieldText('negativePrompt'),
      default: ''
    }
  ],
  linkages: [],
  endpoints: MODELSCOPE_CREATE_TASK_ENDPOINT,
  request: {
    builder: (params) => buildModelscopeRequest(params, {
      modelId: 'black-forest-labs/FLUX.1-Krea-dev',
      allowGuidance: true,
      allowNegativePrompt: true,
      allowImage: false,
      baseSize: 1024
    })
  },
  pricing: {
    currency: '¥',
    calculator: () => 0.12,
    description: '基础价格 ¥0.12/次'
  }
})

export default modelscopeFluxKreaDevModel
