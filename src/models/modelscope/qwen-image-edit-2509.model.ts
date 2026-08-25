/**
 * ModelScope Qwen-Image-Edit-2509 模型
 */

import { defineModel, sharedFieldText, sharedOptionText } from '@/core'
import { buildModelscopeRequest, MODELSCOPE_ASPECT_RATIO_OPTIONS, MODELSCOPE_CREATE_TASK_ENDPOINT } from './utils'

export const modelscopeQwenImageEdit2509Model = defineModel({
  meta: {
    id: 'Qwen/Qwen-Image-Edit-2509',
    canonicalModelId: 'qwen-image-edit-2509',
    provider: 'modelscope',
    type: 'image',
    i18nScope: 'models.defs.Qwen/Qwen-Image-Edit-2509',
    name: { key: 'meta.name', fallback: 'Qwen-Image-Edit-2509' },
    tags: ['image-to-image', 'supports-image-editing', 'supports-multi-image', 'provider-modelscope'],
    polling: {
      interval: 3000,
      maxAttempts: 120,
      expectedAttempts: 40
    }
  },
  inputLimits: {
    images: { min: 1, max: 3 },
    videos: { max: 0 }
  },
  requirements: [
    {
      id: 'qwen-image-edit-image',
      require: { images: { min: 1 } },
      message: {
        title: '图片必需',
        message: '图片编辑需要上传至少1张图片',
        type: 'warning'
      }
    },
    {
      id: 'qwen-image-edit-prompt',
      require: { prompt: true },
      message: {
        title: '提示词必需',
        message: '请输入编辑需求的提示词',
        type: 'warning'
      }
    }
  ],
  params: [
    {
      id: 'modelscopeImageSize',
      type: 'dropdown',
      order: 1,
      name: sharedFieldText('aspectRatio'),
      default: 'smart',
      options: [
        { value: 'smart', label: sharedOptionText('smart') },
        ...MODELSCOPE_ASPECT_RATIO_OPTIONS
      ]
    },
    {
      id: 'modelscopeSteps',
      type: 'number',
      order: 2,
      name: sharedFieldText('steps'),
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
