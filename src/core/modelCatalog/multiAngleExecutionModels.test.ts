import { describe, expect, it } from 'vitest'

import { registry } from '@/core/ModelRegistry'
import {
  MULTI_ANGLE_CONTINUOUS_MODEL_ID,
  MULTI_ANGLE_DISCRETE_MODEL_ID,
} from '@/features/canvas/capabilities/multiAnglePolicy'
import {
  MULTI_ANGLE_EXECUTION_MODELS,
  getMultiAngleExecutionModel,
} from './multiAngleExecutionModels'

describe('多角度按需执行模型', () => {
  it('可执行两个冻结模型，但不泄漏进普通模型注册表', () => {
    expect(MULTI_ANGLE_EXECUTION_MODELS.map((model) => model.meta.id)).toEqual([
      MULTI_ANGLE_CONTINUOUS_MODEL_ID,
      MULTI_ANGLE_DISCRETE_MODEL_ID,
    ])
    expect(getMultiAngleExecutionModel(MULTI_ANGLE_CONTINUOUS_MODEL_ID)?.meta.provider).toBe('fal')
    expect(getMultiAngleExecutionModel(MULTI_ANGLE_DISCRETE_MODEL_ID)?.meta.provider).toBe('fal')
    expect(registry.getModel(MULTI_ANGLE_CONTINUOUS_MODEL_ID)).toBeUndefined()
    expect(registry.getModel(MULTI_ANGLE_DISCRETE_MODEL_ID)).toBeUndefined()
  })
})
