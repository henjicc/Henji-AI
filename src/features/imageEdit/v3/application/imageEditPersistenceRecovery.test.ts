// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getProjectRecord } from '@/commands/projectState'
import { getApplicationControlExecutionEngine, getApplicationReflectionRegistry } from '@/features/assistant/applicationCapabilities/applicationControlRegistry'
import { useCanvasStore } from '@/stores/canvasStore'
import { createAttachedImageEditPersistenceFixture } from '@/tests/imageEditAttachedPersistenceFixture'
import { installHarnessNativeStorage, readHarnessImageEditDocument, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { imageEditV3LayerRef } from './imageEditLiveSessionRegistry'
import { retryImageEditDocumentSaveV3 } from './imageEditPersistenceOperations'

let dispose: (() => void) | undefined
beforeEach(() => { installHarnessNativeStorage() })
afterEach(() => { dispose?.(); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })
const context = { exposure: 'assistant' as const, requestId: 'attached-failure',
  permissions: new Set(['image_edit:read', 'image_edit:write', 'canvas:read', 'canvas:write']),
  acceptedDataClasses: new Set(['C0', 'C1'] as const) }

it('文档已保存但节点存储拒绝，失败回执保留双域事实且恢复不重新物化或编辑', async () => {
  const fixture = await createAttachedImageEditPersistenceFixture()
  dispose = fixture.dispose
  const saves = vi.spyOn(window.henjiNative!.storyboardProjects, 'upsertProjectRecord').mockRejectedValueOnce(new Error('readonly canvas'))
  const target = imageEditV3LayerRef(fixture.document.id, 'effect')
  const snapshot = await getApplicationReflectionRegistry().readEntity(target, [], context)
  const engine = getApplicationControlExecutionEngine()
  const plan = await engine.plan({ summary: '附着图层修改保存', transactionMode: 'atomic', steps: [{ kind: 'mutation',
    entityType: 'image_edit.layer', target, expectedRevisions: snapshot.revisions,
    mutations: [{ propertyId: 'image_edit.layer.opacity', operation: 'set', value: 0.42 }] }] }, context)
  const request = { planRef: plan.planRef, expectedRevisions: snapshot.revisions, idempotencyKey: 'attached-failed-save-operation' }
  const result = await engine.commit(request, context)
  expect(result).toMatchObject({ status: 'failed', persistence: { memoryState: 'modified', stage: 'projection',
    recovery: { replayMutation: false } }, partial: { completedStepIndexes: [0], uncompensatedStepIndexes: [0] } })
  if (result.status === 'failed') expect(result.effects?.map((effect) => effect.entityType)).toEqual(['image_edit.layer', 'canvas.node'])
  const storedDocument = readHarnessImageEditDocument(fixture.document.id)!
  expect(storedDocument.document.revision).toBe(1)
  expect(JSON.parse((await getProjectRecord(fixture.projectId))!.nodesJson)[0].data.imageEditSession.revision).toBe(0)
  expect(useCanvasStore.getState().nodes[0].data.imageEditSession).toMatchObject({ revision: 1 })
  await retryImageEditDocumentSaveV3(fixture.document.id)
  expect(JSON.parse((await getProjectRecord(fixture.projectId))!.nodesJson)[0].data.imageEditSession).toMatchObject({
    revision: 1, previewRef: storedDocument.previewRef,
  })
  expect(fixture.materialize).toHaveBeenCalledTimes(1)
  expect(saves).toHaveBeenCalledTimes(2)
  expect(fixture.bus.getPersistenceSnapshot().history.undo).toHaveLength(1)
  expect(await engine.commit({ ...request, idempotencyKey: 'do-not-replay-failed-save' }, context)).toMatchObject({ status: 'failed', code: 'INVALID_PLAN' })
})

it('附着节点缺少现有 canvas:write 权限时计划阶段拒绝，文档与节点均不修改', async () => {
  const fixture = await createAttachedImageEditPersistenceFixture()
  dispose = fixture.dispose
  const target = imageEditV3LayerRef(fixture.document.id, 'effect')
  const restricted = { ...context, permissions: new Set(['image_edit:read', 'image_edit:write']) }
  const snapshot = await getApplicationReflectionRegistry().readEntity(target, [], restricted)
  await expect(getApplicationControlExecutionEngine().plan({ summary: '缺少节点权限', transactionMode: 'atomic', steps: [{ kind: 'mutation',
    entityType: 'image_edit.layer', target, expectedRevisions: snapshot.revisions,
    mutations: [{ propertyId: 'image_edit.layer.opacity', operation: 'set', value: 0.42 }] }] }, restricted)).rejects.toThrow('PROPERTY_NOT_WRITABLE')
  expect(fixture.bus.getSnapshot().document.revision).toBe(0)
  expect(fixture.materialize).not.toHaveBeenCalled()
})

it('附着双字段撤销遇画布拒写，失败回执记录原步骤逆序和实际撤销双域效果', async () => {
  const fixture = await createAttachedImageEditPersistenceFixture()
  dispose = fixture.dispose
  const target = imageEditV3LayerRef(fixture.document.id, 'effect')
  const snapshot = await getApplicationReflectionRegistry().readEntity(target, [], context)
  const engine = getApplicationControlExecutionEngine()
  const plan = await engine.plan({ summary: '附着双字段修改', transactionMode: 'atomic', steps: [
    { kind: 'mutation', entityType: 'image_edit.layer', target, expectedRevisions: snapshot.revisions,
      mutations: [{ propertyId: 'image_edit.layer.name', operation: 'set', value: '已改名' }] },
    { kind: 'mutation', entityType: 'image_edit.layer', target, expectedRevisions: snapshot.revisions,
      mutations: [{ propertyId: 'image_edit.layer.opacity', operation: 'set', value: 0.42 }] },
  ] }, context)
  const committed = await engine.commit({ planRef: plan.planRef, expectedRevisions: snapshot.revisions,
    idempotencyKey: 'attached-two-fields-for-undo' }, context)
  if (committed.status !== 'completed' || !committed.undoRef) throw new Error(JSON.stringify(committed))
  vi.spyOn(window.henjiNative!.storyboardProjects, 'upsertProjectRecord').mockRejectedValueOnce(new Error('undo canvas readonly'))
  const undone = await engine.undo({ undoRef: committed.undoRef, expectedRevisions: committed.resultingRevisions,
    idempotencyKey: 'attached-two-fields-undo-refused' }, context)
  expect(undone).toMatchObject({ status: 'failed', persistence: { stage: 'projection' },
    partial: { completedStepIndexes: [1, 0], compensatedStepIndexes: [], uncompensatedStepIndexes: [1, 0] } })
  if (undone.status !== 'failed') throw new Error('expected rejected storage')
  expect(undone.effects?.map((effect) => [effect.entityType, effect.propertyIds])).toEqual([
    ['image_edit.layer', ['image_edit.layer.opacity']], ['image_edit.layer', ['image_edit.layer.name']], ['canvas.node', []],
  ])
  expect(undone.currentRevisions).toEqual((await getApplicationReflectionRegistry().readEntity(target, [], context)).revisions)
  expect(readHarnessImageEditDocument(fixture.document.id)?.document.revision).toBe(4)
  const history = fixture.bus.getPersistenceSnapshot().history
  expect(history.undo).toHaveLength(0)
  expect(history.redo).toHaveLength(2)
  const retried = await retryImageEditDocumentSaveV3(fixture.document.id)
  expect(retried.receipt?.effects.map((effect) => effect.effect)).toEqual(['execute'])
  expect(JSON.parse((await getProjectRecord(fixture.projectId))!.nodesJson)[0].data.imageEditSession.revision).toBe(4)
  expect(fixture.materialize).toHaveBeenCalledTimes(2)
  expect(fixture.bus.getPersistenceSnapshot().history).toEqual(history)
  expect(await engine.undo({ undoRef: committed.undoRef, expectedRevisions: undone.currentRevisions ?? {},
    idempotencyKey: 'attached-undo-must-not-replay' }, context)).toMatchObject({ status: 'failed', code: 'NOT_FOUND' })
})
