/**
 * ModelScope 自定义模型（运行时契约）
 */

import { defineModel } from '../defineModel'
import { buildModelscopeRequest, MODELSCOPE_ASPECT_RATIO_OPTIONS, MODELSCOPE_CREATE_TASK_ENDPOINT } from './utils'
import { getModelscopeCustomModel } from './customModelRegistry'
import type { JsonObject } from '../../types/runtime'

const resolveCustomInputLimits = (params: JsonObject) => {
  const customId = typeof params.modelscopeCustomModel === 'string' ? params.modelscopeCustomModel.trim() : ''
  if (!customId) {
    return { images: { max: 0 }, videos: { max: 0 } }
  }

  const model = getModelscopeCustomModel(customId)
  const supportsImageEditing = model?.modelType?.imageEditing === true

  return {
    images: { max: supportsImageEditing ? 1 : 0 },
    videos: { max: 0 }
  }
}

export const modelscopeCustomModel = defineModel({
  meta: {
    id: 'modelscope-custom',
    canonicalModelId: 'modelscope-custom',
    provider: 'modelscope',
    type: 'image',
    tags: ['text-to-image', 'image-to-image', 'provider-modelscope'],
    polling: {
      interval: 3000,
      maxAttempts: 120,
      expectedAttempts: 40
    }
  },
  inputLimits: resolveCustomInputLimits,
  params: [
    {
      id: 'modelscopeCustomModel',
      type: 'composite',
      order: 1,
      default: '',
      valueType: 'string'
    },
    {
      id: 'modelscopeImageSize',
      type: 'dropdown',
      order: 2,
      default: '1:1',
      options: [
        { value: 'smart' },
        ...MODELSCOPE_ASPECT_RATIO_OPTIONS
      ]
    },
    {
      id: 'resolutionBaseSize',
      type: 'number',
      order: 3,
      default: 1024,
      min: 512,
      max: 2048,
      step: 8
    },
    {
      id: 'modelscopeSteps',
      type: 'number',
      order: 4,
      default: 30,
      min: 1,
      max: 100,
      step: 1
    },
    {
      id: 'modelscopeGuidance',
      type: 'number',
      order: 5,
      default: 7.5,
      min: 1.5,
      max: 20,
      step: 0.5
    }
  ],
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
    currency: '魔粒',
    calculator: (params) => {
      const customId = typeof params.modelscopeCustomModel === 'string'
        ? params.modelscopeCustomModel.trim()
        : ''
      const magicGrainCost = customId
        ? getModelscopeCustomModel(customId)?.magicGrainCost
        : undefined
      return typeof magicGrainCost === 'number' && Number.isFinite(magicGrainCost)
        ? magicGrainCost
        : Number.NaN
    },
    description: '按保存模型时查询到的官方档位扣魔粒；档位未知时不显示确定估价'
  }
})

export default modelscopeCustomModel
