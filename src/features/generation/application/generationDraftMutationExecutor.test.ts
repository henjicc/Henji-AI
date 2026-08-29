// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { ApplicationExecutionContext } from '@/core/application-control'
import { registry } from '@/core/ModelRegistry'
import type { ModelDefinition } from '@/core/types'

import { createEmptyGenerationDraft } from '../domain/generationDraft'
import { useGenerationDraftStore } from '../store/generationDraftStore'
import {
  getApplicationControlExecutionEngine,
  getApplicationReflectionRegistry,
} from '../../assistant/applicationCapabilities/applicationControlRegistry'

const testModel: ModelDefinition = {
  meta: {
    id: 'generation-draft-mutation-test-model',
    canonicalModelId: 'nano-banana',
    provider: 'draft-mutation-test-provider',
    type: 'video',
    name: { zh: '草稿写入测试模型', en: 'Draft mutation test model' },
    tags: [],
  },
  inputLimits: { images: { max: 1 }, videos: { max: 1 }, audios: { max: 0 } },
  params: [],
  linkages: [],
  endpoints: '/test',
  request: { builder: (params) => params },
  pricing: { currency: '$', fixed: 0.5, description: '测试模型基础价格' },
}

const context: ApplicationExecutionContext = {
  requestId: 'generation-draft-mutation-test',
  exposure: 'assistant',
  permissions: new Set(['generation_draft:read', 'generation_draft:write']),
  acceptedDataClasses: new Set(['C0', 'C1']),
}

function resetStore(): void {
  useGenerationDraftStore.setState({ draft: createEmptyGenerationDraft(), revision: 0 })
}

