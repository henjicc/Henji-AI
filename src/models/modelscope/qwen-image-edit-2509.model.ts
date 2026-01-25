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
        i18nScope: 'models.defs.Qwen/Qwen-Image-Edit-2509',
    name: { key: 'meta.name', fallback: 'Qwen-Image-Edit-2509' },
    description: { key: 'meta.description', fallback: 'ModelScope Qwen image editing model (image required)' },
    tags: ['image-to-image', 'supports-image-editing', 'provider-modelscope'],
    polling: {
      interval: 3000,
      maxAttempts: 120,
      expectedAttempts: 40
    }
  },
  inputLimits: {
    images: { exact: 1 },
    videos: { max: 0 }
  },
  requirements: [
    {
      id: 'qwen-image-edit-image',
      require: { images: { exact: 1 } },
      message: {
        title: '图片必需',
        message: '图像编辑需要上传1张图片',
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
      name: { key: 'auto.1', fallback: 'Aspect Ratio' },
      default: 'smart',
      options: [
        { value: 'smart', label: { key: 'auto.2', fallback: 'Smart' } },
        ...MODELSCOPE_ASPECT_RATIO_OPTIONS
      ]
    },
    {
      id: 'modelscopeSteps',
      type: 'number',
      order: 2,
      name: { key: 'auto.3', fallback: 'Steps' },
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
