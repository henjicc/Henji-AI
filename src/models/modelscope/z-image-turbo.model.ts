/**
 * ModelScope Z-Image-Turbo 模型
 */

import { defineModel } from '@/core'
import { buildModelscopeRequest, MODELSCOPE_ASPECT_RATIO_OPTIONS, MODELSCOPE_CREATE_TASK_ENDPOINT } from './utils'

export const modelscopeZImageTurboModel = defineModel({
  meta: {
    id: 'Tongyi-MAI/Z-Image-Turbo',
    provider: 'modelscope',
    type: 'image',
    name: { zh: 'Z-Image-Turbo', en: 'Z-Image-Turbo' },
    description: { zh: '魔搭 Z-Image-Turbo 文生图模型', en: 'ModelScope Z-Image-Turbo text-to-image model' },
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
      name: { zh: '宽高比', en: 'Aspect Ratio' },
      default: '1:1',
      options: MODELSCOPE_ASPECT_RATIO_OPTIONS
    },
    {
      id: 'resolutionBaseSize',
      type: 'number',
      order: 2,
      name: { zh: '基数', en: 'Base Size' },
      default: 1440,
      min: 512,
      max: 2048,
      step: 8
    },
    {
      id: 'modelscopeSteps',
      type: 'number',
      order: 3,
      name: { zh: '采样步数', en: 'Steps' },
      default: 10,
      min: 1,
      max: 100,
      step: 1
    },
    {
      id: 'modelscopeNegativePrompt',
      type: 'text',
      order: 4,
      name: { zh: '负面提示词', en: 'Negative Prompt' },
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
