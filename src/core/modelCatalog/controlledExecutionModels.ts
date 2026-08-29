import type { ModelDefinition } from '@/core/types'

import {
  FAL_IMAGE_UTILITY_EXECUTION_MODELS,
  getFalImageUtilityExecutionModel,
} from './falUtilityExecutionModels'
import {
  MULTI_ANGLE_EXECUTION_MODELS,
  getMultiAngleExecutionModel,
} from './multiAngleExecutionModels'

/**
 * 宿主按产品能力显式装载的模型。它们可执行、可恢复，但不会进入普通模型选择器。
 */
export const CONTROLLED_EXECUTION_MODELS: readonly ModelDefinition[] = [
  ...FAL_IMAGE_UTILITY_EXECUTION_MODELS,
  ...MULTI_ANGLE_EXECUTION_MODELS,
]

export function getControlledExecutionModel(modelId: string): ModelDefinition | undefined {
  return getFalImageUtilityExecutionModel(modelId) ?? getMultiAngleExecutionModel(modelId)
}
