/**
 * ModelScope 自定义模型
 */

import { defineModel } from '@/core'
import { buildModelscopeRequest, MODELSCOPE_ASPECT_RATIO_OPTIONS, MODELSCOPE_CREATE_TASK_ENDPOINT } from './utils'

export const modelscopeCustomModel = defineModel({
  meta: {
    id: 'modelscope-custom',
    provider: 'modelscope',
    type: 'image',
    name: { zh: '魔搭自定义模型', en: 'ModelScope Custom' },
    description: { zh: '使用自定义模型ID的魔搭推理模型', en: 'ModelScope custom model by ID' },
    tags: ['text-to-image', 'image-to-image', 'provider-modelscope'],
    polling: {
      interval: 3000,
      maxAttempts: 120,
      expectedAttempts: 40
    }
  },
  params: [
    {
      id: 'modelscopeCustomModel',
      type: 'composite',
      order: 1,
      name: { zh: '模型', en: 'Model' },
      default: '',
      valueType: 'string',
      panel: 'modelscope-custom-model'
    },
    {
      id: 'modelscopeImageSize',
      type: 'dropdown',
      order: 2,
      name: { zh: '宽高比', en: 'Aspect Ratio' },
      default: '1:1',
      options: [
        { value: 'smart', label: { zh: '智能', en: 'Smart' } },
        ...MODELSCOPE_ASPECT_RATIO_OPTIONS
      ]
    },
    {
      id: 'resolutionBaseSize',
      type: 'number',
      order: 3,
      name: { zh: '基数', en: 'Base Size' },
      default: 1024,
      min: 512,
      max: 2048,
      step: 8
    },
    {
      id: 'modelscopeSteps',
      type: 'number',
      order: 4,
      name: { zh: '采样步数', en: 'Steps' },
      default: 30,
      min: 1,
      max: 100,
      step: 1
    },
    {
      id: 'modelscopeGuidance',
      type: 'number',
      order: 5,
      name: { zh: '提示词引导系数', en: 'Guidance' },
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
