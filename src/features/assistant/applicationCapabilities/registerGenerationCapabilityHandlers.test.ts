// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  submit: vi.fn(),
  resolveModel: vi.fn(),
}))

vi.mock('@/features/generation/application/generationApplicationService', () => ({
  generationApplicationService: {
    searchModels: vi.fn(),
    getModelSchema: vi.fn(),
    prepare: mocks.prepare,
    submit: mocks.submit,
    resolveModel: mocks.resolveModel,
    getTask: vi.fn(),
    cancelTask: vi.fn(),
  },
}))
vi.mock('@/stores/navigationStore', () => ({ switchWorkspace: vi.fn() }))

import { registry } from '@/core/ModelRegistry'
import type { ModelDefinition } from '@/core/types'
import { useGenerationDraftStore } from '@/features/generation/store/generationDraftStore'
import { createEmptyGenerationDraft } from '@/features/generation/domain/generationDraft'

import type { CapabilityHandler } from './handlerTypes'
import { registerGenerationCapabilityHandlers } from './registerGenerationCapabilityHandlers'

const context = { signal: new AbortController().signal }

const testModel: ModelDefinition = {
  meta: {
    id: 'generation-handler-test-model',
    canonicalModelId: 'nano-banana',
    provider: 'handler-test-provider',
    type: 'image',
    name: { zh: '生成能力测试模型', en: 'Generation capability test model' },
    tags: [],
  },
  inputLimits: { images: { max: 1 }, videos: { max: 0 }, audios: { max: 0 } },
  params: [],
  linkages: [],
  endpoints: '/test',
  request: { builder: (params) => params },
  pricing: { currency: '$', fixed: 0.5, description: '测试模型基础价格' },
}

function registeredHandlers(): Map<string, CapabilityHandler> {
  const handlers = new Map<string, CapabilityHandler>()
  registerGenerationCapabilityHandlers({
    registerHandler: (id, handler) => handlers.set(id, handler),
  })
  return handlers
}

/*
 * 5.4：验证 create_visible_generation_task/prepare_generation_task 放宽后的两条路径——
 * 省略字段时用当前 generation.draft 补全、显式传参时仍按传入值走（兼容性）。这是任务
 * 文档要求的"这是放宽而不是改变，现有调用方式必须继续工作"的最终验证。
 */
