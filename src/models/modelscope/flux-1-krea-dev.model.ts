/**
 * ModelScope FLUX.1-Krea-dev 模型
 */

import { defineModel } from '@/core'
import { buildModelscopeRequest, MODELSCOPE_ASPECT_RATIO_OPTIONS, MODELSCOPE_CREATE_TASK_ENDPOINT } from './utils'

export const modelscopeFluxKreaDevModel = defineModel({
  meta: {
    id: 'black-forest-labs/FLUX.1-Krea-dev',
    provider: 'modelscope',
    type: 'image',
    name: { zh: 'FLUX.1-Krea-dev', en: 'FLUX.1-Krea-dev' },
    description: { zh: '魔搭 FLUX.1-Krea-dev 文生图模型', en: 'ModelScope FLUX.1-Krea-dev text-to-image model' },
    tags: ['text-to-image', 'provider-modelscope'],
    polling: {
      interval: 3000,
      maxAttempts: 120,
      expectedAttempts: 40
    }
  },
  params: [
    {
      id: 'modelscopeImageSize',
      type: 'dropdown',
      order: 1,
      name: { zh: '宽高比', en: 'Aspect Ratio' },
      default: '1:1',
      options: MODELSCOPE_ASPECT_RATIO_OPTIONS
    },
    {
      id: 'resolutionBaseSize',
      type: 'number',
      order: 2,
      name: { zh: '基数', en: 'Base Size' },
      default: 1024,
      min: 512,
      max: 2048,
      step: 8
    },
    {
      id: 'modelscopeSteps',
      type: 'number',
      order: 3,
      name: { zh: '采样步数', en: 'Steps' },
      default: 30,
      min: 1,
      max: 100,
      step: 1
    },
    {
      id: 'modelscopeGuidance',
      type: 'number',
      order: 4,
      name: { zh: '提示词引导系数', en: 'Guidance' },
      default: 7.5,
      min: 1.5,
      max: 20,
      step: 0.5
    },
    {
      id: 'modelscopeNegativePrompt',
      type: 'text',
      order: 5,
      name: { zh: '负面提示词', en: 'Negative Prompt' },
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
