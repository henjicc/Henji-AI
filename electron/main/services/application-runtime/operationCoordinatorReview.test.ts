import { afterEach, expect, it, vi } from 'vitest'
import { ApplicationOperationStore, type OperationRecord } from './operationStore'
import { ApplicationOperationCoordinator } from './operationCoordinator'
import { applicationUserConfirmation } from '../../../../src/core/application-control/userConfirmation'

afterEach(() => { vi.restoreAllMocks() })

function fixture() {
  let record: OperationRecord = { operationId: 'operation-secret', callerId: 'caller-secret', inputDigest: 'digest',
    state: 'partial', verificationState: 'unresolved', capabilityId: 'change_application_entities', rendererEpoch: 'same-epoch', requestId: 'request',
    // 人工核对只保留给涉及付费的操作（本地修改结果未知时不挡、不弹窗）：夹具带一笔付费预估
    paidGenerationEstimate: 0.5,
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

it('已执行但返回结果不符合声明的写操作可以核对解除，不能记成未执行', async () => {
  const f = fixture()
  f.set({ ...f.get(), capabilityId: 'process_audio_edit_breaths', input: { documentRef: { kind: 'audio_edit.document', id: 'target-secret' } }, targetRefs: [{ kind: 'audio_edit.document', id: 'target-secret' }],
    result: { ok: false, error: { code: 'CAPABILITY_REJECTED', message: 'APPLICATION_OUTPUT_CONTRACT:操作已执行，但返回结果不符合声明。', details: { outputContract: true, execution: { billing: 'not_charged', targetMutation: 'applied', notExecuted: false }, replayMutation: false } } } })
  expect(f.coordinator.pendingReviews()).toHaveLength(1)
  await f.coordinator.review(f.get(), 'same-epoch', vi.fn().mockResolvedValue({ ok: true, data: { name: '口播' } }), () => {})
  expect(f.show).toHaveBeenCalledWith(expect.objectContaining({ executed: true }))
  expect(() => f.coordinator.resolveReview('operation-secret', 'caller-secret', 'not_executed')).toThrow('RECOVERY_ALREADY_EXECUTED')
  f.coordinator.resolveReview('operation-secret', 'caller-secret', 'completed')
  expect(f.get()).toMatchObject({ state: 'completed', verificationState: 'verified' })
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

it('写入前就被拒绝却被旧版记成未知的记录自动收回，不再请用户核对（含已经弹出的）', () => {
  const f = fixture()
  const rejected = (capabilityId: string, message: string, extra: Partial<OperationRecord> = {}): OperationRecord => ({ ...f.get(), capabilityId: capabilityId as OperationRecord['capabilityId'], state: 'unknown', verificationState: 'unresolved', confirmation: undefined,
    result: { ok: false, error: { code: 'CAPABILITY_REJECTED', message, recoverable: false, details: { execution: { billing: 'not_charged', targetMutation: 'unknown', notExecuted: false } } } }, ...extra })
  for (const record of [
    rejected('register_external_project', '位置无效，请选择一个文件夹。'),
    rejected('create_document', '这种文档只能放在项目里。'),
    rejected('render_video_edit_style', 'Parse error @:169:3'),
    rejected('import_web_recording_to_project', 'Target already exists: cp returned EEXIST (D:/素材/录屏/a.hjweb already exists) D:/素材/录屏/a.hjweb', {
      state: 'awaiting_user_confirmation', confirmation: applicationUserConfirmation({ title: '核对', message: '?', confirmLabel: '已经生效' }, 'review') }),
    rejected('render_web_app_replay', '网页应用录制是实验性功能，尚未开启；请先在 设置 → 通用 → 实验性功能 中打开（设置属性 experimental.web_app_recording）。', {
      state: 'awaiting_user_confirmation', confirmation: applicationUserConfirmation({ title: '核对', message: '?', confirmLabel: '已经生效' }, 'review') }),
  ]) {
    f.set(record)
    expect(f.coordinator.pendingReviews()).toEqual([])
    expect(f.get()).toMatchObject({ state: 'not_executed', verificationState: 'verified', confirmation: undefined })
  }
  // 同样的原文出现在别的能力上不能借用：只认可证明零写入的那几条路
  f.set(rejected('export_video_edit', 'Parse error @:1:1'))
  expect(f.coordinator.pendingReviews()).toHaveLength(1)
})

it('已经结束但不确定改了多少的失败，面板说明出错原因与怎么选，不说成“应用重新加载”', async () => {
  const f = fixture()
  f.set({ ...f.get(), capabilityId: 'export_video_edit', state: 'unknown', rendererEpoch: 'old-epoch', origin: { at: Date.now(), actor: 'external' },
    result: { ok: false, error: { code: 'CAPABILITY_REJECTED', message: '导出目录写不进去', details: { execution: { billing: 'not_charged', targetMutation: 'unknown', notExecuted: false } } } } })
  await f.coordinator.review(f.get(), 'new-epoch', vi.fn().mockRejectedValue(new Error('gone')), () => {})
  const message = f.show.mock.calls[0][0].message as string
  expect(message).toContain('执行时出错：导出目录写不进去')
  expect(message).toContain('没有改动就选“没有生效”')
  expect(message).not.toMatch(/重新加载|执行到一半/)
  // 英文底层报错不展示给用户
  f.show.mockClear()
  f.set({ ...f.get(), state: 'unknown', confirmation: undefined, result: { ok: false, error: { code: 'CAPABILITY_REJECTED', message: 'EPERM: operation not permitted', details: {} } } })
  await f.coordinator.review(f.get(), 'new-epoch', vi.fn().mockRejectedValue(new Error('gone')), () => {})
  expect(f.show.mock.calls[0][0].message).not.toContain('EPERM')
})

it('结果未知的本地修改不挡后续修改，也不弹窗请用户核对；付费的仍然挡', async () => {
  const f = fixture()
  const local: OperationRecord = { ...f.get(), state: 'unknown', paidGenerationEstimate: undefined, rendererEpoch: 'old-epoch',
    result: { ok: false, error: { code: 'HOST_RELOADED', message: '应用重新加载', details: {} } } }
  f.set(local)
  await f.coordinator.review(local, 'new-epoch', async () => ({ ok: true, data: {} }), () => undefined)
  expect(f.show).not.toHaveBeenCalled()
  expect(f.get().state).toBe('unknown')
  expect(f.coordinator.pendingReviews()).toEqual([])
  expect(f.coordinator.result(f.get()).recovery).toContain('不挡后续修改')
  f.set({ ...local, paidGenerationEstimate: 0.5 })
  await f.coordinator.review(f.get(), 'new-epoch', async () => ({ ok: true, data: {} }), () => undefined)
  expect(f.show).toHaveBeenCalledOnce()
})
