// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { createImageEditDocumentV3, createImageEditEffectLayerV3 } from '@/core/imageEdit/v3/documentFactory'
import { getApplicationControlExecutionEngine, getApplicationReflectionRegistry } from '@/features/assistant/applicationCapabilities/applicationControlRegistry'
import { registerPersistedImageEditTestSession } from '@/tests/imageEditPersistenceTestSession'
import { ImageEditCommandBusV3 } from './imageEditCommandBus'
import { imageEditV3LayerRef } from './imageEditLiveSessionRegistry'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'

let dispose: (() => void) | undefined
afterEach(() => { dispose?.(); vi.restoreAllMocks() })
const context = { exposure: 'assistant' as const, requestId: 'transaction-scope-test',
  permissions: new Set(['image_edit:read', 'image_edit:write']), acceptedDataClasses: new Set(['C0', 'C1'] as const) }
async function fixture() {
  const document = createImageEditDocumentV3({ width: 8, height: 8, documentId: `concurrency-${crypto.randomUUID()}` })
  document.layers = [createImageEditEffectLayerV3('effect', '原名称', 'image.gaussian-blur-v2', { radius: 8 })]
  const bus = new ImageEditCommandBusV3(document)
  const save = vi.fn(async (doc: ImageEditDocumentV3) => ({ documentId: doc.id, revision: doc.revision, previewRef: null }))
  dispose = registerPersistedImageEditTestSession(`session-${document.id}`, bus, { save })
  const target = imageEditV3LayerRef(document.id, 'effect')
  const engine = getApplicationControlExecutionEngine()
  const revisions = (await getApplicationReflectionRegistry().readEntity(target, [], context)).revisions
  const plan = await engine.plan({ summary: '同一基线事务', transactionMode: 'compensatable', steps: [{ kind: 'mutation',
    entityType: target.kind, target, expectedRevisions: revisions,
    mutations: [{ propertyId: 'image_edit.layer.opacity', operation: 'set', value: 0.5 }] }] }, context)
  const request = { planRef: plan.planRef, expectedRevisions: revisions, idempotencyKey: `commit-${document.id}` }
  return { engine, bus, save, request, target, revisions, plan }
}

it('同 plan 和幂等键并发只写一次，重复 undo 也只撤销一次', async () => {
  const f = await fixture()
  const [a, b] = await Promise.all([f.engine.commit(f.request, context), f.engine.commit(f.request, context)])
  expect(a).toEqual(b)
  expect(a.status).toBe('completed')
  expect(f.bus.getPersistenceSnapshot().document.revision).toBe(1)
  expect(f.save).toHaveBeenCalledTimes(1)
  if (a.status !== 'completed' || !a.undoRef) throw new Error('missing undo')
  const undo = { undoRef: a.undoRef, expectedRevisions: a.resultingRevisions, idempotencyKey: `undo-${f.request.idempotencyKey}` }
  const [u, v] = await Promise.all([f.engine.undo(undo, context), f.engine.undo(undo, context)])
  expect(u).toEqual(v)
  expect(u.status).toBe('completed')
  expect(f.bus.getPersistenceSnapshot().document.revision).toBe(2)
  expect(f.bus.getPersistenceSnapshot().history.redo).toHaveLength(1)
  expect(f.save).toHaveBeenCalledTimes(2)
})

it('不同幂等键提交同 plan 被消费检查拒绝；不同 plan 旧 revision 在锁内拒绝', async () => {
  const f = await fixture()
  const other = await f.engine.plan({ summary: '另一个旧基线计划', transactionMode: 'compensatable', steps: f.plan.steps }, context)
  const results = await Promise.all([
    f.engine.commit(f.request, context),
    f.engine.commit({ ...f.request, idempotencyKey: `duplicate-${f.request.idempotencyKey}` }, context),
    f.engine.commit({ ...f.request, planRef: other.planRef, idempotencyKey: `other-${f.request.idempotencyKey}` }, context),
  ])
  expect(results).toMatchObject([{ status: 'completed' }, { status: 'failed', code: 'INVALID_PLAN' }, { status: 'failed', code: 'CONFLICT' }])
  expect(f.bus.getPersistenceSnapshot().document.revision).toBe(1)
  expect(f.save).toHaveBeenCalledTimes(1)
})

it('验证器 throw 后保留修改、Effects、撤销和幂等失败，不允许重新执行', async () => {
  const f = await fixture()
  const verifierId = `image.audit_${Date.now()}`
  f.engine.registerVerifier({ id: verifierId, verify: async () => { throw new Error('readback unavailable') } })
  const plan = await f.engine.plan({ summary: '验证读取失败', transactionMode: 'compensatable', steps: f.plan.steps,
    verificationConditions: [{ kind: 'custom', verifierId, input: null }] }, context)
  const request = { ...f.request, planRef: plan.planRef }
  const result = await f.engine.commit(request, context)
  expect(result).toMatchObject({ status: 'failed', code: 'VERIFICATION_FAILED', partial: { completedStepIndexes: [0] },
    resultRefs: [expect.objectContaining({ kind: 'image_edit.layer' })], effects: [expect.objectContaining({ effect: 'update' })],
    undoRef: expect.any(String), currentRevisions: expect.objectContaining({ image_edit: expect.any(Number) }) })
  expect(await f.engine.commit(request, context)).toEqual(result)
  expect(await f.engine.commit({ ...request, idempotencyKey: `new-${request.idempotencyKey}` }, context)).toMatchObject({ status: 'failed', code: 'INVALID_PLAN' })
  expect(f.save).toHaveBeenCalledTimes(1)
  expect(f.bus.getPersistenceSnapshot().history.undo).toHaveLength(1)
})
