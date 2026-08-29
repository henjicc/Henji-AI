import { describe, expect, it } from 'vitest'

import { registry } from '@/core/ModelRegistry'
import {
  MULTI_ANGLE_CONTINUOUS_MODEL_ID,
  MULTI_ANGLE_DISCRETE_MODEL_ID,
  MULTI_ANGLE_FLUX_MODEL_ID,
} from '@/features/canvas/capabilities/multiAnglePolicy'
import {
  MULTI_ANGLE_EXECUTION_MODELS,
  getMultiAngleExecutionModel,
} from './multiAngleExecutionModels'

describe('多角度按需执行模型', () => {
  it('可执行三个冻结模型，但不泄漏进普通模型注册表', () => {
    expect(MULTI_ANGLE_EXECUTION_MODELS.map((model) => model.meta.id)).toEqual([
      MULTI_ANGLE_CONTINUOUS_MODEL_ID,
      MULTI_ANGLE_DISCRETE_MODEL_ID,
      MULTI_ANGLE_FLUX_MODEL_ID,
    ])
    expect(getMultiAngleExecutionModel(MULTI_ANGLE_CONTINUOUS_MODEL_ID)?.meta.provider).toBe('fal')
    expect(getMultiAngleExecutionModel(MULTI_ANGLE_DISCRETE_MODEL_ID)?.meta.provider).toBe('fal')
    expect(getMultiAngleExecutionModel(MULTI_ANGLE_FLUX_MODEL_ID)).toMatchObject({
      meta: {
        provider: 'fal',
        name: { zh: 'FLUX 2 多角度', en: 'FLUX 2 Multiple Angles' },
      },
    })
    expect(getMultiAngleExecutionModel(MULTI_ANGLE_FLUX_MODEL_ID)?.params).toMatchObject([
      { id: 'image', type: 'image-upload', maxCount: 1 },
      { id: 'horizontalAngle', min: 0, max: 360 },
      { id: 'verticalAngle', min: 0, max: 60 },
      { id: 'zoom', min: 0, max: 10 },
    ])
    expect(registry.getModel(MULTI_ANGLE_CONTINUOUS_MODEL_ID)).toBeUndefined()
    expect(registry.getModel(MULTI_ANGLE_DISCRETE_MODEL_ID)).toBeUndefined()
    expect(registry.getModel(MULTI_ANGLE_FLUX_MODEL_ID)).toBeUndefined()
  })
})