describe('generation.draft 属性写入执行器（5.4）', () => {
  beforeEach(() => {
    registry.clear()
    registry.register(testModel)
    resetStore()
  })

  afterEach(() => {
    registry.clear()
    resetStore()
  })

  it('通用反射读取能看到草稿的默认状态', async () => {
    const registryHandle = getApplicationReflectionRegistry()
    const snapshot = await registryHandle.readEntity(
      { kind: 'generation.draft', id: 'singleton' },
      undefined,
      context
    )
    expect(snapshot.properties['generation.draft.prompt_text']).toBe('')
    expect(snapshot.properties['generation.draft.uploaded_images']).toEqual([])
  })

  it('助手写提示词、换模型，草稿真的变了，且可撤销', async () => {
    // createEmptyGenerationDraft() 会自动选中注册表里第一个可用模型（见 5.1 执行记录），
    // 这里显式清空才能验证"换模型"这个动作本身，而不是巧合地写回同一个值。
    useGenerationDraftStore.getState().patchField('selectedModel', '')
    useGenerationDraftStore.getState().patchField('selectedProvider', '')

    const engine = getApplicationControlExecutionEngine()
    const revision = useGenerationDraftStore.getState().revision
    const plan = await engine.plan({
      summary: '搭建生成输入',
      transactionMode: 'atomic',
      steps: [{
        kind: 'mutation',
        target: { kind: 'generation.draft', id: 'singleton' },
        entityType: 'generation.draft',
        expectedRevisions: { generation_draft: revision },
        mutations: [
          { propertyId: 'generation.draft.prompt_text', operation: 'set', value: '一段测试提示词' },
          { propertyId: 'generation.draft.selected_model', operation: 'set', value: { kind: 'generation.model', id: testModel.meta.id } },
        ],
      }],
    }, context)
    const committed = await engine.commit({
      planRef: plan.planRef,
      expectedRevisions: { generation_draft: revision },
      idempotencyKey: 'generation-draft-build-commit',
    }, context)
    expect(committed.status, JSON.stringify(committed)).toBe('completed')

    const draft = useGenerationDraftStore.getState().draft
    expect(draft.selectedModel).toBe(testModel.meta.id)
    expect(draft.selectedProvider).toBe(testModel.meta.provider)
    expect(JSON.stringify(draft.promptDocument)).toContain('一段测试提示词')

    if (committed.status !== 'completed' || !committed.undoRef) throw new Error('UNDO_REF_MISSING')
    const undone = await engine.undo({
      undoRef: committed.undoRef,
      expectedRevisions: committed.resultingRevisions,
      idempotencyKey: 'generation-draft-build-undo',
    }, context)
    expect(undone.status).toBe('completed')
    expect(useGenerationDraftStore.getState().draft.selectedModel).toBe('')
  })

  it('上传的图片写入后能正确同步进提示词的媒体引用', async () => {
    const engine = getApplicationControlExecutionEngine()
    const revision = useGenerationDraftStore.getState().revision
    const plan = await engine.plan({
      summary: '上传图片',
      transactionMode: 'atomic',
      steps: [{
        kind: 'mutation',
        target: { kind: 'generation.draft', id: 'singleton' },
        entityType: 'generation.draft',
        expectedRevisions: { generation_draft: revision },
        mutations: [
          { propertyId: 'generation.draft.uploaded_images', operation: 'set', value: ['a.png', 'b.png'] },
        ],
      }],
    }, context)
    await engine.commit({
      planRef: plan.planRef,
      expectedRevisions: { generation_draft: revision },
      idempotencyKey: 'generation-draft-upload-commit',
    }, context)

    const draft = useGenerationDraftStore.getState().draft
    expect(draft.uploadedPromptImages.map((image) => image.url)).toEqual(['a.png', 'b.png'])
    expect(draft.uploadedFilePaths).toEqual(['a.png', 'b.png'])
  })

  it('视频裁剪起止点可写', async () => {
    const engine = getApplicationControlExecutionEngine()
    const revision = useGenerationDraftStore.getState().revision
    const plan = await engine.plan({
      summary: '设置视频裁剪',
      transactionMode: 'atomic',
      steps: [{
        kind: 'mutation',
        target: { kind: 'generation.draft', id: 'singleton' },
        entityType: 'generation.draft',
        expectedRevisions: { generation_draft: revision },
        mutations: [
          { propertyId: 'generation.draft.uploaded_video_trim_start', operation: 'set', value: 1.5 },
          { propertyId: 'generation.draft.uploaded_video_trim_end', operation: 'set', value: 8 },
        ],
      }],
    }, context)
    await engine.commit({
      planRef: plan.planRef,
      expectedRevisions: { generation_draft: revision },
      idempotencyKey: 'generation-draft-trim-commit',
    }, context)

    const draft = useGenerationDraftStore.getState().draft
    expect(draft.uploadedVideoTrimStart).toBe(1.5)
    expect(draft.uploadedVideoTrimEnd).toBe(8)
  })

  it('草稿模型属性拒绝受控执行模型引用', async () => {
    const controlled = {
      ...testModel,
      meta: { ...testModel.meta, id: 'generation-draft-controlled-model' },
    }
    registry.registerHidden(controlled)
    const engine = getApplicationControlExecutionEngine()
    const revision = useGenerationDraftStore.getState().revision
    const plan = await engine.plan({
      summary: '尝试选择受控模型',
      transactionMode: 'atomic',
      steps: [{
        kind: 'mutation',
        target: { kind: 'generation.draft', id: 'singleton' },
        entityType: 'generation.draft',
        expectedRevisions: { generation_draft: revision },
        mutations: [{
          propertyId: 'generation.draft.selected_model',
          operation: 'set',
          value: { kind: 'generation.model', id: controlled.meta.id },
        }],
      }],
    }, context)

    const result = await engine.commit({
      planRef: plan.planRef,
      expectedRevisions: { generation_draft: revision },
      idempotencyKey: 'generation-draft-controlled-commit',
    }, context)
    expect(result).toMatchObject({ status: 'failed', code: 'EXECUTION_FAILED' })
    if (result.status !== 'failed') throw new Error('受控模型写入必须失败')
    expect(result.message).toMatch(/画布图片能力/)
  })

  it('时长与模型筛选等排除字段仍然只读', async () => {
    const engine = getApplicationControlExecutionEngine()
    const revision = useGenerationDraftStore.getState().revision
    await expect(engine.plan({
      summary: '尝试改视频时长',
      transactionMode: 'atomic',
      steps: [{
        kind: 'mutation',
        target: { kind: 'generation.draft', id: 'singleton' },
        entityType: 'generation.draft',
        expectedRevisions: { generation_draft: revision },
        mutations: [{ propertyId: 'generation.draft.uploaded_video_duration', operation: 'set', value: 99 }],
      }],
    }, context)).rejects.toThrow()
  })
})
