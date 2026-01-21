/**
 * ModelScope 自定义模型模板
 *
 * 为 ModelScope 平台的自定义模型生成标准配置
 */

import { CustomModelConfig } from '@/core/types/CustomModel'
import { ParamDefinition } from '@/core/types/ModelDefinition'

/**
 * 创建 ModelScope 自定义模型配置
 */
export function createModelscopeCustomModelConfig(
  modelId: string,
  modelName: string,
  modelUrl: string,
  type: 'image' | 'video' | 'audio'
): CustomModelConfig {
  const baseParams: ParamDefinition[] = [
    {
      id: 'prompt',
      label: '提示词',
      type: 'textarea',
      defaultValue: '',
      required: true,
      apiField: 'input.prompt'
    },
    {
      id: 'negativePrompt',
      label: '负面提示词',
      type: 'textarea',
      defaultValue: '',
      required: false,
      apiField: 'input.negative_prompt'
    }
  ]

  // 根据类型添加特定参数
  if (type === 'image') {
    baseParams.push(
      {
        id: 'width',
        label: '宽度',
        type: 'number',
        defaultValue: 1024,
        min: 512,
        max: 2048,
        step: 64,
        apiField: 'parameters.width'
      },
      {
        id: 'height',
        label: '高度',
        type: 'number',
        defaultValue: 1024,
        min: 512,
        max: 2048,
        step: 64,
        apiField: 'parameters.height'
      },
      {
        id: 'numInferenceSteps',
        label: '推理步数',
        type: 'number',
        defaultValue: 20,
        min: 1,
        max: 100,
        step: 1,
        apiField: 'parameters.num_inference_steps'
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
