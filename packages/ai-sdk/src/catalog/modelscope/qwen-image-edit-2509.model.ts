/**
 * ModelScope Qwen-Image-Edit-2509 模型（运行时契约）
 */

import { defineModel } from '../defineModel'
import { buildModelscopeRequest, MODELSCOPE_ASPECT_RATIO_OPTIONS, MODELSCOPE_CREATE_TASK_ENDPOINT } from './utils'

export const modelscopeQwenImageEdit2509Model = defineModel({
  meta: {
    id: 'Qwen/Qwen-Image-Edit-2509',
    canonicalModelId: 'qwen-image-edit-2509',
    provider: 'modelscope',
    type: 'image',
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
      default: 'smart',
      options: [
        { value: 'smart' },
        ...MODELSCOPE_ASPECT_RATIO_OPTIONS
      ]
    },
    {
      id: 'modelscopeSteps',
      type: 'number',
      order: 2,
      default: 30,
      min: 1,
      max: 100,
      step: 1
    }
  ],
  endpoints: MODELSCOPE_CREATE_TASK_ENDPOINT,
  request: {
    builder: (params) => buildModelscopeRequest(params, {
      modelId: 'Qwen/Qwen-Image-Edit-2509',
      allowGuidance: false,
      allowNegativePrompt: false,
      allowImage: true,
      baseSize: 1024,
      sizeBounds: { min: 64, max: 1664 }
    })
  },
  pricing: {
    currency: '魔粒',
    calculator: () => 2,
    // 魔搭 API-Inference 不收钱，扣的是魔粒积分（ultra 档 2 魔粒/次）。
    // 日常免费额度约 250 魔粒/天（登录 200 + 绑定阿里云 50），过期不累积。
    description: '2 魔粒/次（ultra 档），魔搭免费额度约 250 魔粒/天'
  }
})

export default modelscopeQwenImageEdit2509Model
