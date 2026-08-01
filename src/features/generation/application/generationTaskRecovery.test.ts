import { describe, expect, it } from 'vitest'

import { createGenerationTaskRecoveryAdvice } from './generationTaskRecovery'

describe('generation task recovery policy', () => {
  it('将供应商比例校验错误归类为同模型参数修正', () => {
    expect(createGenerationTaskRecoveryAdvice({
      taskId: 'task-z-image',
      modelId: 'kie-z-image',
      status: 'error',
      errorCode: 'GENERATION_FAILED',
      errorMessage: 'Generation failed: This aspect_ratio is not within the range of allowed options',
    })).toMatchObject({
      strategy: 'correct_same_model_parameters',
      sourceTaskId: 'task-z-image',
      sourceModelId: 'kie-z-image',
      fallbackAllowed: false,
    })
  })

  it('不会把非参数类失败误判为自动修正', () => {
    expect(createGenerationTaskRecoveryAdvice({
      taskId: 'task-network',
      modelId: 'kie-z-image',
      status: 'error',
      errorCode: 'GENERATION_FAILED',
      errorMessage: 'Provider service temporarily unavailable',
    })).toBeNull()
  })
})
