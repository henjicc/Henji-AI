import { beforeEach, expect, it, vi } from 'vitest'
import { decidePaidApproval, localDayStart, approvePaidOperation, handleUiPaidApproval } from './paidApprovalPolicy'
import type { LocalHostReply } from '../../../../src/core/application-control/localHostContracts'
import { DEFAULT_PAID_APPROVAL_SETTINGS, type PaidApprovalSettings, type PaidApprovalRequest } from '../../../../src/core/application-control/paidApproval'
import type { ApplicationOperationStore, OperationRecord } from './operationStore'

const preferences = vi.hoisted(() => ({ value: '' }))
vi.mock('../settings/store', () => ({ getSettingsStore: () => ({ get: () => preferences.value || null, set: (_key: string, value: string) => { preferences.value = value } }) }))
vi.mock('../logging', () => ({ createMainLogger: () => ({ info() {} }) }))
beforeEach(() => { preferences.value = '' })
const project = { id: 'project', name: '测试项目' }
const request = (amount: number | null): PaidApprovalRequest => ({ category: 'recognition', estimatedCny: amount, project })
it.each([
  ['ask', 0, 0, false, 'ask'], ['ask', 2, 18, true, 'auto'], ['ask', 2.01, 0, true, 'ask'],
  ['ask', 1, 20, true, 'ask'], ['ask', null, 0, true, 'ask'],
  ['auto', 0, 0, false, 'auto'], ['auto', 2, 18, false, 'auto'], ['auto', 2.01, 0, false, 'ask'],
  ['auto', 1, 19.01, false, 'ask'], ['auto', null, 0, false, 'ask'], ['auto', 2.01, 0, true, 'ask'],
  ['bypass', 15, 5, false, 'auto'], ['bypass', 15, 5.01, false, 'ask'],
  ['bypass', null, 20, false, 'auto'], ['bypass', null, 20.01, false, 'ask'],
] as const)('%s 金额 %s 已用 %s 项目授权 %s => %s', (mode, amount, spent, granted, expected) => {
  const settings: PaidApprovalSettings = { ...DEFAULT_PAID_APPROVAL_SETTINGS, mode, projects: granted ? [{ ...project, category: 'recognition' }] : [] }
  expect(decidePaidApproval(settings, request(amount), spent, true).decision).toBe(expected)
  expect(decidePaidApproval(settings, request(amount), spent, false).decision).toBe('deny')
})
it('项目授权严格限定项目与类别；未知不作为零费用', () => {
  const settings: PaidApprovalSettings = { ...DEFAULT_PAID_APPROVAL_SETTINGS, mode: 'ask', projects: [{ ...project, category: 'recognition' }] }
  expect(decidePaidApproval(settings, { ...request(1), project: { id: 'other', name: '另一个项目' } }, 0, true).decision).toBe('ask')
  expect(decidePaidApproval(settings, { ...request(1), category: 'translation' }, 0, true).decision).toBe('ask')
  expect(decidePaidApproval(settings, { category: 'recognition', estimatedCny: 1 }, 0, true).decision).toBe('ask')
  expect(decidePaidApproval(settings, request(1), 19.01, true).reason).toContain('今日已用 ¥19.01')
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
  expect(approvePaidOperation(store, first, request(2), true).decision).toBe('auto')
  expect(approvePaidOperation(store, second, request(1), true).decision).toBe('ask')
  expect(store.get('second', 'caller')?.paidReservations).toBeUndefined()
  approvePaidOperation(store, second, request(1), true, 'project')
  expect(store.get('second', 'caller')?.approval?.decision).toBe('user')
  expect(JSON.parse(preferences.value).projects).toEqual([{ ...project, category: 'recognition' }])
  preferences.value = JSON.stringify({ ...DEFAULT_PAID_APPROVAL_SETTINGS, mode: 'bypass' })
  const third = record('third'); store.save(third)
  approvePaidOperation(store, third, request(null), true)
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
  preferences.value = JSON.stringify({ ...DEFAULT_PAID_APPROVAL_SETTINGS, mode: 'ask' })
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
