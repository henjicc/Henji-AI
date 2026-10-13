import { afterEach, expect, it, vi } from 'vitest'
import { ApplicationOperationStore, type OperationRecord } from './operationStore'
import { ApplicationOperationCoordinator } from './operationCoordinator'
import { applicationUserConfirmation } from '../../../../src/core/application-control/userConfirmation'

afterEach(() => { vi.restoreAllMocks() })

function fixture() {
  let record: OperationRecord = { operationId: 'operation-secret', callerId: 'caller-secret', inputDigest: 'digest',
    state: 'partial', verificationState: 'unresolved', capabilityId: 'change_application_entities', rendererEpoch: 'same-epoch', requestId: 'request',
    input: { changes: [{ kind: 'mutate_properties', entityType: 'asset', target: { kind: 'asset', id: 'target-secret' }, mutations: [{ propertyId: 'asset.library_refs', operation: 'append', value: [{ kind: 'asset.library', id: 'library' }] }] }] },
    targetRefs: [{ kind: 'asset', id: 'target-secret' }],
    result: { ok: false, error: { details: { transaction: { code: 'VERIFICATION_FAILED', effects: [{ kind: 'updated' }] } } } } }
  const store = Object.create(ApplicationOperationStore.prototype) as ApplicationOperationStore
  vi.spyOn(store, 'recoverInterrupted').mockImplementation(() => undefined)
  vi.spyOn(store, 'unresolved').mockImplementation(() => record.verificationState === 'unresolved' ? [record] : [])
  vi.spyOn(store, 'get').mockImplementation(() => record)
  vi.spyOn(store, 'save').mockImplementation(value => { record = value })
  const show = vi.fn()
  const coordinator = new ApplicationOperationCoordinator(store, undefined, undefined, show)
  return { coordinator, show, get: () => record, set: (value: OperationRecord) => { record = value } }
}

it('非 set 的已执行验证失败可在当前宿主核对，稍后保留保护，确认只解除保护并保留原回执', async () => {
  const f = fixture(), original = structuredClone(f.get().result)
  expect(f.coordinator.pendingReviews()).toHaveLength(1)
  const read = vi.fn().mockResolvedValue({ ok: true, data: { name: '海报素材', revisions: { asset: 123 } } })
  await f.coordinator.review(f.get(), 'same-epoch', read, () => {})
  expect(read).toHaveBeenCalledWith({ kind: 'asset', id: 'target-secret' })
  expect(f.show).toHaveBeenCalledWith(expect.objectContaining({ executed: true, message: expect.stringContaining('已执行') }))
  expect(f.show.mock.calls[0][0].message).not.toMatch(/secret|revision|重新加载|执行到一半/)
  expect(f.coordinator.pendingReviews()[0]).toMatchObject({ executed: true })
  f.coordinator.resolveReview('operation-secret', 'caller-secret', 'later')
  expect(f.get()).toMatchObject({ state: 'awaiting_user_confirmation', verificationState: 'unresolved', result: original })
  f.coordinator.resolveReview('operation-secret', 'caller-secret', 'completed')
  expect(f.get()).toMatchObject({ state: 'completed', verificationState: 'verified', result: original,
    recoveryResult: { verification: { source: 'application_user_review', decision: 'completed' } } })
  expect(f.coordinator.pendingReviews()).toEqual([])
})

it('主进程拒绝把已经执行的核对记录改成未执行', () => {
  const f = fixture()
  f.set({ ...f.get(), state: 'awaiting_user_confirmation', confirmation: applicationUserConfirmation({ title: '核对', message: '已执行', confirmLabel: '已核对' }, 'review') })
  expect(() => f.coordinator.resolveReview('operation-secret', 'caller-secret', 'not_executed')).toThrow('RECOVERY_ALREADY_EXECUTED')
  expect(f.get().state).toBe('awaiting_user_confirmation')
})

it.each(['transaction', 'details'])('保存失败（%s）不能通过人工核对解除', async location => {
  const f = fixture()
  const details = { transaction: { code: 'VERIFICATION_FAILED', ...(location === 'transaction' ? { persistence: { status: 'failed' } } : {}) }, ...(location === 'details' ? { persistence: { status: 'failed' } } : {}) }
  f.set({ ...f.get(), result: { ok: false, error: { details } } })
  expect(f.coordinator.pendingReviews()).toEqual([])
  await f.coordinator.review(f.get(), 'new-epoch', vi.fn(), () => {})
  expect(f.show).not.toHaveBeenCalled()
  expect(f.get().state).toBe('partial')
})

it('读回过程中完成的操作不重新进入人工核对', async () => {
  const f = fixture()
  await f.coordinator.review(f.get(), 'same-epoch', async () => {
    f.set({ ...f.get(), state: 'completed', verificationState: 'verified' })
    return { ok: true }
  }, () => {})
  expect(f.show).not.toHaveBeenCalled()
  expect(f.get().state).toBe('completed')
})
