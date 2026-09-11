// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { createImageEditDocumentV3, createImageEditEffectLayerV3, createImageEditGroupLayerV3 } from '@/core/imageEdit/v3/documentFactory'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import { getApplicationControlExecutionEngine, getApplicationReflectionRegistry } from '@/features/assistant/applicationCapabilities/applicationControlRegistry'
import { registerPersistedImageEditTestSession } from '@/tests/imageEditPersistenceTestSession'
import { ImageEditCommandBusV3 } from './imageEditCommandBus'
import { imageEditV3GroupRef, imageEditV3LayerRef } from './imageEditLiveSessionRegistry'
import { retryImageEditDocumentSaveV3 } from './imageEditPersistenceOperations'

let dispose: (() => void) | undefined
afterEach(() => { dispose?.() })
const context = { exposure: 'assistant' as const, requestId: 'image-batch', operationId: 'image-operation',
  permissions: new Set(['image_edit:read', 'image_edit:write']), acceptedDataClasses: new Set(['C0', 'C1'] as const) }

it.each(['atomic', 'compensatable'] as const)('%s 整批仅保存一次；撤销保存失败不会重复撤销', async (transactionMode) => {
  const document = createImageEditDocumentV3({ width: 8, height: 8, documentId: `batch-${transactionMode}` })
  document.layers = [createImageEditEffectLayerV3('effect', '模糊', 'image.gaussian-blur-v2', { radius: 8 }), createImageEditGroupLayerV3('group', '组')]
  const bus = new ImageEditCommandBusV3(document)
  const save = vi.fn(async (value: ImageEditDocumentV3, _options: import('@/core/imageEdit/v3/serviceContracts').ImageEditSaveDocumentOptionsV3) => ({ documentId: value.id, revision: value.revision, previewRef: null }))
  dispose = registerPersistedImageEditTestSession(`session-${transactionMode}`, bus, { save })
  const layer = imageEditV3LayerRef(document.id, 'effect')
  const other = transactionMode === 'atomic' ? layer : imageEditV3GroupRef(document.id, 'group')
  const snapshot = await getApplicationReflectionRegistry().readEntity(layer, [], context)
  const engine = getApplicationControlExecutionEngine()
  const plan = await engine.plan({ summary: '一次图片编辑批次', transactionMode, steps: [
    { kind: 'mutation', entityType: other.kind, target: other, expectedRevisions: snapshot.revisions,
      mutations: [{ propertyId: transactionMode === 'atomic' ? 'image_edit.layer.name' : 'image_edit.group.name', operation: 'set', value: '新名称' }] },
    { kind: 'mutation', entityType: layer.kind, target: layer, expectedRevisions: snapshot.revisions,
      mutations: [{ propertyId: 'image_edit.layer.opacity', operation: 'set', value: 0.5 }] },
  ] }, context)
  const result = await engine.commit({ planRef: plan.planRef, expectedRevisions: snapshot.revisions,
    idempotencyKey: `image-edit-batch-${transactionMode}` }, context)
  expect(result.status).toBe('completed')
  expect(save).toHaveBeenCalledTimes(1)
  expect(save.mock.calls[0][1].operationCorrelation).toMatchObject({ operationId: 'image-operation',
    targets: expect.arrayContaining([expect.objectContaining({ kind: layer.kind, id: layer.id })]) })
  expect(bus.getSnapshot().document.revision).toBe(2)
  if (result.status !== 'completed' || !result.undoRef) throw new Error('missing successful undo')
  save.mockRejectedValueOnce(new Error('undo storage refused'))
  const undo = await engine.undo({ undoRef: result.undoRef, expectedRevisions: result.resultingRevisions,
    idempotencyKey: `image-edit-undo-${transactionMode}` }, context)
  expect(undo).toMatchObject({ status: 'failed', persistence: { recovery: { replayMutation: false } } })
  const afterUndo = bus.getPersistenceSnapshot()
  expect(afterUndo.document.layers[0].opacity).toBe(1)
  expect(afterUndo.history.undo).toHaveLength(0)
  expect(afterUndo.history.redo).toHaveLength(2)
  await retryImageEditDocumentSaveV3(document.id)
  expect(bus.getPersistenceSnapshot()).toEqual(afterUndo)
  expect(save).toHaveBeenCalledTimes(3)
  expect(await engine.undo({ undoRef: result.undoRef, expectedRevisions: result.resultingRevisions,
    idempotencyKey: `image-edit-undo-again-${transactionMode}` }, context)).toMatchObject({ status: 'failed', code: 'NOT_FOUND' })
})
