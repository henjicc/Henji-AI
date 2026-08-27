/**
 * ModelScope Qwen-Image 模型（运行时契约）
 */

import { defineModel } from '../defineModel'
import { buildModelscopeRequest, MODELSCOPE_ASPECT_RATIO_OPTIONS, MODELSCOPE_CREATE_TASK_ENDPOINT } from './utils'

export const modelscopeQwenImageModel = defineModel({
  meta: {
    id: 'Qwen/Qwen-Image',
    canonicalModelId: 'qwen-image',
    provider: 'modelscope',
    type: 'image',
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
      default: '1:1',
      options: MODELSCOPE_ASPECT_RATIO_OPTIONS
    },
    {
      id: 'resolutionBaseSize',
      type: 'number',
      order: 2,
      default: 1024,
      min: 64,
      max: 1664,
      step: 8
    },
    {
      id: 'modelscopeSteps',
      type: 'number',
      order: 3,
      default: 30,
      min: 1,
      max: 100,
      step: 1
    },
    {
      id: 'modelscopeGuidance',
      type: 'number',
      order: 4,
      default: 7.5,
      min: 1.5,
      max: 20,
      step: 0.5
    },
    {
      id: 'modelscopeNegativePrompt',
      type: 'text',
      order: 5,
      default: ''
    }
  ],
  endpoints: MODELSCOPE_CREATE_TASK_ENDPOINT,
  request: {
    builder: (params) => buildModelscopeRequest(params, {
      modelId: 'Qwen/Qwen-Image',
      allowGuidance: true,
      allowNegativePrompt: true,
      allowImage: false,
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

export default modelscopeQwenImageModel
