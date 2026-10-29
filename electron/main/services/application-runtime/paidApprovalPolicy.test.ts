import { reserveGenerationBudget } from './generationBudget'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { assertGenerationPaidReceipt, decidePaidApproval, localDayStart, approvePaidOperation, handleUiPaidApproval } from './paidApprovalPolicy'
import type { LocalHostReply } from '../../../../src/core/application-control/localHostContracts'
import { DEFAULT_PAID_APPROVAL_SETTINGS, readPaidApprovalSettingsValue, type PaidApprovalRequest } from '../../../../src/core/application-control/paidApproval'
import type { ApplicationOperationStore, OperationRecord } from './operationStore'
import { USER_CONFIRMATION_TIMEOUT_MS } from '../../../../src/core/application-control/userConfirmation'

const preferences = vi.hoisted(() => ({ value: '' }))
vi.mock('../settings/store', () => ({ getSettingsStore: () => ({ get: () => preferences.value || null, set: (_key: string, value: string) => { preferences.value = value } }) }))
vi.mock('../logging', () => ({ createMainLogger: () => ({ info() {} }) }))
beforeEach(() => { preferences.value = '' })
afterEach(() => { vi.useRealTimers() })
it.each([{}, { singleLimitCny: 2, dailyLimitCny: 20 }])('迁移每次询问策略后，收费与未知价格仍询问，零元可直接执行：%j', limits => {
  const settings = readPaidApprovalSettingsValue({ mode: 'ask', projects: [], ...limits })
  expect(settings).toMatchObject({ singleLimitCny: 0, unlimited: false })
  for (const [estimatedCny, decision] of [[0, 'auto'], [.01, 'ask'], [null, 'ask']] as const) {
    expect(decidePaidApproval(settings, { category: 'generation', estimatedCny }, 0).decision).toBe(decision)
  }
  expect(decidePaidApproval(settings, { category: 'generation', estimatedCny: 0 }, settings.dailyLimitCny + 1).decision).toBe('auto')
})
it('确认恰好到期后拒绝 approve，不产生额度预留', () => {
  vi.useFakeTimers()
  preferences.value = JSON.stringify({ ...DEFAULT_PAID_APPROVAL_SETTINGS, singleLimitCny: 0 })
  let record: OperationRecord | undefined
  const store = { get: () => record, save: (value: OperationRecord) => { record = value }, prepare: (value: OperationRecord) => (record = value), generationSpendSince: () => 0 }
  const reply: LocalHostReply = { requestId: 'expired', rendererEpoch: 'renderer', result: {}, uiPaidApproval: { capabilityId: 'ui_generate_title', action: 'prepare', request: { category: 'title', estimatedCny: 1 } } }
  expect(handleUiPaidApproval(store, reply)).toMatchObject({ expiresAt: Date.now() + USER_CONFIRMATION_TIMEOUT_MS })
  vi.advanceTimersByTime(USER_CONFIRMATION_TIMEOUT_MS)
  expect(() => handleUiPaidApproval(store, { ...reply, uiPaidApproval: { ...reply.uiPaidApproval!, action: 'approve' } })).toThrow('付费确认已结束')
  expect(record?.paidReservations).toBeUndefined()
})
const project = { id: 'project', name: '测试项目' }
it.each(['not_charged', 'submitted', 'completed', 'unknown', undefined] as const)('UI 失败 billing=%s 仅明确未计费时释放预留', billing => {
  let record: OperationRecord | undefined
  const store = { get: () => record, save: (value: OperationRecord) => { record = value }, prepare: (value: OperationRecord) => (record = value),
    generationSpendSince: () => record?.state === 'not_executed' ? 0 : (record?.paidReservations ?? []).reduce((sum, item) => sum + (item.estimatedCny ?? 0), 0) }
  const reply: LocalHostReply = { requestId: 'bill', rendererEpoch: 'renderer', result: {}, uiPaidApproval: { capabilityId: 'ui_generate_title', action: 'prepare', request: { category: 'title', estimatedCny: 1 } } }
  handleUiPaidApproval(store, reply)
  handleUiPaidApproval(store, { ...reply, uiPaidApproval: { ...reply.uiPaidApproval!, action: 'start' } })
  expect(store.generationSpendSince()).toBe(1)
  handleUiPaidApproval(store, { ...reply, uiPaidApproval: { ...reply.uiPaidApproval!, action: 'failed', ...(billing ? { failureFacts: { billing } } : {}) } })
  expect(record?.state).toBe(billing === 'not_charged' ? 'not_executed' : 'unknown')
  expect(store.generationSpendSince()).toBe(billing === 'not_charged' ? 0 : 1)
  expect(() => handleUiPaidApproval(store, { ...reply, uiPaidApproval: { ...reply.uiPaidApproval!, action: 'failed', failureFacts: { billing: 'not_charged' } } })).toThrow('尚未开始')
})
const request = (amount: number | null): PaidApprovalRequest => ({ category: 'recognition', estimatedCny: amount, project })
it.each([
  [0, 0, false, 'auto'], [2, 18, false, 'auto'], [2.01, 0, false, 'ask'],
  [1, 19.01, false, 'ask'], [null, 0, false, 'ask'],
  [100, 1000, true, 'auto'], [null, 1000, true, 'auto'],
] as const)('金额 %s 已用 %s 完全放开 %s => %s', (amount, spent, unlimited, expected) => {
  expect(decidePaidApproval({ ...DEFAULT_PAID_APPROVAL_SETTINGS, unlimited }, request(amount), spent).decision).toBe(expected)
})
it('自然日以本地午夜为边界', () => {
  const now = new Date(2026, 9, 12, 15, 30).getTime()
  expect(localDayStart(now)).toBe(new Date(2026, 9, 12).getTime())
})
it('同一操作账本同步预留，第二次请求不能穿透每日额度，未知金额保留为 null', () => {
  const records = new Map<string, OperationRecord>()
  const store = {
    get: (id: string) => records.get(id), save: (record: OperationRecord) => { records.set(record.operationId, record) },
    generationSpendSince: (since: number) => [...records.values()].filter(record => record.state !== 'not_executed').reduce((sum, record) => sum + (record.paidReservations ?? []).reduce((total, value) => total + (value.reservedAt >= since ? value.estimatedCny ?? 0 : 0), 0), 0),
  } as Pick<ApplicationOperationStore, 'get' | 'save' | 'generationSpendSince'>
  const record = (id: string): OperationRecord => ({ operationId: id, callerId: 'caller', capabilityId: 'transcribe_audio_edit', input: {}, inputDigest: id, state: 'executing' })
  preferences.value = JSON.stringify({ ...DEFAULT_PAID_APPROVAL_SETTINGS, dailyLimitCny: 2 })
  const first = record('first'), second = record('second'); store.save(first); store.save(second)
  expect(approvePaidOperation(store, first, request(2)).decision).toBe('auto')
  expect(approvePaidOperation(store, second, request(1)).decision).toBe('ask')
  expect(store.get('second', 'caller')?.paidReservations).toBeUndefined()
  approvePaidOperation(store, second, request(1), 'once')
  expect(store.get('second', 'caller')?.approval?.decision).toBe('user')
  preferences.value = JSON.stringify({ ...DEFAULT_PAID_APPROVAL_SETTINGS, unlimited: true })
  const third = record('third'); store.save(third)
  approvePaidOperation(store, third, request(null))
  expect(store.get('third', 'caller')?.paidReservations?.[0].estimatedCny).toBeNull()
})
it('讲解授权绑定原请求：拒绝不记费，确认不能重放，执行后不能撤回计费', () => {
  const records = new Map<string, OperationRecord>()
  const store = {
    get: (id: string) => records.get(id), save: (record: OperationRecord) => { records.set(record.operationId, record) },
    prepare: (record: OperationRecord) => { records.set(record.operationId, record); return record },
    generationSpendSince: () => [...records.values()].filter(record => record.state !== 'not_executed').reduce((sum, record) => sum + (record.paidReservations ?? []).reduce((total, value) => total + (value.estimatedCny ?? 0), 0), 0),
  }
  const send = (id: string, action: NonNullable<LocalHostReply['uiPaidApproval']>['action'], amount = 1) => handleUiPaidApproval(store, {
    requestId: id, rendererEpoch: 'renderer', result: {}, uiPaidApproval: { action, capabilityId: 'interpret_image_edit_intent', request: { category: 'explanation', estimatedCny: amount, project } },
  })
  expect(send('cancelled', 'prepare')).toMatchObject({ decision: 'auto' })
  expect(store.generationSpendSince()).toBe(1)
  send('cancelled', 'reject')
  expect(store.generationSpendSince()).toBe(0)
  expect(() => send('cancelled', 'start')).toThrow('先确认')
  preferences.value = JSON.stringify({ ...DEFAULT_PAID_APPROVAL_SETTINGS, singleLimitCny: 0 })
  expect(send('confirmed', 'prepare')).toMatchObject({ decision: 'ask' })
  expect(() => send('confirmed', 'approve', 2)).toThrow('不一致')
  send('confirmed', 'approve')
  expect(() => send('confirmed', 'approve')).toThrow('已结束')
  send('confirmed', 'start')
  expect(() => send('confirmed', 'start')).toThrow('先确认')
  expect(() => send('confirmed', 'reject')).toThrow('无法撤回')
  send('confirmed', 'complete')
  expect(records.get('confirmed')).toMatchObject({ state: 'completed', approval: { decision: 'user' } })
  expect(store.generationSpendSince()).toBe(1)
})

