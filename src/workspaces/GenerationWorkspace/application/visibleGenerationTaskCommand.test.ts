// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'

import { registry } from '@/core/ModelRegistry'
import type { ModelDefinition } from '@/core/types'
import {
  createVisibleGenerationTask,
  getVisibleGenerationTask,
  getVisibleGenerationTaskResult,
  registerVisibleGenerationTaskHandler,
} from './visibleGenerationTaskCommand'

function testModel(id: string, provider: string): ModelDefinition {
  return {
    meta: {
      id, canonicalModelId: 'nano-banana', provider, type: 'image',
      name: { zh: id, en: id }, tags: ['text-to-image'],
    },
    inputLimits: { images: { max: 0 }, videos: { max: 0 }, audios: { max: 0 } },
    params: [], linkages: [], endpoints: '/test', request: { builder: (value) => value },
    pricing: { currency: '$', fixed: 1, description: 'test' },
  }
}

describe('visible generation task internal result contract', () => {
  let unregister: (() => void) | null = null
  afterEach(() => {
    unregister?.()
    unregister = null
    if (registry.hasModel('missing-key-model')) registry.unregister('missing-key-model')
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

  it('供应商密钥未配置时不创建可见任务并触发配置提示', async () => {
    registry.register(testModel('missing-key-model', 'apimart'))
    const appendTask = vi.fn()
    const executeTask = vi.fn()
    const onProviderKeyMissing = vi.fn()
    const validateProviderKey = vi.fn().mockResolvedValue(false)

    const taskId = await createVisibleGenerationTask({
      input: '生成一张海报', model: 'missing-key-model', type: 'image', options: {},
    }, {
      appendTask,
      updateTask: vi.fn(),
      executeTask,
      setGenerating: vi.fn(),
      notify: vi.fn(),
      validateProviderKey,
      onProviderKeyMissing,
      messages: { testModeIntercepted: '测试模式', missingInput: '缺少输入' },
      imageEditStates: new Map(),
    })

    expect(taskId).toBeNull()
    expect(validateProviderKey).toHaveBeenCalledWith('apimart')
    expect(onProviderKeyMissing).toHaveBeenCalledOnce()
    expect(appendTask).not.toHaveBeenCalled()
    expect(executeTask).not.toHaveBeenCalled()
  })
})
