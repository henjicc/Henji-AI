// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest'
import { getApplicationControlExecutionEngine, getApplicationReflectionRegistry } from '@/features/assistant/applicationCapabilities/applicationControlRegistry'
import { createAttachedImageEditPersistenceFixture } from '@/tests/imageEditAttachedPersistenceFixture'
import { installHarnessNativeStorage, readHarnessImageEditDocument, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { getProjectRecord } from '@/commands/projectState'
import { imageEditV3DocumentRef, imageEditV3LayerRef } from './imageEditLiveSessionRegistry'
import type { ApplicationPlannedStep } from '@/core/application-control/transactions'

const disposals: Array<() => void> = []
beforeEach(() => { installHarnessNativeStorage() })
afterEach(() => { disposals.splice(0).reverse().forEach((dispose) => dispose()); uninstallHarnessNativeStorage() })
const context = { exposure: 'assistant' as const, requestId: 'actual-partial-failure',
  permissions: new Set(['image_edit:read', 'image_edit:write', 'canvas:write']), acceptedDataClasses: new Set(['C0', 'C1'] as const) }

it.each(['compensatable', 'non_reversible'] as const)('%s 部分业务修改在最终保存成功后保留真实两域事实且禁止重放', async (transactionMode) => {
  const f = await createAttachedImageEditPersistenceFixture(); disposals.push(f.dispose)
  const engine = getApplicationControlExecutionEngine(), target = imageEditV3LayerRef(f.document.id, 'effect')
  const expectedRevisions = (await getApplicationReflectionRegistry().readEntity(target, [], context)).revisions
  if (transactionMode === 'compensatable') {
    // 使用正式命令总线的历史操作模拟本地编辑者清空历史，绝不替换执行器/回滚判定。
    let cleared = false
    disposals.push(f.bus.subscribe((snapshot) => { if (!cleared && snapshot.document.revision === 1) { cleared = true; f.bus.clearHistory() } }))
  }
  const plan = await engine.plan({ summary: '部分修改与拒绝', transactionMode, steps: [
    { kind: 'mutation', entityType: target.kind, target, expectedRevisions, mutations: [{ propertyId: 'image_edit.layer.opacity', operation: 'set', value: 0.5 }] },
    { kind: 'mutation', entityType: target.kind, target, expectedRevisions, mutations: [{ propertyId: 'image_edit.layer.name', operation: 'set', value: '  ' }] },
  ] }, context)
  const input = { planRef: plan.planRef, expectedRevisions, idempotencyKey: `actual-partial-${transactionMode}` }
  const result = await engine.commit(input, context)
  expect(result).toMatchObject({ status: 'failed', code: 'EXECUTION_FAILED',
    partial: { completedStepIndexes: [0], compensatedStepIndexes: [], uncompensatedStepIndexes: [0] },
    effects: expect.arrayContaining([expect.objectContaining({ entityType: 'image_edit.layer', propertyIds: ['image_edit.layer.opacity'] }),
      expect.objectContaining({ entityType: 'canvas.node' })]),
    resultRefs: [expect.objectContaining({ kind: target.kind })], currentRevisions: { image_edit: expect.any(Number), canvas: expect.any(Number) } })
  expect(result.status === 'failed' && result.persistence).toBeUndefined()
  const saved = readHarnessImageEditDocument(f.document.id)!
  expect(saved.document.layers[0].opacity).toBe(0.5)
  expect(saved.document.layers[0].name).toBe('模糊')
  expect(saved.document.revision).toBe(1)
  expect(JSON.parse((await getProjectRecord(f.projectId))!.nodesJson)[0].data.imageEditSession.revision).toBe(1)
  expect(await engine.commit(input, context)).toEqual(result)
  expect(await engine.commit({ ...input, idempotencyKey: `again-${input.idempotencyKey}` }, context)).toMatchObject({ status: 'failed', code: 'INVALID_PLAN' })
  expect(f.materialize).toHaveBeenCalledTimes(1)
})

it('部分撤销后历史被本地编辑者清理：保存成功仍返回原步骤索引及未完成事实', async () => {
  const f = await createAttachedImageEditPersistenceFixture(); disposals.push(f.dispose)
  const engine = getApplicationControlExecutionEngine(), target = imageEditV3LayerRef(f.document.id, 'effect')
  const expectedRevisions = (await getApplicationReflectionRegistry().readEntity(target, [], context)).revisions
  const plan = await engine.plan({ summary: '两步修改', transactionMode: 'compensatable', steps: [
    { kind: 'mutation', entityType: target.kind, target, expectedRevisions, mutations: [{ propertyId: 'image_edit.layer.name', operation: 'set', value: '新名称' }] },
    { kind: 'mutation', entityType: target.kind, target, expectedRevisions, mutations: [{ propertyId: 'image_edit.layer.opacity', operation: 'set', value: 0.5 }] },
  ] }, context)
  const applied = await engine.commit({ planRef: plan.planRef, expectedRevisions, idempotencyKey: 'actual-undo-partial-apply' }, context)
  if (applied.status !== 'completed' || !applied.undoRef) throw new Error('missing successful commit')
  let cleared = false
  disposals.push(f.bus.subscribe((snapshot) => { if (!cleared && snapshot.document.revision === 3) { cleared = true; f.bus.clearHistory() } }))
  const request = { undoRef: applied.undoRef, expectedRevisions: applied.resultingRevisions, idempotencyKey: 'actual-undo-partial-execute' }
  const result = await engine.undo(request, context)
  expect(result).toMatchObject({ status: 'failed', partial: { completedStepIndexes: [1], uncompensatedStepIndexes: [1] },
    effects: expect.arrayContaining([expect.objectContaining({ propertyIds: ['image_edit.layer.opacity'] }), expect.objectContaining({ entityType: 'canvas.node' })]) })
  const saved = readHarnessImageEditDocument(f.document.id)!
  expect(saved.document.revision).toBe(3)
  expect(saved.document.layers[0].opacity).toBe(1)
  expect(saved.document.layers[0].name).toBe('新名称')
  expect(await engine.undo(request, context)).toEqual(result)
  expect(await engine.undo({ ...request, idempotencyKey: 'actual-undo-partial-again' }, context)).toMatchObject({ status: 'failed', code: 'NOT_FOUND' })
})

it.each([
  { operation: 'create', partial: false }, { operation: 'remove', partial: false },
  { operation: 'create', partial: true }, { operation: 'remove', partial: true },
] as const)('集合 $operation 撤销 partial=$partial 的事实方向与真实存储一致', async ({ operation, partial }) => {
  const f = await createAttachedImageEditPersistenceFixture(); disposals.push(f.dispose)
  const engine = getApplicationControlExecutionEngine(), target = imageEditV3LayerRef(f.document.id, 'effect')
  const parent = imageEditV3DocumentRef(f.document.id)
  const expectedRevisions = (await getApplicationReflectionRegistry().readEntity(parent, [], context)).revisions
  const collection: ApplicationPlannedStep = { kind: 'collection', parent, expectedRevisions,
    entityType: operation === 'create' ? 'image_edit.group' : 'image_edit.layer',
    operation: operation === 'create'
      ? { kind: 'create', items: [{ properties: { 'image_edit.group.name': '临时组' } }] }
      : { kind: 'remove', targets: [target] } }
  const first: ApplicationPlannedStep = operation === 'remove'
    ? { kind: 'collection', entityType: 'image_edit.group', parent, expectedRevisions,
        operation: { kind: 'create', items: [{ properties: { 'image_edit.group.name': '保留的组' } }] } }
    : { kind: 'mutation', entityType: target.kind, target, expectedRevisions,
        mutations: [{ propertyId: 'image_edit.layer.name', operation: 'set', value: '保留的修改' }] }
  const steps: ApplicationPlannedStep[] = partial ? [first, collection] : [collection]
  const plan = await engine.plan({ summary: '集合撤销事实', transactionMode: 'compensatable', steps }, context)
  const applied = await engine.commit({ planRef: plan.planRef, expectedRevisions, idempotencyKey: `collection-${operation}-${partial}` }, context)
  if (applied.status !== 'completed' || !applied.undoRef) throw new Error(JSON.stringify(applied))
  const originalEffect = applied.effects.find((effect) => effect.effect === (operation === 'create' ? 'create' : 'delete'))!
  if (partial) {
    let cleared = false
    disposals.push(f.bus.subscribe((snapshot) => { if (!cleared && snapshot.document.revision === 3) { cleared = true; f.bus.clearHistory() } }))
  }
  const result = await engine.undo({ undoRef: applied.undoRef, expectedRevisions: applied.resultingRevisions,
    idempotencyKey: `collection-undo-${operation}-${partial}` }, context)
  expect(result.status).toBe(partial ? 'failed' : 'completed')
  if (result.status !== 'failed' && result.status !== 'completed') throw new Error('unexpected deferred undo')
  expect(result.effects).toEqual(expect.arrayContaining([expect.objectContaining({
    effect: operation === 'create' ? 'delete' : 'create', entityType: collection.entityType,
    refs: originalEffect.refs.map(({ kind, id }) => expect.objectContaining({ kind, id })),
  })]))
  if (partial) expect(result).toMatchObject({ partial: { completedStepIndexes: [1], uncompensatedStepIndexes: [1] } })
  const saved = readHarnessImageEditDocument(f.document.id)!
  expect(saved.document.layers).toHaveLength(partial && operation === 'remove' ? 2 : 1)
  expect(saved.document.layers.find((layer) => layer.id === 'effect')).toMatchObject({ name: partial && operation === 'create' ? '保留的修改' : '模糊' })
  expect(saved.document.revision).toBe(partial ? 3 : 2)
})