it('generation and recognition share unknown/estimated decisions and disclose upper-bound approval', () => {
  let record: OperationRecord = { operationId: 'estimate', callerId: 'caller', capabilityId: 'create_visible_generation_task', input: {}, inputDigest: '', state: 'preparing' }
  const store = { get: () => record, save: (value: OperationRecord) => { record = value }, generationSpendSince: () => 0 }
  reserveGenerationBudget(store, record, { ok: true, data: { preparation: { priceEstimate: { comparableCnyAmount: null } } } })
  expect(approvePaidOperation(store, record, { category: 'generation', estimatedCny: record.paidGenerationEstimate! }).decision).toBe('ask')
  reserveGenerationBudget(store, record, { ok: true, data: { preparation: { priceEstimate: { comparableCnyAmount: .01, estimateKind: 'upper-bound' } } } })
  approvePaidOperation(store, record, { category: 'generation', estimatedCny: record.paidGenerationEstimate! })
  expect(record.approval).toMatchObject({ decision: 'auto', reason: expect.stringContaining('按上限估算 ¥0.0100') })
  for (const category of ['generation', 'recognition'] as const) {
    expect(decidePaidApproval(DEFAULT_PAID_APPROVAL_SETTINGS, { category, estimatedCny: null }, 0).decision).toBe('ask')
    expect(decidePaidApproval({ ...DEFAULT_PAID_APPROVAL_SETTINGS, unlimited: true }, { category, estimatedCny: null }, 0).decision).toBe('auto')
    expect(decidePaidApproval(DEFAULT_PAID_APPROVAL_SETTINGS, { category, estimatedCny: .01 }, 0, 'upper-bound')).toMatchObject({ decision: 'auto', estimatedCny: .01, reason: expect.stringContaining('按上限估算 ¥0.0100') })
  }
})

