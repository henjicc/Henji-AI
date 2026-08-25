/**
 * ModelScope 自定义模型
 */

import { defineModel, sharedFieldText, sharedOptionText } from '@/core'
import { buildModelscopeRequest, MODELSCOPE_ASPECT_RATIO_OPTIONS, MODELSCOPE_CREATE_TASK_ENDPOINT } from './utils'
import { getModelscopeCustomModel } from './customModelRegistry'

const resolveCustomInputLimits = (params: DynamicValueMap) => {
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
        i18nScope: 'models.defs.modelscope-custom',
    name: { key: 'meta.name', fallback: 'ModelScope Custom' },
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
      name: sharedFieldText('model'),
      default: '',
      valueType: 'string',
      panel: 'modelscope-custom-model'
    },
    {
      id: 'modelscopeImageSize',
      type: 'dropdown',
      order: 2,
      name: sharedFieldText('aspectRatio'),
      default: '1:1',
      options: [
        { value: 'smart', label: sharedOptionText('smart') },
        ...MODELSCOPE_ASPECT_RATIO_OPTIONS
      ]
    },
    {
      id: 'resolutionBaseSize',
      type: 'number',
      order: 3,
      name: sharedFieldText('baseSize'),
      default: 1024,
      min: 512,
      max: 2048,
      step: 8
    },
    {
      id: 'modelscopeSteps',
      type: 'number',
      order: 4,
      name: sharedFieldText('steps'),
      default: 30,
      min: 1,
      max: 100,
      step: 1
    },
    {
      id: 'modelscopeGuidance',
      type: 'number',
      order: 5,
      name: sharedFieldText('guidance'),
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
    currency: '魔粒',
    // 自定义模型的档位取决于用户填入的模型（轻量 0.5 / 主流 1 / 旗舰 2 魔粒），
    // 无法在提交前预知，按主流档展示。
    calculator: () => 1,
    description: '按模型档位扣魔粒：轻量 0.5、主流 1、旗舰 2 魔粒/次'
  }
})

export default modelscopeCustomModel
