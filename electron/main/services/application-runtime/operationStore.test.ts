import { applicationInvocationId } from '../../../../src/core/application-control/operationIdentity'
import { applicationWriteChannel, ApplicationWriteFailure } from '../../../../src/core/application-control/execution/writeExecution'
import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApplicationOperationStore, createApplicationOperationTablesV1 } from './operationStore'
import { ApplicationOperationCoordinator } from './operationCoordinator'
import { ApplicationHostBridge } from './applicationHostBridge'
import type { LocalHostRequest } from '../../../../src/core/application-control/localHostContracts'
import { reserveGenerationBudget } from './generationBudget'
import { ApplicationToolDispatcher } from './applicationToolDispatcher'
import { BUILTIN_APPLICATION_CAPABILITY_REGISTRY } from '../../../../src/core/application-control/builtinApplicationCapabilityRegistry'
import { applicationUserConfirmation } from '../../../../src/core/application-control/userConfirmation'

if (!process.versions.electron) throw new Error('本测试必须由正式 Electron SQLite 原生运行器执行，不能跳过原生边界。')

const opened: Database.Database[] = []
afterEach(() => { for (const db of opened.splice(0)) db.close() })
function fixture(): { db: Database.Database; store: ApplicationOperationStore; coordinator: ApplicationOperationCoordinator; callerId: string; rendererEpoch: string; baseline: string } {
  const db = new Database(':memory:'); opened.push(db); createApplicationOperationTablesV1(db)
  db.exec("CREATE TABLE existing_business(id TEXT PRIMARY KEY, value TEXT); INSERT INTO existing_business VALUES('old','keep');")
  const store = new ApplicationOperationStore(db)
  // 公开写入范围由宿主从反射注册表派生后送来；原生用例显式给出本用例涉及的实体。
  const coordinator = new ApplicationOperationCoordinator(store, undefined, () => new Set(['settings.registry', 'canvas.document', 'canvas.node']))
  const callerId = randomUUID(); const rendererEpoch = randomUUID()
  const baseline = store.baseline(callerId, [{ kind: 'settings.registry', id: 'singleton' }], { settings: 1 }, rendererEpoch).id
  return { db, store, coordinator, callerId, rendererEpoch, baseline }
}
const access = { allowWrites: true, allowDestructive: false }
function input(baselineId: string): Record<string, unknown> {
  return { operationId: randomUUID(), baselineIds: [baselineId], summary: '修改主题', changes: [{ kind: 'set_properties', entityType: 'settings.registry', target: { kind: 'settings.registry', id: 'singleton' }, properties: { 'interface.theme_contrast': 'strong' } }] }
}