it('异步生成在操作回执完成后仍消费原收据，重复请求复用但不能改输入或换任务', () => {
  let record: OperationRecord = { operationId: 'paid', callerId: 'caller', capabilityId: 'create_visible_generation_task', input: {}, inputDigest: '', state: 'completed',
    approval: { decision: 'auto', reason: '额度内' }, paidReservations: [{ category: 'generation', estimatedCny: 1, reservedAt: Date.now(), approval: { decision: 'auto', reason: '额度内' } }] }
  const store = { get: (id: string, caller: string) => id === record.operationId && caller === record.callerId ? record : undefined, save: (value: OperationRecord) => { record = value } }
  const receipt = { operationId: record.operationId, callerId: record.callerId }
  const request = { requestId: 'task', modelId: 'fixture', params: { prompt: '画面' } }
  expect(() => assertGenerationPaidReceipt(store, undefined, request)).toThrow('PAID_CONFIRMATION_REQUIRED')
  assertGenerationPaidReceipt(store, receipt, request)
  assertGenerationPaidReceipt(store, receipt, request)
  expect(record.paidReservations).toHaveLength(1)
  expect(() => assertGenerationPaidReceipt(store, receipt, { ...request, params: { prompt: '其他画面' } })).toThrow('GENERATION_INPUT_CONFLICT')
  expect(() => assertGenerationPaidReceipt(store, receipt, { ...request, requestId: 'other' })).toThrow('PAID_CONFIRMATION_REQUIRED')
  record = { ...record, state: 'not_executed' }
  expect(() => assertGenerationPaidReceipt(store, receipt, request)).toThrow('PAID_CONFIRMATION_REQUIRED')
})
