import { expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { ApplicationOperationStore, type OperationRecord, type ReadBaseline } from './operationStore'
import { ApplicationOperationCoordinator } from './operationCoordinator'

it('同事务删除字幕与修改另一字幕，只要求删除目标被基线覆盖', () => {
  const caller = randomUUID(); const epoch = randomUUID()
  const removed = { kind: 'video_edit.caption', id: 'document:removed' }
  const updated = { kind: 'video_edit.caption', id: 'document:updated' }
  const baseline: ReadBaseline = { id: randomUUID(), callerId: caller, rendererEpoch: epoch, refs: [removed], revisions: { 'video_edit:document': 3 }, capturedAt: Date.now() }
  // Storage is the sole boundary; coordinator target extraction and policy remain real.
  const store = Object.create(ApplicationOperationStore.prototype) as ApplicationOperationStore
  vi.spyOn(store, 'recoverInterrupted').mockImplementation(() => undefined)
  vi.spyOn(store, 'unresolved').mockReturnValue([])
  vi.spyOn(store, 'get').mockReturnValue(undefined)
  vi.spyOn(store, 'readBaseline').mockImplementation(id => { if (id !== baseline.id) throw new Error('未知基线'); return baseline })
  vi.spyOn(store, 'prepare').mockImplementation(record => record as OperationRecord)
  const coordinator = new ApplicationOperationCoordinator(store, undefined, () => new Set(['video_edit.caption']))
  const input = { operationId: randomUUID(), baselineIds: [baseline.id], changes: [
    { kind: 'remove_items', entityType: 'video_edit.caption', parent: { kind: 'video_edit.sequence', id: 'document:sequence' }, targets: [removed] },
    { kind: 'set_properties', entityType: 'video_edit.caption', target: updated, properties: { 'video_edit.caption.text': '修正文字' } },
  ] }
  const access = { allowWrites: true, allowDestructive: true }
  expect(coordinator.prepare(caller, input, epoch, access)).toMatchObject({ state: 'prepared', expectedRevisions: baseline.revisions })
  baseline.refs = [updated]
  expect(() => coordinator.prepare(caller, { ...input, operationId: randomUUID() }, epoch, access)).toThrow('BASELINE_TARGET_MISMATCH')
  vi.restoreAllMocks()
})
