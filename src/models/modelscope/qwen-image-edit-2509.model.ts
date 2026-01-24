/**
 * ModelScope Qwen-Image-Edit-2509 模型
 */

import { defineModel } from '@/core'
import { buildModelscopeRequest, MODELSCOPE_ASPECT_RATIO_OPTIONS, MODELSCOPE_CREATE_TASK_ENDPOINT } from './utils'

export const modelscopeQwenImageEdit2509Model = defineModel({
  meta: {
    id: 'Qwen/Qwen-Image-Edit-2509',
    provider: 'modelscope',
    type: 'image',
    name: { zh: 'Qwen-Image-Edit-2509', en: 'Qwen-Image-Edit-2509' },
    description: { zh: '魔搭 Qwen 图像编辑模型（需上传图片）', en: 'ModelScope Qwen image editing model (image required)' },
    tags: ['image-to-image', 'supports-image-editing', 'provider-modelscope'],
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
      default: 'smart',
      options: [
        { value: 'smart', label: { zh: '智能', en: 'Smart' } },
        ...MODELSCOPE_ASPECT_RATIO_OPTIONS
      ]
    },
    {
      id: 'modelscopeSteps',
      type: 'number',
      order: 2,
      name: { zh: '采样步数', en: 'Steps' },
      default: 30,
      min: 1,
      max: 100,
      step: 1
    }
  ],
  linkages: [],
  endpoints: MODELSCOPE_CREATE_TASK_ENDPOINT,
  request: {
    builder: (params) => buildModelscopeRequest(params, {
      modelId: 'Qwen/Qwen-Image-Edit-2509',
      allowGuidance: false,
      allowNegativePrompt: false,
      allowImage: true,
      baseSize: 1024
    })
  },
  pricing: {
    currency: '¥',
    calculator: () => 0.12,
    description: '基础价格 ¥0.12/次'
  }
})

export default modelscopeQwenImageEdit2509Model
