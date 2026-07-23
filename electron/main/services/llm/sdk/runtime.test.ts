import { describe, expect, it } from 'vitest'

import { cancelLlmTask, clearLlmTask, registerLlmTask } from '../task-registry'
import { classifyModelStepError } from './runtime'

describe('classifyModelStepError', () => {
  it('把显式取消归一化为 task_cancelled', () => {
    const controller = new AbortController()
    registerLlmTask('request-cancel', controller)
    cancelLlmTask('request-cancel')
    expect(classifyModelStepError('request-cancel', new Error('network closed')).message)
      .toContain('[task_cancelled]')
    clearLlmTask('request-cancel')
  })

  it('保留既有错误码并为未知错误分类', () => {
    expect(classifyModelStepError('request-1', new Error('[api_key_missing] missing')).message)
      .toBe('[api_key_missing] missing')
    expect(classifyModelStepError('request-2', new Error('boom')).message)
      .toBe('[model_step_failed] boom')
  })
})