describe('应用原生操作记录与恢复', () => {
  it('open_document 加载前被拒，统一写回执落原生账本为 not_executed / verified', async () => {
    const f = fixture()
    const record = f.coordinator.prepare(f.callerId, { operationId: randomUUID(), documentId: 'rejected-document' }, f.rendererEpoch, access, 'open_document')
    const requestId = randomUUID()
    f.coordinator.dispatched(record, requestId, f.rendererEpoch)
    const open = applicationWriteChannel(async (_input, context) => context.execution.preflight(() => {
      throw Object.assign(new Error('文档格式不支持，请改用支持的文档。'), { name: 'PersistenceError' })
    }))
    let failure: ApplicationWriteFailure | undefined
    try { await open({}, {}) } catch (error) {
      if (!(error instanceof ApplicationWriteFailure)) throw error
      failure = error
    }
    expect(failure).toBeDefined()
    expect(failure!.execution).toEqual({ billing: 'not_charged', targetMutation: 'none', notExecuted: true })
    f.coordinator.complete({ requestId, rendererEpoch: f.rendererEpoch, result: { ok: false, error: {
      code: 'CAPABILITY_REJECTED', message: failure!.message, recoverable: true, details: { execution: failure!.execution },
    } } })
    const stored = f.store.get(record.operationId, f.callerId)!
    expect(f.coordinator.result(stored)).toMatchObject({ executionState: 'not_executed', verificationState: 'verified' })
    expect(new ApplicationOperationStore(f.db).get(record.operationId, f.callerId)).toMatchObject({ state: 'not_executed', verificationState: 'verified' })
  })
  it('字幕 unknown 只保护原序列及口播，不拦截同文档代码版本/素材独立追加', () => {
    const f = fixture()
    const coordinator = new ApplicationOperationCoordinator(f.store, undefined, () => new Set(['video_edit.document', 'video_edit.code_version', 'video_edit.code_material', 'video_edit.caption']))
    const documentRef = { kind: 'video_edit.document', id: 'video' }
    const sequenceRef = { kind: 'video_edit.sequence', id: 'video:sequence' }
    const args = { operationId: randomUUID(), documentRef, sequenceRef, clipRef: { kind: 'video_edit.clip', id: 'video:voice' } }
    const first = coordinator.prepare(f.callerId, args, f.rendererEpoch, access, 'generate_video_edit_subtitles')
    f.store.save({ ...first, state: 'unknown' })
    for (const entityType of ['video_edit.code_version', 'video_edit.code_material']) {
      expect(coordinator.prepare(f.callerId, { operationId: randomUUID(), changes: [{ kind: 'create_items', entityType, parent: documentRef, items: [{ properties: {} }] }] }, f.rendererEpoch, access).state).toBe('prepared')
    }
    expect(() => coordinator.prepare(f.callerId, { ...args, operationId: randomUUID() }, f.rendererEpoch, access, 'generate_video_edit_subtitles')).toThrow('RECOVERY_REQUIRED')
    expect(() => coordinator.prepare(f.callerId, { operationId: randomUUID(), changes: [{ kind: 'create_items', entityType: 'video_edit.caption', parent: sequenceRef, items: [{ properties: {} }] }] }, f.rendererEpoch, access)).toThrow('RECOVERY_REQUIRED')
    expect(() => coordinator.prepare(f.callerId, { operationId: randomUUID(), changes: [{ kind: 'set_properties', entityType: 'video_edit.caption', target: {kind:'video_edit.caption',id:'video:existing'}, properties: {'video_edit.caption.text':'改写'} }] }, f.rendererEpoch, access)).toThrow('RECOVERY_REQUIRED')
    expect(() => coordinator.prepare(f.callerId, { operationId: randomUUID(), changes: [{ kind: 'set_properties', entityType: 'video_edit.document', target: documentRef, properties: {'video_edit.document.name':'覆盖'} }] }, f.rendererEpoch, access)).toThrow('RECOVERY_REQUIRED')
  })
  it('已记录的 native_upload_unsupported 可准确改判；未知网络失败继续保留保护', () => {
    const f = fixture()
    const first = f.coordinator.prepare(f.callerId, { operationId: '2c6e9a3f-7b4d-4f08-85a2-0e3d7f1b4c69', documentRef: { kind: 'video_edit.document', id: 'video' }, sequenceRef: { kind: 'video_edit.sequence', id: 'video:sequence' }, clipRef: { kind: 'video_edit.clip', id: 'video:voice' } }, f.rendererEpoch, access, 'generate_video_edit_subtitles')
    const unknown = { ...first, state: 'unknown' as const, result: { ok: false, error: { code: 'CAPABILITY_REJECTED', message: '[native_upload_unsupported] 长音频上传需要宿主接入原生文件直传；请升级宿主适配器 恢复时复用 audioDocumentRef。' } } }
    f.store.save(unknown)
    expect(f.coordinator.result(unknown)).toMatchObject({ executionState: 'not_executed', verificationState: 'verified' })
    expect(f.coordinator.result({ ...unknown, result: { ok: false, error: { code: 'CAPABILITY_REJECTED', message: 'network failed' } } })).toMatchObject({ executionState: 'unknown' })
  })
  it('统一写包装已记下“未改动且未计费”的旧 unknown（如打开不支持格式的文档）自动改判；已计费未写入仍保留保护', () => {
    const f = fixture()
    const first = f.coordinator.prepare(f.callerId, { operationId: '4b0d2f6a-9c3e-4f72-b7a1-6a1d9f3b8e20', documentRef: { kind: 'video_edit.document', id: 'video' }, sequenceRef: { kind: 'video_edit.sequence', id: 'video:sequence' }, clipRef: { kind: 'video_edit.clip', id: 'video:voice' } }, f.rendererEpoch, access, 'generate_video_edit_subtitles')
    const facts = (billing: string) => ({ ...first, state: 'unknown' as const, result: { ok: false, error: { code: 'CAPABILITY_REJECTED', message: '这份剪辑是旧版本格式，当前开发版不再支持打开；原文件未被修改。', details: { execution: { billing, targetMutation: 'none', notExecuted: false } } } } })
    f.store.save(facts('not_charged'))
    expect(f.coordinator.result(facts('not_charged'))).toMatchObject({ executionState: 'not_executed', verificationState: 'verified' })
    expect(f.coordinator.result(facts('completed'))).toMatchObject({ executionState: 'unknown' })
  })
  it('识别已完成未写字幕登记 partial，只允许绑定原声音结果的续做', () => {
    const f = fixture()
    const args = { operationId: randomUUID(), documentRef: { kind: 'video_edit.document', id: 'video' }, sequenceRef: { kind: 'video_edit.sequence', id: 'video:sequence' }, clipRef: { kind: 'video_edit.clip', id: 'video:voice' } }
    const first = f.coordinator.prepare(f.callerId, args, f.rendererEpoch, access, 'generate_video_edit_subtitles')
    const requestId = randomUUID(); f.coordinator.dispatched(first, requestId, f.rendererEpoch)
    f.coordinator.complete({ requestId, rendererEpoch: f.rendererEpoch, result: { ok: false, error: { details: { execution: { billing: 'completed', targetMutation: 'none', audioDocumentId: 'audio' } } } } })
    expect(f.store.get(first.operationId, f.callerId)?.state).toBe('partial')
    expect(() => f.coordinator.prepare(f.callerId, { ...args, operationId: randomUUID() }, f.rendererEpoch, access, 'generate_video_edit_subtitles')).toThrow('RECOVERY_REQUIRED')
    const resumed = f.coordinator.prepare(f.callerId, { ...args, operationId: randomUUID(), audioDocumentRef: { kind: 'audio_edit.document', id: 'audio' } }, f.rendererEpoch, access, 'generate_video_edit_subtitles')
    expect(resumed.recoveryOf).toBe(first.operationId)
  })
  it.each(['external', 'embedded'] as const)('%s 确认立即返回、查询区分状态、相同 ID 不重派发、点击后完成', async callerKind => {
    const f = fixture()
    const bridge = new ApplicationHostBridge(() => undefined, f.coordinator)
    let request!: LocalHostRequest
    const send = vi.fn((channel: string, payload: unknown) => { if (channel === 'application:host:request') {
      request = payload as LocalHostRequest
      bridge.complete({ ...request, result: { ok: false }, progress: { phase: 'awaiting_user_confirmation', confirmation: applicationUserConfirmation({ title: '确认识别费用', message: '按模型计费', confirmLabel: '确认' }) } })
    } })
    bridge.register({ rendererEpoch: f.rendererEpoch, attachmentSequence: 1, ready: true, tools: [], domains: [] }, { send })
    const dispatcher = new ApplicationToolDispatcher({ assertActive() {}, access: () => ({ ...access, allowPaid: false }) }, bridge, f.coordinator, 0, callerKind)
    const raw = input(f.baseline)
    const signal = new AbortController().signal
    expect(await dispatcher.call(f.callerId, 'change_application_entities', raw, signal)).toMatchObject({ executionState: 'awaiting_user_confirmation', confirmation: { location: expect.stringContaining('痕迹AI'), continuation: expect.stringContaining('不要重复提交') } })
    const original = request
    expect(f.coordinator.result(f.store.get(String(raw.operationId), f.callerId)!)).toMatchObject({ executionState: 'awaiting_user_confirmation', verificationState: 'unresolved' })
    expect(await dispatcher.call(f.callerId, 'change_application_entities', raw, signal)).toMatchObject({ executionState: 'awaiting_user_confirmation' })
    expect(send).toHaveBeenCalledOnce()
    bridge.complete({ ...original, result: { ok: false }, progress: { phase: 'executing' } })
    expect(f.store.get(String(raw.operationId), f.callerId)?.state).toBe('executing')
    bridge.complete({ ...original, result: { ok: true, data: { verification: { verified: true } } } })
    expect(await dispatcher.call(f.callerId, 'get_application_operation', { operationId: raw.operationId }, signal)).toMatchObject({ executionState: 'completed', verificationState: 'verified' })
  })
  it('等待确认的重启为未执行；原 executing 重启保留 unknown 可人工核对', () => {
    const f = fixture()
    const waiting = f.coordinator.prepare(f.callerId, input(f.baseline), f.rendererEpoch, access)
    f.coordinator.dispatched(waiting, randomUUID(), f.rendererEpoch)
    const dispatched = f.store.get(waiting.operationId, f.callerId)!
    const confirmation = applicationUserConfirmation({ title: '确认', message: '识别费用', confirmLabel: '继续' })
    f.coordinator.complete({ requestId: dispatched.requestId!, rendererEpoch: f.rendererEpoch, result: { ok: false }, progress: { phase: 'awaiting_user_confirmation', confirmation } })
    f.store.recoverInterrupted()
    expect(f.store.get(waiting.operationId, f.callerId)).toMatchObject({ state: 'not_executed', verificationState: 'verified' })
    f.store.save({ ...dispatched, state: 'executing' })
    f.store.recoverInterrupted()
    expect(f.store.get(waiting.operationId, f.callerId)?.state).toBe('unknown')
    f.store.save({ ...dispatched, state: 'awaiting_user_confirmation', confirmation: { ...confirmation, purpose: 'review' } })
    f.store.recoverInterrupted()
    expect(f.store.get(waiting.operationId, f.callerId)?.state).toBe('unknown')
  })
  it('人工核对立即返回等待状态，取消不能冒充原修改未执行', async () => {
    const f = fixture()
    let answer!: (value: 'not_executed' | undefined) => void
    const coordinator = new ApplicationOperationCoordinator(f.store, undefined, () => new Set(['settings.registry']), () => new Promise(resolve => { answer = resolve }))
    const original = coordinator.prepare(f.callerId, input(f.baseline), f.rendererEpoch, access)
    f.store.save({ ...original, state: 'unknown', rendererEpoch: f.rendererEpoch })
    await coordinator.review(f.store.get(original.operationId, f.callerId)!, randomUUID(), async () => true, () => undefined)
    expect(f.store.get(original.operationId, f.callerId)?.state).toBe('awaiting_user_confirmation')
    answer(undefined)
    await vi.waitFor(() => expect(f.store.get(original.operationId, f.callerId)?.state).toBe('unknown'))
  })
  it('旧关闭剪辑前置拒绝自动核对，存在事务事实的同文案仍保留保护', () => {
    const f = fixture()
    const error = { code: 'CAPABILITY_REJECTED', message: '请先打开目标剪辑：在剪辑页打开所在项目，或用 open_document 打开这份剪辑（文档 ID 取自 list_documents）。' }
    const original = f.coordinator.prepare(f.callerId, input(f.baseline), f.rendererEpoch, access)
    f.store.save({ ...original, state: 'unknown', result: { ok: false, error: { ...error, details: { transaction: { partial: { completedStepIndexes: [0] } } } } } })
    expect(f.coordinator.result(f.store.get(original.operationId, f.callerId)!).executionState).toBe('unknown')
    f.store.save({ ...original, state: 'unknown', result: { ok: false, error } })
    expect(f.coordinator.result(f.store.get(original.operationId, f.callerId)!)).toMatchObject({ executionState: 'not_executed', verificationState: 'verified' })
    expect(() => f.coordinator.prepare(f.callerId, input(f.baseline), f.rendererEpoch, access)).not.toThrow()
  })
  it('重启后缺失回执可由应用核对恢复；原宿主、撤销授权及取消确认不能放行', async () => {
    const f = fixture(); const raw = input(f.baseline)
    const original = f.coordinator.prepare(f.callerId, raw, f.rendererEpoch, access)
    f.coordinator.dispatched(original, randomUUID(), f.rendererEpoch)
    const review = vi.fn<[], Promise<'not_executed' | undefined>>().mockResolvedValue(undefined)
    const coordinator = new ApplicationOperationCoordinator(f.store, undefined, () => new Set(['settings.registry']), review)
    const record = f.store.get(original.operationId, f.callerId)!
    const read = vi.fn().mockResolvedValue(true)
    await expect(coordinator.review(record, f.rendererEpoch, read, () => undefined)).rejects.toThrow('RECOVERY_SESSION_ACTIVE')
    expect(review).not.toHaveBeenCalled()
    const nextEpoch = randomUUID()
    await coordinator.review(record, nextEpoch, read, () => undefined)
    await vi.waitFor(() => expect(f.store.get(original.operationId, f.callerId)?.state).toBe('unknown'))
    review.mockResolvedValue('not_executed')
    await expect(coordinator.review(record, nextEpoch, read, () => { throw new Error('权限已撤销') })).rejects.toThrow('权限已撤销')
    expect(f.store.get(original.operationId, f.callerId)?.state).toBe('unknown')
    await coordinator.review(record, nextEpoch, read, () => undefined)
    await vi.waitFor(() => expect(f.store.get(original.operationId, f.callerId)).toMatchObject({ state: 'not_executed', verificationState: 'verified' }))
    expect(read).toHaveBeenCalledWith({ kind: 'settings.registry', id: 'singleton' })
  })
  it('宿主重连时公开写入立即登记未执行和重试时间，不依赖尚未注册的领域', async () => {
    const f = fixture(); const host = new ApplicationHostBridge(() => undefined)
    const coordinator = new ApplicationOperationCoordinator(f.store, undefined, () => host.writableEntityTypes())
    const dispatcher = new ApplicationToolDispatcher({ assertActive() {}, access: () => ({ ...access, allowPaid: false }) }, host, coordinator)
    const raw = input(f.baseline)
    expect(await dispatcher.call(f.callerId, 'change_application_entities', raw, new AbortController().signal)).toMatchObject({ executionState: 'not_executed', result: { error: { details: { execution: { notExecuted: true }, retryAfterMs: 1000 } } } })
    expect(f.store.get(String(raw.operationId), f.callerId)?.state).toBe('not_executed')
  })
  it('预检已知未开通拒绝预算预留，不提交任务', () => {
    const f = fixture()
    const record = f.coordinator.prepare(f.callerId, { operationId: randomUUID(), modelId: 'fixture', prompt: 'fixture', mediaType: 'audio' }, f.rendererEpoch, { ...access, allowPaid: true }, 'create_visible_generation_task')
    expect(() => reserveGenerationBudget(f.store, record, { ok: true, data: { preparation: { canSubmit: false, errorCode: 'PROVIDER_PRODUCT_NOT_ACTIVATED', message: '请开通', priceEstimate: { comparableCnyAmount: 0.1 } } } })).toThrow('PROVIDER_PRODUCT_NOT_ACTIVATED')
    expect(f.store.get(record.operationId, f.callerId)?.paidGenerationEstimate).toBeUndefined()
  })
  it('明确未执行后同一 operationId 与参数可重新准备，unknown 仍禁止重放', () => {
    const f = fixture(); const raw = input(f.baseline)
    const first = f.coordinator.prepare(f.callerId, raw, f.rendererEpoch, access)
    f.store.save({ ...first, state: 'not_executed', result: { ok: false, error: { details: { execution: { notExecuted: true } } } } })
    const retry = f.coordinator.prepare(f.callerId, raw, f.rendererEpoch, access)
    expect(retry.state).toBe('prepared')
    expect(retry.result).toBeUndefined()
    f.store.save({ ...retry, state: 'unknown' })
    expect(f.coordinator.prepare(f.callerId, raw, f.rendererEpoch, access).state).toBe('unknown')
  })

  it('完整补偿的失败即使携带执行过的effects也确定收敛；保存不确定仍保留屏障', () => {
    const f = fixture()
    for (const persistence of [false, true]) {
      const original = f.coordinator.prepare(f.callerId, input(f.baseline), f.rendererEpoch, access)
      const requestId = randomUUID()
      f.coordinator.dispatched(original, requestId, f.rendererEpoch)
      f.coordinator.complete({ requestId, rendererEpoch: f.rendererEpoch, result: { ok: false, error: { details: { transaction: {
        effects: [{ effect: 'update' }], partial: { completedStepIndexes: [0], compensatedStepIndexes: [0], uncompensatedStepIndexes: [] },
        ...(persistence ? { persistence: { stage: 'document', persistenceState: 'unconfirmed' } } : {}),
      } } } } })
      expect(f.store.get(original.operationId, f.callerId)?.state).toBe(persistence ? 'partial' : 'rolled_back')
      if (!persistence) expect(() => f.coordinator.prepare(f.callerId, input(f.baseline), f.rendererEpoch, access)).not.toThrow()
    }
  })
  it('丢失回执核对仅接受原请求与原渲染会话；没有证据不能猜未执行', async () => {
    const f = fixture()
    const original = f.coordinator.prepare(f.callerId, input(f.baseline), f.rendererEpoch, access)
    const requestId = randomUUID()
    f.coordinator.dispatched(original, requestId, f.rendererEpoch)
    f.coordinator.interrupted(requestId, f.rendererEpoch)
    for (const reply of [undefined,
      { requestId: randomUUID(), rendererEpoch: f.rendererEpoch, result: { ok: true } },
      { requestId, rendererEpoch: randomUUID(), result: { ok: true } }]) {
      await f.coordinator.reconcileReceipt(f.store.get(original.operationId, f.callerId)!, async () => ({ ok: true, data: { operationReply: reply } }))
      expect(f.store.get(original.operationId, f.callerId)?.state).toBe('unknown')
    }
    const read = vi.fn(async () => ({ ok: true, data: { operationReply: { requestId, rendererEpoch: f.rendererEpoch,
      result: { ok: false, error: { details: { execution: { notExecuted: true } } } } } } }))
    await f.coordinator.reconcileReceipt(f.store.get(original.operationId, f.callerId)!, read)
    expect(f.store.get(original.operationId, f.callerId)).toMatchObject({ state: 'not_executed', verificationState: 'verified' })
    expect(() => f.coordinator.prepare(f.callerId, input(f.baseline), f.rendererEpoch, access)).not.toThrow()
  })
  it.each([false, true])('新连接仅在全部目标重新核实=%s 后才能继续修改，不会重放旧事务', async (verified) => {
    const f = fixture()
    const original = f.coordinator.prepare(f.callerId, input(f.baseline), f.rendererEpoch, access)
    f.store.save({ ...original, state: 'partial', result: { ok: false, error: { details: { transaction: { code: 'VERIFICATION_FAILED', partial: { completedStepIndexes: [0], compensatedStepIndexes: [], uncompensatedStepIndexes: [0] } } } } } })
    const host = new ApplicationHostBridge(() => undefined, f.coordinator)
    vi.spyOn(host, 'ready', 'get').mockReturnValue(true)
    const execute = vi.spyOn(host, 'execute').mockImplementation(async (_caller, capability, _input, _signal, options) => {
      if (capability === 'get_current_application_context') return { ok: true, data: { verification: { verified } } }
      if (!options?.operation || options.operation.operationId === original.operationId) throw new Error('不得重放原写入')
      f.store.save({ ...options.operation, state: 'completed', verificationState: 'verified', result: { ok: true, data: { status: 'completed', transactionRef: 'fixture-transaction', resultingRevisions: {}, resultRefs: [], effects: [], evidence: [], verification: { verified: true, evidence: [], unmetConditions: [], checkedAt: new Date().toISOString() } } } })
      return { ok: true }
    })
    const dispatcher = new ApplicationToolDispatcher({ assertActive: () => undefined, access: () => ({ ...access, allowPaid: false }) }, host, f.coordinator)
    const raw = input(f.baseline)
    delete raw.baselineIds
    const next = await dispatcher.call('new-caller', 'change_application_entities', raw, new AbortController().signal)
    expect(next.ok).toBe(verified)
    expect(execute).toHaveBeenCalledTimes(verified ? 2 : 1)
    expect(f.store.get(original.operationId, f.callerId)?.state).toBe(verified ? 'completed' : 'partial')
    expect(JSON.stringify(next)).not.toContain(original.operationId)
  })
  it('完整执行后的核实失败只重新读取，成功才解除屏障并保留原失败事实', async () => {
    const f = fixture()
    const original = f.coordinator.prepare(f.callerId, input(f.baseline), f.rendererEpoch, access)
    const result = { ok: false, error: { details: { transaction: { code: 'VERIFICATION_FAILED', partial: { completedStepIndexes: [0], compensatedStepIndexes: [], uncompensatedStepIndexes: [0] } } } } }
    f.store.save({ ...original, state: 'partial', result })
    const verify = vi.fn().mockResolvedValue({ ok: true, data: { verification: { verified: false } } })
    await f.coordinator.reconcileVerification(f.store.get(original.operationId, f.callerId)!, verify)
    expect(() => f.coordinator.prepare(f.callerId, input(f.baseline), f.rendererEpoch, access)).toThrow('RECOVERY_REQUIRED')
    verify.mockResolvedValueOnce({ ok: true, data: { verification: { verified: true } } })
    await f.coordinator.reconcileVerification(f.store.get(original.operationId, f.callerId)!, verify)
    const recovered = f.store.get(original.operationId, f.callerId)!
    expect(recovered).toMatchObject({ state: 'completed', verificationState: 'verified', result, recoveryResult: { data: { verification: { verified: true } } } })
    expect(() => f.coordinator.prepare(f.callerId, input(f.baseline), f.rendererEpoch, access)).not.toThrow()
    expect(verify).toHaveBeenCalledWith(expect.objectContaining({ conditions: [expect.objectContaining({ kind: 'property_equals', expected: 'strong' })], evidence: [] }))
  })

  it('查询核实复用只读宿主与权限，其他调用者查询不泄漏原操作', async () => {
    const f = fixture()
    const original = f.coordinator.prepare(f.callerId, input(f.baseline), f.rendererEpoch, access)
    f.store.save({ ...original, state: 'partial', result: { ok: false, error: { details: { transaction: { code: 'VERIFICATION_FAILED', partial: { completedStepIndexes: [0], compensatedStepIndexes: [], uncompensatedStepIndexes: [0] } } } } } })
    const host = new ApplicationHostBridge(() => undefined, f.coordinator)
    vi.spyOn(host, 'ready', 'get').mockReturnValue(true)
    const execute = vi.spyOn(host, 'execute').mockResolvedValue({ ok: true, data: { verification: { verified: true } } })
    const dispatcher = new ApplicationToolDispatcher({ assertActive: () => undefined, access: () => ({ ...access, allowPaid: false }) }, host, f.coordinator)
    expect(await dispatcher.call('another', 'get_application_operation', { operationId: original.operationId }, new AbortController().signal)).toMatchObject({ executionState: 'not_found' })
    expect(execute).not.toHaveBeenCalled()
    expect(await dispatcher.call(f.callerId, 'get_application_operation', { operationId: original.operationId }, new AbortController().signal)).toMatchObject({ ok: true, executionState: 'completed' })
    expect(execute).toHaveBeenCalledOnce()
    expect(execute).toHaveBeenCalledWith(f.callerId, 'get_current_application_context', {}, expect.any(AbortSignal), expect.objectContaining({ recoveryVerification: expect.objectContaining({ conditions: expect.any(Array) }) }))
  })
  it('调用者范围内去重，同键跨调用者生成独立业务身份且不能读取对方回执', () => {
    const f = fixture()
    const other = randomUUID()
    const raw = { operationId: randomUUID(), modelId: 'fixture', prompt: '相同输入', mediaType: 'image' }
    const paid = { ...access, allowPaid: true }
    const original = f.coordinator.prepare(f.callerId, raw, f.rendererEpoch, paid, 'create_visible_generation_task')
    expect(f.store.get(original.operationId, other)).toBeUndefined()
    f.coordinator.dispatched(original, randomUUID(), f.rendererEpoch)
    const second = f.coordinator.prepare(other, raw, f.rendererEpoch, paid, 'create_visible_generation_task')
    expect(second.targetRefs).not.toEqual(original.targetRefs)
    expect(f.store.get(raw.operationId, f.callerId)?.state).toBe('executing')
    expect(f.store.get(raw.operationId, other)?.state).toBe('prepared')
    expect(() => f.coordinator.prepare(f.callerId, { ...raw, prompt: '偷偷替换参数' }, f.rendererEpoch, paid, 'create_visible_generation_task')).toThrow('OPERATION_INPUT_CONFLICT')
  })

  it('并发相同请求只准备、预留和提交一次，不同调用者的同键互不合并', async () => {
    const f = fixture()
    const host = new ApplicationHostBridge(() => undefined, f.coordinator)
    const pending: LocalHostRequest[] = []
    host.register({ rendererEpoch: f.rendererEpoch, attachmentSequence: 1, ready: true, tools: [], domains: [] }, { send(channel, value) {
      if (channel === 'application:host:request') pending.push(value as LocalHostRequest)
    } })
    const dispatcher = new ApplicationToolDispatcher({ assertActive() {}, access: () => ({ ...access, allowPaid: true }) }, host, f.coordinator)
    const raw = { operationId: randomUUID(), modelId: 'fixture', prompt: '只提交一次', mediaType: 'image' }
    const signal = new AbortController().signal
    const first = dispatcher.call(f.callerId, 'create_visible_generation_task', raw, signal)
    const duplicate = await dispatcher.call(f.callerId, 'create_visible_generation_task', raw, signal)
    expect(duplicate.executionState).toBe('preparing')
    expect(pending).toHaveLength(1)
    host.complete({ rendererEpoch: f.rendererEpoch, requestId: pending[0].requestId, result: { ok: true, data: { preparation: { priceEstimate: { comparableCnyAmount: 2 } } } } })
    await vi.waitFor(() => expect(pending).toHaveLength(2))
    // 费用判定与预留在执行付费操作时由统一 AI 付费授权完成，派发层只记录正式估价
    expect(f.store.get(raw.operationId, f.callerId)?.paidGenerationEstimate).toBe(2)
    expect(pending[1].operationId).toBe(applicationInvocationId(f.callerId, raw.operationId))
    host.complete({ rendererEpoch: f.rendererEpoch, requestId: pending[1].requestId, result: { ok: true, data: { taskId: 'generated-task', status: 'submitted', verification: { verified: true, condition: '生成任务已登记' } } } })
    expect(await first).toMatchObject({ executionState: 'completed' })
    expect(await dispatcher.call(f.callerId, 'create_visible_generation_task', raw, signal)).toMatchObject({ executionState: 'completed' })
    expect(pending).toHaveLength(2)
  })

  it('准备期间退出明确未派发，已经派发的退出只标未知，均不自动重放', () => {
    const f = fixture()
    const preparing = f.coordinator.prepare(f.callerId, input(f.baseline), f.rendererEpoch, access)
    expect(f.store.beginPreparation(preparing)).toBe(true)
    expect(f.store.beginPreparation(preparing)).toBe(false)
    const started = f.coordinator.prepare(f.callerId, { operationId: randomUUID(), modelId: 'fixture', prompt: '独立请求', mediaType: 'image' }, f.rendererEpoch, { ...access, allowPaid: true }, 'create_visible_generation_task')
    f.coordinator.dispatched(started, randomUUID(), f.rendererEpoch)
    f.store.recoverInterrupted()
    expect(f.store.get(preparing.operationId, f.callerId)).toMatchObject({ state: 'not_executed', result: { error: { details: { execution: { notExecuted: true } } } } })
    expect(f.store.get(started.operationId, f.callerId)?.state).toBe('unknown')
  })

  it.each([1, 51])('原节点提交实际入口先准备并记录估价，估价 %s 元', async amount => {
    const f = fixture()
    const raw = { operationId: randomUUID(), documentId: 'project', nodeId: 'tool', inputSignature: 'canvas-input-fixture' }
    expect(() => f.coordinator.prepare(f.callerId, raw, f.rendererEpoch, access, 'submit_canvas_node_generation')).toThrow('付费生成授权')
    const calls: LocalHostRequest[] = []
    const host = new ApplicationHostBridge(() => undefined, f.coordinator)
    host.register({ rendererEpoch: f.rendererEpoch, attachmentSequence: 1, ready: true, tools: [], domains: [] }, { send(channel, value) {
      if (channel !== 'application:host:request') return
      const request = value as LocalHostRequest
      calls.push(request)
      host.complete({ rendererEpoch: f.rendererEpoch, requestId: request.requestId, result: { ok: true, data:
        request.capabilityId === 'prepare_canvas_node_generation' ? { preparation: { priceEstimate: { comparableCnyAmount: amount } } }
          : { taskId: 'generated-task', status: 'submitted', verification: { verified: true, condition: '生成任务已登记' } } } })
    } })
    const dispatcher = new ApplicationToolDispatcher({ assertActive() {}, access: () => ({ ...access, allowPaid: true }) }, host, f.coordinator)
    const result = await dispatcher.call(f.callerId, 'submit_canvas_node_generation', raw, new AbortController().signal)
    expect(calls.map(call => call.capabilityId)).toEqual(['prepare_canvas_node_generation', 'submit_canvas_node_generation'])
    expect(f.store.get(raw.operationId, f.callerId)?.paidGenerationEstimate).toBe(amount)
    expect(calls[0].input).toMatchObject({ inputSignature: raw.inputSignature })
    expect(result.ok).toBe(true)
    expect(f.store.get(raw.operationId, f.callerId)?.state).toBe('completed')
  })
  it('执行原节点只保护本节点，同项目其他节点继续追加，未知原请求不重放', () => {
    const f = fixture()
    const paid = { ...access, allowPaid: true }
    const raw = { operationId: randomUUID(), documentId: 'project', nodeId: 'first', inputSignature: 'original-input' }
    const first = f.coordinator.prepare(f.callerId, raw, f.rendererEpoch, paid, 'submit_canvas_node_generation')
    const requestId = randomUUID()
    f.coordinator.dispatched(first, requestId, f.rendererEpoch)
    f.coordinator.interrupted(requestId, f.rendererEpoch)
    expect(f.coordinator.prepare(f.callerId, { ...raw, operationId: randomUUID(), nodeId: 'second' }, f.rendererEpoch, paid, 'submit_canvas_node_generation').state).toBe('prepared')
    expect(() => f.coordinator.prepare(f.callerId, { ...raw, operationId: randomUUID() }, f.rendererEpoch, paid, 'submit_canvas_node_generation')).toThrow(first.operationId)
  })
  it.each([1, 51])('按声明派生新付费入口的授权与预算，估价 %s 元', async amount => {
    const original = BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get.bind(BUILTIN_APPLICATION_CAPABILITY_REGISTRY)
    const spy = vi.spyOn(BUILTIN_APPLICATION_CAPABILITY_REGISTRY, 'get').mockImplementation(id => {
      const value = original(id)
      return id === 'apply_canvas_image_capability' && value ? { ...value, paidGenerationPreparation: 'get_model_schema' } : value
    })
    try {
      const f = fixture()
      const raw = { operationId: randomUUID(), documentId: 'project', sourceNodeId: 'source', capabilityId: 'image.upscale' }
      expect(() => f.coordinator.prepare(f.callerId, raw, f.rendererEpoch, access, 'apply_canvas_image_capability')).toThrow('付费生成授权')
      const calls: LocalHostRequest[] = []
      const host = new ApplicationHostBridge(() => undefined, f.coordinator)
      host.register({ rendererEpoch: f.rendererEpoch, attachmentSequence: 1, ready: true, tools: [], domains: [] }, { send(channel, value) {
        if (channel !== 'application:host:request') return
        const request = value as LocalHostRequest
        calls.push(request)
        host.complete({ rendererEpoch: f.rendererEpoch, requestId: request.requestId, result: { ok: true, data:
          request.capabilityId === 'get_model_schema' ? { preparation: { priceEstimate: { comparableCnyAmount: amount } } }
            : { documentId: 'project', kind: 'canvas-node', capabilityId: 'image.upscale', sourceNodeId: 'source', nodeId: 'result', edgeId: 'edge', undoRef: 'undo', verification: { verified: true, condition: '画布节点已登记' } } } })
      } })
      const dispatcher = new ApplicationToolDispatcher({ assertActive() {}, access: () => ({ ...access, allowPaid: true }) }, host, f.coordinator)
      const result = await dispatcher.call(f.callerId, 'apply_canvas_image_capability', raw, new AbortController().signal)
      expect(calls.map(call => call.capabilityId)).toEqual(['get_model_schema', 'apply_canvas_image_capability'])
      expect(result.ok).toBe(true)
      expect(f.store.get(raw.operationId, f.callerId)?.state).toBe('completed')
      expect(f.store.get(raw.operationId, f.callerId)?.paidGenerationEstimate).toBe(amount)
    } finally { spy.mockRestore() }
  })
  it('续查只占用原任务和节点，不要求付费权限，也不锁住同项目其他任务', () => {
    const f = fixture()
    const raw = { operationId: randomUUID(), taskId: 'task-a', documentId: 'project', sourceNodeId: 'source-a', resultNodeIds: ['result-a'] }
    const first = f.coordinator.prepare(f.callerId, raw, f.rendererEpoch, access, 'resume_canvas_generation_task')
    expect(first.targetRefs).toEqual([
      { kind: 'generation.task', id: 'task-a' }, { kind: 'canvas.node', id: 'project:source-a' }, { kind: 'canvas.node', id: 'project:result-a' },
    ])
    f.coordinator.dispatched(first, randomUUID(), f.rendererEpoch)
    expect(f.coordinator.prepare(f.callerId, { ...raw, operationId: randomUUID(), taskId: 'task-b', sourceNodeId: 'source-b', resultNodeIds: ['result-b'] },
      f.rendererEpoch, access, 'resume_canvas_generation_task').state).toBe('prepared')
    expect(() => f.coordinator.prepare(f.callerId, { ...raw, operationId: randomUUID() },
      f.rendererEpoch, access, 'resume_canvas_generation_task')).toThrow(first.operationId)
  })
  it('编辑预览读取同一素材不互锁，未知创建不能重放，保存锁定被消费的预览', () => {
    const f = fixture()
    const raw = { operationId: randomUUID(), sourceRef: { kind: 'asset', id: 'source-image' }, operations: [{ kind: 'flip_h' }] }
    const first = f.coordinator.prepare(f.callerId, raw, f.rendererEpoch, access, 'create_image_edit_preview')
    expect(first.targetRefs).toEqual([{ kind: 'image_edit.preview', id: `pending:${applicationInvocationId(f.callerId, raw.operationId)}` }])
    const requestId = randomUUID()
    f.coordinator.dispatched(first, requestId, f.rendererEpoch)
    expect(f.coordinator.prepare(f.callerId, { ...raw, operationId: randomUUID(), operations: [{ kind: 'rotate_cw', degrees: 90 }] },
      f.rendererEpoch, access, 'create_image_edit_preview').state).toBe('prepared')
    f.coordinator.interrupted(requestId, f.rendererEpoch)
    expect(() => f.coordinator.prepare(f.callerId, { ...raw, operationId: randomUUID() }, f.rendererEpoch, access, 'create_image_edit_preview')).toThrow(first.operationId)
    const commit = f.coordinator.prepare(f.callerId, { operationId: randomUUID(), previewRef: 'preview-existing' }, f.rendererEpoch, access, 'commit_image_edit')
    expect(commit.targetRefs).toEqual([{ kind: 'image_edit.preview', id: 'preview-existing' }])
    f.coordinator.dispatched(commit, randomUUID(), f.rendererEpoch)
    expect(() => f.coordinator.prepare(f.callerId, { operationId: randomUUID(), previewRef: 'preview-existing', displayName: '另一个名字' },
      f.rendererEpoch, access, 'commit_image_edit')).toThrow(commit.operationId)
  })
  it('生成历史中的未知请求即使写入独立任务，也不能换操作标识重放', () => {
    const f = fixture()
    const raw = { operationId: randomUUID(), modelId: 'fixture', prompt: '原请求', mediaType: 'image', destination: { mode: 'history' } }
    const first = f.coordinator.prepare(f.callerId, raw, f.rendererEpoch, { ...access, allowPaid: true }, 'create_visible_generation_task')
    const requestId = randomUUID()
    f.coordinator.dispatched(first, requestId, f.rendererEpoch)
    f.coordinator.interrupted(requestId, f.rendererEpoch)
    expect(() => f.coordinator.prepare(f.callerId, { ...raw, operationId: randomUUID() }, f.rendererEpoch,
      { ...access, allowPaid: true }, 'create_visible_generation_task')).toThrow(first.operationId)
    const independent = f.coordinator.prepare(f.callerId, { ...raw, operationId: randomUUID(), prompt: '独立的新请求' }, f.rendererEpoch,
      { ...access, allowPaid: true }, 'create_visible_generation_task')
    expect(independent.state).toBe('prepared')
  })
  it('图片能力只锁追加目标，读取同一参考节点的独立工具可以连续派发', () => {
    const f = fixture()
    const raw = { operationId: randomUUID(), documentId: 'image-project', sourceNodeId: 'image-source', capabilityId: 'image.background-removal' }
    const first = f.coordinator.prepare(f.callerId, raw, f.rendererEpoch, access, 'apply_canvas_image_capability')
    expect(first.targetRefs).toEqual([{ kind: 'canvas.document', id: raw.documentId }])
    f.coordinator.dispatched(first, randomUUID(), f.rendererEpoch)
    const second = f.coordinator.prepare(f.callerId, { ...raw, operationId: randomUUID(), capabilityId: 'image.upscale' }, f.rendererEpoch, access, 'apply_canvas_image_capability')
    f.coordinator.dispatched(second, randomUUID(), f.rendererEpoch)
    expect(f.store.unresolved().map((record) => record.state)).toEqual(['executing', 'executing'])
  })
  it('有明确完整回滚事实才结束占用，未知错误和保存失败不冒充回滚', () => {
    for (const [details, expected] of [
      [{ execution: { rolledBack: true } }, 'rolled_back'],
      [{ transaction: { partial: { completedStepIndexes: [0], compensatedStepIndexes: [0], uncompensatedStepIndexes: [] } } }, 'rolled_back'],
      [{ transaction: { partial: { completedStepIndexes: [0], compensatedStepIndexes: [], uncompensatedStepIndexes: [0] } } }, 'unknown'],
      [{ execution: { rolledBack: true }, persistence: {} }, 'partial'],
      [{ execution: { rolledBack: true, billing: 'completed', targetMutation: 'none' } }, 'partial'],
      [{ execution: { billing: 'unknown', notExecuted: false }, transaction: { partial: { completedStepIndexes: [] } } }, 'unknown'],
      [{ effects: [{ kind: 'update' }], execution: { notExecuted: false } }, 'partial'],
    ] as const) {
      const f = fixture()
      const record = f.coordinator.prepare(f.callerId, input(f.baseline), f.rendererEpoch, access)
      const requestId = randomUUID(); f.coordinator.dispatched(record, requestId, f.rendererEpoch)
      f.coordinator.complete({ requestId, rendererEpoch: f.rendererEpoch, result: { ok: false, error: { details } } })
      expect(f.store.get(record.operationId, f.callerId)?.state).toBe(expected)
      expect(f.store.unresolved().length).toBe(expected === 'rolled_back' ? 0 : 1)
    }
  })
  it('旧结果导入未知记录不锁住同一画布的独立新增；五个生成可同时登记派发', async () => {
    const f = fixture()
    const project = { kind: 'canvas.document', id: 'user-project' }
    const old = { operationId: randomUUID(), callerId: randomUUID(), inputDigest: 'legacy', state: 'unknown' as const,
      capabilityId: 'add_generation_result_to_canvas' as const, input: { documentId: project.id, resultRef: { kind: 'generation.result', id: 'old-result' } },
      targetRefs: [project, { kind: 'generation.result', id: 'old-result' }],
      result: { ok: false, error: { code: 'INVALID_INPUT', message: 'sourceFileName: Too big' } } }
    f.store.save(old)
    const pending: LocalHostRequest[] = []
    const host = new ApplicationHostBridge(() => undefined, f.coordinator)
    host.register({ rendererEpoch: f.rendererEpoch, attachmentSequence: 1, ready: true, tools: [], domains: [] }, { send(channel, value) {
      if (channel !== 'application:host:request') return
      const request = value as LocalHostRequest
      if (request.capabilityId === 'prepare_generation_task') host.complete({ rendererEpoch: f.rendererEpoch, requestId: request.requestId,
        result: { ok: true, data: { preparation: { priceEstimate: { comparableCnyAmount: 0.34 } } } } })
      else pending.push(request)
    } })
    const dispatcher = new ApplicationToolDispatcher({ assertActive() {}, access: () => ({ ...access, allowPaid: true }) }, host, f.coordinator)
    const calls = Array.from({ length: 5 }, (_, index) => dispatcher.call(f.callerId, 'create_visible_generation_task', {
      operationId: randomUUID(), modelId: 'fixture', prompt: `新请求 ${index}`, mediaType: 'image',
      destination: { mode: 'canvas', documentId: project.id, sourceNodeIds: ['reference'] },
    }, new AbortController().signal))
    await vi.waitFor(() => expect(pending).toHaveLength(5))
    for (const request of pending) host.complete({ rendererEpoch: f.rendererEpoch, requestId: request.requestId,
      result: { ok: true, data: { taskId: request.operationId, status: 'submitted', verification: { verified: true, condition: '生成任务已登记' } } } })
    for (const reply of await Promise.all(calls)) expect(reply).toMatchObject({ executionState: 'completed' })
    expect(f.store.get(old.operationId, old.callerId)).toEqual(old)
  })

  it('集合追加兼容独立追加，但删除、覆盖、保存失败和未知请求换标识仍拒绝', () => {
    const f = fixture()
    const project = { kind: 'canvas.document', id: 'project' }
    const args = { operationId: randomUUID(), modelId: 'fixture', prompt: '第一张', mediaType: 'image', destination: { mode: 'canvas', documentId: project.id } }
    const first = f.coordinator.prepare(f.callerId, args, f.rendererEpoch, { ...access, allowPaid: true }, 'create_visible_generation_task')
    f.coordinator.dispatched(first, randomUUID(), f.rendererEpoch)
    const create = { operationId: randomUUID(), changes: [{ kind: 'create_items', entityType: 'canvas.node', parent: project, items: [{ properties: { 'canvas.node.node_type': 'uploadNode' } }] }] }
    const append = f.coordinator.prepare(f.callerId, create, f.rendererEpoch, access)
    f.coordinator.dispatched(append, randomUUID(), f.rendererEpoch)
    expect(f.coordinator.prepare(f.callerId, { ...args, operationId: randomUUID(), prompt: '第二张' }, f.rendererEpoch, { ...access, allowPaid: true }, 'create_visible_generation_task').state).toBe('prepared')
    expect(() => f.coordinator.prepare(f.callerId, { operationId: randomUUID(), changes: [{ kind: 'set_properties', entityType: project.kind, target: project, properties: { 'canvas.document.name': '改名' } }] }, f.rendererEpoch, access)).toThrow(first.operationId)
    const baseline = f.store.baseline(f.callerId, [project, { kind: 'canvas.node', id: 'project:node' }], { canvas: 1 }, f.rendererEpoch)
    expect(() => f.coordinator.prepare(f.callerId, { operationId: randomUUID(), baselineIds: [baseline.id], changes: [{ kind: 'remove_items', entityType: 'canvas.node', parent: project, targets: [{ kind: 'canvas.node', id: 'project:node' }] }] }, f.rendererEpoch, { ...access, allowDestructive: true })).toThrow('RECOVERY_REQUIRED')
    const active = f.store.get(first.operationId, f.callerId)!
    f.store.save({ ...active, state: 'unknown' })
    expect(() => f.coordinator.prepare(f.callerId, { ...args, operationId: randomUUID() }, f.rendererEpoch, { ...access, allowPaid: true }, 'create_visible_generation_task')).toThrow('RECOVERY_REQUIRED')
    f.store.save({ ...active, state: 'partial', result: { ok: false, error: { details: { persistence: {} } } } })
    expect(() => f.coordinator.prepare(f.callerId, { ...args, operationId: randomUUID(), prompt: '第三张' }, f.rendererEpoch, { ...access, allowPaid: true }, 'create_visible_generation_task')).toThrow('RECOVERY_REQUIRED')
  })

  it('完整工具派发自动准备生成，保存提交事实并去重', async () => {
    const f = fixture()
    const host = new ApplicationHostBridge(() => undefined, f.coordinator)
    const seen: string[] = []
    const cny = 1
    host.register({ rendererEpoch: f.rendererEpoch, attachmentSequence: 1, ready: true, tools: [], domains: [] }, { send(channel, value) {
      if (channel !== 'application:host:request') return
      const request = value as LocalHostRequest
      seen.push(request.capabilityId)
      const result = request.capabilityId === 'prepare_generation_task'
        ? { ok: true, data: { preparation: { priceEstimate: { comparableCnyAmount: cny } } } }
        : { ok: true, data: { taskId: 'created-task', status: 'submitted', verification: { verified: true, condition: '生成任务已登记' } } }
      host.complete({ rendererEpoch: f.rendererEpoch, requestId: request.requestId, result })
    } })
    const dispatcher = new ApplicationToolDispatcher({ assertActive() {}, access: () => ({ allowWrites: true, allowDestructive: false, allowPaid: true }) }, host, f.coordinator)
    const args = { operationId: randomUUID(), modelId: 'fixture', prompt: '普通生成', mediaType: 'image' }
    const result = await dispatcher.call(f.callerId, 'create_visible_generation_task', args, new AbortController().signal)
    expect(result).toMatchObject({ ok: true, executionState: 'completed' })
    expect(seen).toEqual(['prepare_generation_task', 'create_visible_generation_task'])
    expect(await dispatcher.call(f.callerId, 'create_visible_generation_task', args, new AbortController().signal)).toEqual(result)
    expect(seen).toHaveLength(2)
  })
  it('普通修改与生成不要求基线，删除仍绑定读取，未知操作仍禁止重放', () => {
    const f = fixture()
    const args = input(f.baseline); delete args.baselineIds
    const write = f.coordinator.prepare(f.callerId, args, f.rendererEpoch, access)
    expect(write.expectedRevisions).toBeUndefined()
    f.coordinator.dispatched(write, randomUUID(), f.rendererEpoch)
    expect(() => f.coordinator.prepare(f.callerId, { ...args, operationId: randomUUID() }, f.rendererEpoch, access)).toThrow('RECOVERY_REQUIRED')
    expect(() => f.coordinator.prepare(f.callerId, { operationId: randomUUID(), changes: [{ kind: 'remove_items', entityType: 'canvas.document', parent: { kind: 'canvas.document', id: 'parent' }, targets: [{ kind: 'canvas.document', id: 'target' }] }] }, f.rendererEpoch, { allowWrites: true, allowDestructive: true })).toThrow('BASELINE_REQUIRED')
    const generated = f.coordinator.prepare(f.callerId, { operationId: randomUUID(), modelId: 'fixture', prompt: '生成图片', mediaType: 'image' }, f.rendererEpoch, { ...access, allowPaid: true }, 'create_visible_generation_task')
    expect(generated.expectedRevisions).toBeUndefined()
  })

  it('正式准备保留估价，未知费用交给统一授权，不在准备时占用额度', () => {
    const f = fixture()
    for (const amount of [1, 51, null]) {
      const record = f.coordinator.prepare(f.callerId, { operationId: randomUUID(), modelId: 'fixture', prompt: '预算测试', mediaType: 'image' }, f.rendererEpoch, { ...access, allowPaid: true }, 'create_visible_generation_task')
      reserveGenerationBudget(f.store, record, { ok: true, data: { preparation: { priceEstimate: { comparableCnyAmount: amount } } } })
      expect(f.store.get(record.operationId, f.callerId)?.paidGenerationEstimate).toBe(amount)
    }
    expect(new ApplicationOperationStore(f.db).generationSpendSince(Date.now() - 600_000)).toBe(0)
  })
  it('无版本的任务读取仍绑定原目标与宿主会话，不能以其他任务或旧会话取消', () => {
    const f = fixture()
    const taskRef = { kind: 'camera_stage.render_task', id: 'immutable-task' }
    const read = f.coordinator.rememberRead(f.callerId, { ok: true, data: { taskRef, revisions: {} } }, f.rendererEpoch)
    expect(read.baselineId).toEqual(expect.any(String))
    const args = { operationId: randomUUID(), baselineIds: [read.baselineId], taskRef }
    const allowed = { allowWrites: true, allowDestructive: true }
    const record = f.coordinator.prepare(f.callerId, args, f.rendererEpoch, allowed, 'cancel_camera_stage_render_task')
    expect(record.expectedRevisions).toEqual({})
    expect(record.targetRefs).toContainEqual(taskRef)
    expect(() => f.coordinator.prepare(f.callerId, { ...args, operationId: randomUUID(), taskRef: { ...taskRef, id: 'other' } }, f.rendererEpoch, allowed, 'cancel_camera_stage_render_task')).toThrow('BASELINE_TARGET_MISMATCH')
    expect(() => f.coordinator.prepare(f.callerId, { ...args, operationId: randomUUID() }, randomUUID(), allowed, 'cancel_camera_stage_render_task')).toThrow('BASELINE_EXPIRED')
  })
  it('桥接等待取消后仍持久记录迟到回执，重载后的其他回执不能替代', async () => {
    const f = fixture()
    const record = f.coordinator.prepare(f.callerId, input(f.baseline), f.rendererEpoch, access)
    const channels: string[] = []
    let sent: LocalHostRequest | undefined
    const bridge = new ApplicationHostBridge(() => undefined, f.coordinator)
    bridge.register({ rendererEpoch: f.rendererEpoch, attachmentSequence: 1, ready: true, tools: [], domains: [] }, { send(channel, value) { channels.push(channel); if (channel === 'application:host:request') sent = value as LocalHostRequest } })
    const controller = new AbortController()
    const waiting = bridge.execute(f.callerId, 'change_application_entities', record.input, controller.signal, { operation: record, ...access })
    const rejected = expect(waiting).rejects.toThrow('取消')
    controller.abort()
    await rejected
    expect(channels).toEqual(['application:host:request'])
    bridge.releaseCaller(f.callerId)
    expect(channels).toEqual(['application:host:request'])
    expect(f.store.get(record.operationId, f.callerId)?.state).toBe('executing')
    if (!sent) throw new Error('request missing')
    const result = { ok: true, data: { verification: { verified: true }, effects: [{ target: 'original' }] } }
    bridge.complete({ rendererEpoch: randomUUID(), requestId: sent.requestId, result })
    expect(f.store.get(record.operationId, f.callerId)?.state).toBe('executing')
    bridge.complete({ rendererEpoch: f.rendererEpoch, requestId: sent.requestId, result })
    expect(f.store.get(record.operationId, f.callerId)).toMatchObject({ state: 'completed', verificationState: 'verified', result })
  })
  it('关闭原生数据库再打开保留回执，未返回的在途操作只核对为未知', () => {
    const filename = join(tmpdir(), `henji-mcp-${randomUUID()}.sqlite`)
    const callerId = randomUUID(); const operationId = randomUUID()
    let db = new Database(filename)
    createApplicationOperationTablesV1(db)
    try {
      const store = new ApplicationOperationStore(db)
      const record = store.prepare({ operationId, callerId, capabilityId: 'change_application_entities', inputDigest: 'input', input: {}, expectedRevisions: {}, state: 'prepared' })
      store.claim(record, randomUUID(), randomUUID())
      db.close(); db = new Database(filename)
      const restored = new ApplicationOperationCoordinator(new ApplicationOperationStore(db))
      expect(restored.store.get(operationId, callerId)?.state).toBe('unknown')
      expect(restored.store.get(operationId, callerId)?.inputDigest).toBe('input')
    } finally { db.close(); unlinkSync(filename) }
  })
  it('新账本初始化保留已有业务，派发前持久登记，原子认领拒绝第二次派发', () => {
    const f = fixture(); const raw = input(f.baseline)
    const record = f.coordinator.prepare(f.callerId, raw, f.rendererEpoch, access)
    expect(f.store.get(record.operationId, f.callerId)?.state).toBe('prepared')
    f.coordinator.dispatched(record, randomUUID(), f.rendererEpoch)
    expect(() => f.coordinator.dispatched(record, randomUUID(), f.rendererEpoch)).toThrow('ALREADY_CLAIMED')
    const restored = new ApplicationOperationCoordinator(new ApplicationOperationStore(f.db))
    expect(restored.store.get(record.operationId, f.callerId)?.state).toBe('unknown')
    expect(f.db.prepare('SELECT value FROM existing_business').get()).toEqual({ value: 'keep' })
    expect(restored.prepare(f.callerId, raw, f.rendererEpoch, access).state).toBe('unknown')
  })
  it('操作绑定主体和输入，原目标基线不能用其他对象或旧宿主替代', () => {
    const f = fixture(); const raw = input(f.baseline)
    const record = f.coordinator.prepare(f.callerId, raw, f.rendererEpoch, access)
    expect(() => f.coordinator.prepare(randomUUID(), raw, f.rendererEpoch, access)).toThrow('BASELINE_REQUIRED')
    expect(() => f.coordinator.prepare(f.callerId, { ...raw, summary: '不同请求' }, f.rendererEpoch, access)).toThrow('INPUT_CONFLICT')
    expect(() => f.coordinator.prepare(f.callerId, input(f.baseline), randomUUID(), access)).toThrow('BASELINE_EXPIRED')
    const other = f.store.baseline(f.callerId, [{ kind: 'canvas.document', id: 'B' }], { settings: 1 }, f.rendererEpoch)
    expect(() => f.coordinator.prepare(f.callerId, input(other.id), f.rendererEpoch, access)).toThrow('TARGET_MISMATCH')
    expect(f.store.get(record.operationId, f.callerId)?.state).toBe('prepared')
  })
  it('取消及重启未知保留原关联，匹配的迟到回执能收敛，无关读取不能解除', () => {
    const f = fixture(); const record = f.coordinator.prepare(f.callerId, input(f.baseline), f.rendererEpoch, access)
    const requestId = randomUUID(); f.coordinator.dispatched(record, requestId, f.rendererEpoch)
    f.coordinator.interrupted(requestId, f.rendererEpoch)
    expect(() => f.coordinator.prepare(f.callerId, input(f.baseline), f.rendererEpoch, access)).toThrow('RECOVERY_REQUIRED')
    f.coordinator.rememberRead(f.callerId, { ok: true, data: { ref: { kind: 'canvas.document', id: 'B' }, revisions: { canvas: 2 } } }, f.rendererEpoch)
    f.coordinator.complete({ requestId, rendererEpoch: randomUUID(), result: { ok: true } })
    expect(f.store.get(record.operationId, f.callerId)?.state).toBe('unknown')
    f.coordinator.complete({ requestId, rendererEpoch: f.rendererEpoch, result: { ok: true, data: { effects: [{ kind: 'update' }], verification: { verified: true } } } })
    expect(f.coordinator.result(f.store.get(record.operationId, f.callerId)!)).toMatchObject({ executionState: 'completed', verificationState: 'verified' })
    expect(new ApplicationOperationStore(f.db).get(record.operationId, f.callerId)?.result?.ok).toBe(true)
  })
  it('执行成功不是验证通过，部分事务和独立保存失败保留事实', () => {
    for (const result of [{ ok: true }, { ok: false, error: { details: { persistence: { replayMutation: false } } } }, { ok: false, error: { details: { transaction: { effects: [{ target: 'A' }], partial: { completedStepIndexes: [0] } } } } }]) {
      const f = fixture()
      const record = f.coordinator.prepare(f.callerId, input(f.baseline), f.rendererEpoch, access)
      const requestId = randomUUID(); f.coordinator.dispatched(record, requestId, f.rendererEpoch)
      f.coordinator.complete({ requestId, rendererEpoch: f.rendererEpoch, result })
      const saved = f.store.get(record.operationId, f.callerId)!
      expect(saved.result).toEqual(result)
      expect(saved.verificationState).toBe('unresolved')
      expect(saved.state).toBe(result.ok ? 'completed' : 'partial')
    }
  })
  it('正式零步骤失败标记未执行，已有prepared也不能绕过撤销写权限', () => {
    const f = fixture(); const raw = input(f.baseline)
    const record = f.coordinator.prepare(f.callerId, raw, f.rendererEpoch, access)
    expect(() => f.coordinator.prepare(f.callerId, raw, f.rendererEpoch, { allowWrites: false, allowDestructive: false })).toThrow('PERMISSION_DENIED')
    expect(() => f.coordinator.prepare(f.callerId, raw, randomUUID(), access)).toThrow('BASELINE_EXPIRED')
    const requestId = randomUUID(); f.coordinator.dispatched(record, requestId, f.rendererEpoch)
    f.coordinator.complete({ requestId, rendererEpoch: f.rendererEpoch, result: { ok: false, error: { details: { transaction: { partial: { completedStepIndexes: [] } } } } } })
    expect(f.store.get(record.operationId, f.callerId)?.state).toBe('not_executed')
  })
  it('删除检查实际通用动作，不依赖能力的destructive提示', () => {
    const f = fixture()
    expect(() => f.coordinator.prepare(f.callerId, { ...input(f.baseline), changes: [{ kind: 'remove_items', entityType: 'asset.library', parent: { kind: 'asset.catalog', id: 'default' }, targets: [{ kind: 'asset.library', id: 'A' }] }] }, f.rendererEpoch, access)).toThrow('没有删除授权')
  })
  it('仅保存恢复关联原操作与原会话，验证失败不清除部分事实，验证通过才关闭', () => {
    const f = fixture(); const project = { kind: 'canvas.document', id: 'A' }
    const baselineId = f.store.baseline(f.callerId, [project], { canvas: 1 }, f.rendererEpoch).id
    const raw = { operationId: randomUUID(), baselineIds: [baselineId], summary: '改名', changes: [{ kind: 'set_properties', entityType: project.kind, target: project, properties: { 'canvas.document.name': 'after' } }] }
    const record = f.coordinator.prepare(f.callerId, raw, f.rendererEpoch, access)
    const requestId = randomUUID(); f.coordinator.dispatched(record, requestId, f.rendererEpoch)
    const evidence = [{ kind: 'property_value', target: project, fact: '已改名', data: 'after', capturedAt: new Date().toISOString() }]
    const failure = { ok: false, error: { details: { transaction: { effects: [{ target: project }], persistence: { recovery: { capabilityId: 'retry_canvas_document_save', target: project, replayMutation: false } }, recoveryVerification: { conditions: [{ kind: 'property_equals', target: project, propertyId: 'canvas.document.name', expected: 'after' }], evidence } } } } }
    f.coordinator.complete({ requestId, rendererEpoch: f.rendererEpoch, result: failure })
    expect(() => f.coordinator.prepareSaveRecovery(f.callerId, { operationId: randomUUID(), originalOperationId: record.operationId }, randomUUID(), access)).toThrow('SESSION_LOST')
    const retryInput = { operationId: randomUUID(), originalOperationId: record.operationId }
    const rejectedRecovery = f.coordinator.prepareSaveRecovery(f.callerId, retryInput, f.rendererEpoch, access)
    const rejectedRequest = randomUUID()
    f.coordinator.dispatched(rejectedRecovery, rejectedRequest, f.rendererEpoch)
    f.coordinator.complete({ requestId: rejectedRequest, rendererEpoch: f.rendererEpoch,
      result: { ok: false, error: { code: 'CAPABILITY_REJECTED', message: '保存前置条件未满足', details: { execution: { notExecuted: true } } } } })
    expect(f.store.get(rejectedRecovery.operationId, f.callerId)?.state).toBe('not_executed')
    const retryRecovery = f.coordinator.prepareSaveRecovery(f.callerId, retryInput, f.rendererEpoch, access)
    expect(retryRecovery).toMatchObject({ state: 'prepared', recoveryOf: record.operationId })
    expect(retryRecovery.result).toBeUndefined()
    for (const verified of [false, true]) {
      const recovery = f.coordinator.prepareSaveRecovery(f.callerId, { operationId: randomUUID(), originalOperationId: record.operationId }, f.rendererEpoch, access)
      expect(recovery.input).toEqual({ documentRef: project })
      const saveRequest = randomUUID(); f.coordinator.dispatched(recovery, saveRequest, f.rendererEpoch)
      f.coordinator.complete({ requestId: saveRequest, rendererEpoch: f.rendererEpoch, result: { ok: true, data: { status: 'persisted', verification: { verified } } } })
      expect(f.store.get(record.operationId, f.callerId)?.state).toBe(verified ? 'completed' : 'partial')
      expect(f.store.get(record.operationId, f.callerId)?.result).toEqual(failure)
    }
  })
})
