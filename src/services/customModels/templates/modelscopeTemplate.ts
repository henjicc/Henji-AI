/**
 * ModelScope 自定义模型模板
 *
 * 为 ModelScope 平台的自定义模型生成标准配置
 */

import { CustomModelConfig } from '@/core/types/CustomModel'
import { ParamDef } from '@/core/types'

/**
 * 创建 ModelScope 自定义模型配置
 */
export function createModelscopeCustomModelConfig(
  modelId: string,
  modelName: string,
  modelUrl: string,
  type: 'image' | 'video' | 'audio'
): CustomModelConfig {
  const baseParams: ParamDef[] = [
    {
      id: 'prompt',
      component: 'text',
      order: 1,
      name: { zh: '提示词', en: 'Prompt' },
      valueType: 'string',
      default: '',
      required: true,
      api: 'input.prompt'
    },
    {
      id: 'negativePrompt',
      component: 'text',
      order: 2,
      name: { zh: '负面提示词', en: 'Negative Prompt' },
      valueType: 'string',
      default: '',
      required: false,
      api: 'input.negative_prompt'
    }
  ]

  // 根据类型添加特定参数
  if (type === 'image') {
    baseParams.push(
      {
        id: 'width',
        component: 'number',
        order: 3,
        name: { zh: '宽度', en: 'Width' },
        valueType: 'number',
        default: 1024,
        min: 512,
        max: 2048,
        step: 64,
        api: 'parameters.width'
      },
      {
        id: 'height',
        component: 'number',
        order: 4,
        name: { zh: '高度', en: 'Height' },
        valueType: 'number',
        default: 1024,
        min: 512,
        max: 2048,
        step: 64,
        api: 'parameters.height'
      },
      {
        id: 'numInferenceSteps',
        component: 'number',
        order: 5,
        name: { zh: '推理步数', en: 'Inference Steps' },
        valueType: 'number',
        default: 20,
        min: 1,
        max: 100,
        step: 1,
        api: 'parameters.num_inference_steps'
      }
    )
  }

  return {
    meta: {
      id: modelId,
      name: modelName,
      description: `自定义 ModelScope ${type} 模型`,
      provider: 'modelscope',
      type,
      tags: ['custom', type]
    },

    params: baseParams,

    endpoints: {
      primary: modelUrl
    },

    request: {
      baseParams: {
        task: type === 'image' ? 'text-to-image' : type
      }
    },

    pricing: {
      type: 'fixed',
      basePrice: 0.01
    }
  }
}
