// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'

import { registry } from '@/core/ModelRegistry'
import { GenerationPreparationError } from '@/features/generation/application/generationPreparationService'
import type { ModelDefinition } from '@/core/types'
import {
  createVisibleGenerationTask,
  getVisibleGenerationTask,
  getVisibleGenerationTaskResult,
  registerVisibleGenerationTaskHandler,
} from './visibleGenerationTaskCommand'

vi.mock('@/commands/image', async (original) => ({
  ...await original<typeof import('@/commands/image')>(),
  readImageInfo: vi.fn(async () => ({ width: 200, height: 800, orientation: null })),
}))

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
    for (const id of ['missing-key-model', 'min-side-model']) if (registry.hasModel(id)) registry.unregister(id)
  })

  it('公开状态不携带媒体地址，内部组合入口可读取完整结果', () => {
    unregister = registerVisibleGenerationTaskHandler({
      create: async () => 'task-1',
      get: () => ({
        taskId: 'task-1', status: 'success', progress: 100, modelId: 'model-1',
        mediaType: 'image', resultAvailable: true, errorCode: null, errorMessage: null,
      }),
      getResult: () => ({
        taskId: 'task-1', mediaType: 'image', urls: ['henji-media://result'],
        filePaths: ['C:/private/result.png'], prompt: '海报',
      }),
      list: () => [],
      cancel: async () => ({ status: 'cancelled' }),
    })

    expect(getVisibleGenerationTask('task-1')).not.toHaveProperty('url')
    expect(getVisibleGenerationTaskResult('task-1')).toMatchObject({
      taskId: 'task-1', filePaths: ['C:/private/result.png'],
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

  it('素材尺寸不合格时抛出原因交给调用方，不创建可见任务', async () => {
    registry.register({ ...testModel('min-side-model', 'apimart'),
      inputLimits: { images: { max: 1 }, rules: [{ imageConstraints: { minShortSidePx: 300 } }] } })
    const appendTask = vi.fn()
    const notify = vi.fn()
    const created = createVisibleGenerationTask({
      input: '生成一张海报', model: 'min-side-model', type: 'image',
      options: { images: ['henji-media://small.png'], uploadedFilePaths: ['D:/small.png'] },
    }, {
      appendTask, updateTask: vi.fn(), executeTask: vi.fn(), setGenerating: vi.fn(), notify,
      validateProviderKey: vi.fn().mockResolvedValue(true), onProviderKeyMissing: vi.fn(),
      messages: { testModeIntercepted: '测试模式', missingInput: '缺少输入' },
      imageEditStates: new Map(),
    })
    const error = await created.catch((rejected: unknown) => rejected)
    expect(error).toBeInstanceOf(GenerationPreparationError)
    expect((error as Error).message).toContain('the image (200×800) must be at least 300 px on both sides')
    expect(appendTask).not.toHaveBeenCalled()
    expect(notify).not.toHaveBeenCalled()
  })
})
