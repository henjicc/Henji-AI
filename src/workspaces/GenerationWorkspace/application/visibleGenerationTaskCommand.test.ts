// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'

import {
  getVisibleGenerationTask,
  getVisibleGenerationTaskResult,
  registerVisibleGenerationTaskHandler,
} from './visibleGenerationTaskCommand'

describe('visible generation task internal result contract', () => {
  let unregister: (() => void) | null = null
  afterEach(() => {
    unregister?.()
    unregister = null
  })

  it('公开状态不携带媒体地址，内部组合入口可读取完整结果', () => {
    unregister = registerVisibleGenerationTaskHandler({
      create: async () => 'task-1',
      get: () => ({
        taskId: 'task-1', status: 'success', progress: 100, modelId: 'model-1',
        mediaType: 'image', resultAvailable: true, errorCode: null, errorMessage: null,
      }),
      getResult: () => ({
        taskId: 'task-1', mediaType: 'image', url: 'henji-media://result',
        filePath: 'C:/private/result.png', prompt: '海报',
      }),
      list: () => [],
      cancel: async () => ({ status: 'cancelled' }),
    })

    expect(getVisibleGenerationTask('task-1')).not.toHaveProperty('url')
    expect(getVisibleGenerationTaskResult('task-1')).toMatchObject({
      taskId: 'task-1', filePath: 'C:/private/result.png',
    })
  })
})