describe('generation capability handlers（5.4：放宽提交）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    registry.clear()
    registry.register(testModel)
    useGenerationDraftStore.setState({ draft: createEmptyGenerationDraft(), revision: 0 })
    mocks.submit.mockResolvedValue({ taskId: 'task-1', status: 'submitted', taskRef: { kind: 'generation.task', id: 'task-1' } })
    mocks.prepare.mockReturnValue({ prepared: true, modelId: testModel.meta.id, providerId: testModel.meta.provider, mediaType: 'image', options: {} })
    mocks.resolveModel.mockResolvedValue({ modelId: testModel.meta.id, providerId: testModel.meta.provider, selection: 'configured_fallback' })
  })

  afterEach(() => {
    registry.clear()
  })

  it('不传任何字段时，提交用的是当前草稿（模型/提示词/已上传媒体）', async () => {
    useGenerationDraftStore.getState().patchField('selectedModel', testModel.meta.id)
    useGenerationDraftStore.getState().patchField('selectedProvider', testModel.meta.provider)
    useGenerationDraftStore.getState().setLegacyInput('草稿里的提示词')
    useGenerationDraftStore.getState().patchField('uploadedFilePaths', ['/draft-image.png'])

    const handler = registeredHandlers().get('create_visible_generation_task')
    if (!handler) throw new Error('HANDLER_NOT_FOUND')
    await handler({}, context)

    expect(mocks.submit).toHaveBeenCalledTimes(1)
    const submitted = mocks.submit.mock.calls[0][0]
    expect(submitted.modelId).toBe(testModel.meta.id)
    expect(submitted.prompt).toBe('草稿里的提示词')
    expect(submitted.mediaType).toBe('image')
    expect(submitted.options.uploadedFilePaths).toEqual(['/draft-image.png'])
  })

  it('显式传参数时仍按传入值走，不与草稿合并（兼容性）', async () => {
    useGenerationDraftStore.getState().patchField('selectedModel', testModel.meta.id)
    useGenerationDraftStore.getState().patchField('selectedProvider', testModel.meta.provider)
    useGenerationDraftStore.getState().patchField('uploadedFilePaths', ['/draft-image.png'])

    const handler = registeredHandlers().get('create_visible_generation_task')
    if (!handler) throw new Error('HANDLER_NOT_FOUND')
    await handler({
      modelId: testModel.meta.id,
      prompt: '显式传入的提示词',
      mediaType: 'image',
      params: { explicitOnly: true },
    }, context)

    expect(mocks.submit).toHaveBeenCalledTimes(1)
    const submitted = mocks.submit.mock.calls[0][0]
    expect(submitted.prompt).toBe('显式传入的提示词')
    expect(submitted.options).toEqual({ explicitOnly: true })
  })

  it('只省略 mediaType 时从 modelId 对应的模型推断', async () => {
    const handler = registeredHandlers().get('create_visible_generation_task')
    if (!handler) throw new Error('HANDLER_NOT_FOUND')
    await handler({ modelId: testModel.meta.id, prompt: '文本' }, context)

    const submitted = mocks.submit.mock.calls[0][0]
    expect(submitted.mediaType).toBe('image')
  })

  it('即使知道受控模型 id，也不能通过通用生成处理器提交', async () => {
    const controlled = {
      ...testModel,
      meta: { ...testModel.meta, id: 'generation-handler-controlled-model' },
    }
    registry.registerHidden(controlled)
    const handler = registeredHandlers().get('create_visible_generation_task')
    if (!handler) throw new Error('HANDLER_NOT_FOUND')

    await expect(handler({
      modelId: controlled.meta.id,
      prompt: '绕过能力入口',
      mediaType: 'image',
    }, context)).rejects.toThrow(/apply_canvas_image_capability/)
    expect(mocks.submit).not.toHaveBeenCalled()
  })

  it('草稿没有选中模型且未显式传 modelId 时拒绝', async () => {
    // createEmptyGenerationDraft() 会自动选中注册表里第一个可用模型（见 5.1 执行记录），
    // 这里显式清空才是真正的"未选中"状态。
    useGenerationDraftStore.getState().patchField('selectedModel', '')
    useGenerationDraftStore.getState().patchField('selectedProvider', '')

    const handler = registeredHandlers().get('create_visible_generation_task')
    if (!handler) throw new Error('HANDLER_NOT_FOUND')
    await expect(handler({}, context)).rejects.toThrow(/INVALID_INPUT/)
  })

  it('prepare_generation_task 同样按草稿补全省略字段', () => {
    useGenerationDraftStore.getState().patchField('selectedModel', testModel.meta.id)
    useGenerationDraftStore.getState().patchField('selectedProvider', testModel.meta.provider)
    useGenerationDraftStore.getState().setLegacyInput('准备阶段的草稿提示词')

    const handler = registeredHandlers().get('prepare_generation_task')
    if (!handler) throw new Error('HANDLER_NOT_FOUND')
    handler({}, context)

    const prepared = mocks.prepare.mock.calls[0][0]
    expect(prepared.modelId).toBe(testModel.meta.id)
    expect(prepared.prompt).toBe('准备阶段的草稿提示词')
  })

  it('resolve_generation_model 把当前草稿仅作为宿主候选，不直接沿用未配置模型', async () => {
    useGenerationDraftStore.getState().patchField('selectedModel', testModel.meta.id)
    const handler = registeredHandlers().get('resolve_generation_model')
    if (!handler) throw new Error('HANDLER_NOT_FOUND')

    const resolved = await handler({
      preferredProviderIds: ['kie'], prompt: '生成图片', mediaType: 'image', params: {},
    }, context)

    expect(mocks.resolveModel).toHaveBeenCalledWith(expect.objectContaining({
      currentModelId: testModel.meta.id,
      preferredProviderIds: ['kie'],
      prompt: '生成图片',
      mediaType: 'image',
    }))
    expect(resolved).toEqual({
      modelId: testModel.meta.id,
      providerId: testModel.meta.provider,
      selection: 'configured_fallback',
    })
  })
})
