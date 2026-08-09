// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { ApplicationExecutionContext } from '@/core/application-control'
import { registry } from '@/core/ModelRegistry'
import type { ModelDefinition } from '@/core/types'
import { getHiddenModels, saveHiddenModels } from '@/config/providers'

import { getGenerationModelsRevision } from './generationModelFields'

import {
  getApplicationControlExecutionEngine,
  getApplicationReflectionRegistry,
} from '../../assistant/applicationCapabilities/applicationControlRegistry'

const testModel: ModelDefinition = {
  meta: {
    id: 'generation-model-mutation-test',
    canonicalModelId: 'nano-banana',
    provider: 'test-provider',
    type: 'image',
    name: { zh: '模型可见性测试模型', en: 'Model visibility test model' },
    tags: ['text-to-image'],
  },
  inputLimits: { images: { max: 1 }, videos: { max: 0 }, audios: { max: 0 } },
  params: [],
  linkages: [],
  endpoints: '/test',
  request: { builder: (params) => params },
  pricing: { currency: '$', fixed: 0.5, description: '测试模型基础价格' },
}

const modelKey = 'test-provider-generation-model-mutation-test'

const context: ApplicationExecutionContext = {
  requestId: 'generation-model-mutation-test',
  exposure: 'assistant',
  permissions: new Set(['model_catalog:read', 'model_catalog:write']),
  acceptedDataClasses: new Set(['C0', 'C1']),
}

describe('4.4：generation.model.hidden 属性写入执行器', () => {
  beforeEach(() => {
    registry.clear()
    registry.register(testModel)
    saveHiddenModels(new Set())
  })

  afterEach(() => {
    registry.clear()
    saveHiddenModels(new Set())
  })

  it('通用反射读取能看到 hidden 属性且默认可见', async () => {
    const registryHandle = getApplicationReflectionRegistry()
    const snapshot = await registryHandle.readEntity(
      { kind: 'generation.model', id: testModel.meta.id },
      ['generation.model.hidden', 'generation.model.provider_id'],
      context
    )
    expect(snapshot.properties['generation.model.hidden']).toBe(false)
    expect(snapshot.properties['generation.model.provider_id']).toBe('test-provider')
  })

  it('通过统一计划提交把模型隐藏，值真的落到 hidden_models，且可撤销', async () => {
    const engine = getApplicationControlExecutionEngine()
    const revision = getGenerationModelsRevision()
    const plan = await engine.plan({
      summary: '隐藏测试模型',
      transactionMode: 'atomic',
      steps: [{
        kind: 'mutation',
        target: { kind: 'generation.model', id: testModel.meta.id },
        entityType: 'generation.model',
        expectedRevisions: { models: revision },
        mutations: [{ propertyId: 'generation.model.hidden', operation: 'set', value: true }],
      }],
    }, context)
    const committed = await engine.commit({
      planRef: plan.planRef,
      expectedRevisions: { models: revision },
      idempotencyKey: 'generation-model-hide-commit',
    }, context)
    expect(committed.status, JSON.stringify(committed)).toBe('completed')
    expect(getHiddenModels().has(modelKey)).toBe(true)
    if (committed.status !== 'completed' || !committed.undoRef) throw new Error('UNDO_REF_MISSING')

    const undone = await engine.undo({
      undoRef: committed.undoRef,
      expectedRevisions: committed.resultingRevisions,
      idempotencyKey: 'generation-model-hide-undo',
    }, context)
    expect(undone.status).toBe('completed')
    expect(getHiddenModels().has(modelKey)).toBe(false)
  })

  it('其余四条属性仍然只读，写入被拒绝', async () => {
    const engine = getApplicationControlExecutionEngine()
    const revision = getGenerationModelsRevision()
    await expect(engine.plan({
      summary: '尝试改模型名称',
      transactionMode: 'atomic',
      steps: [{
        kind: 'mutation',
        target: { kind: 'generation.model', id: testModel.meta.id },
        entityType: 'generation.model',
        expectedRevisions: { models: revision },
        mutations: [{ propertyId: 'generation.model.name', operation: 'set', value: '改不了' }],
      }],
    }, context)).rejects.toThrow(/PROPERTY_NOT_WRITABLE|READ_ONLY|not writable/i)
  })
})
