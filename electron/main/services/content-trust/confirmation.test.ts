import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createContentTrustTestSession } from './test-support'
import { withNativeContentTrust, resumeContentTrustConfirmations, configureContentTrustConfirmations } from './confirmation'
import { ApplicationOperationStore, createApplicationOperationTablesV1 } from '../application-runtime/operationStore'
import { ApplicationOperationCoordinator } from '../application-runtime/operationCoordinator'

const ports = vi.hoisted(() => ({ send: vi.fn(), operations: undefined as unknown as ApplicationOperationCoordinator }))
vi.mock('../../window', () => ({ getMainWindow: () => ({ webContents: { send: ports.send } }) }))
let fixture: ReturnType<typeof createContentTrustTestSession>
beforeEach(() => {
  fixture = createContentTrustTestSession(); createApplicationOperationTablesV1(fixture.db)
  ports.operations = new ApplicationOperationCoordinator(new ApplicationOperationStore(fixture.db)); ports.send.mockClear()
  configureContentTrustConfirmations(ports.operations)
})
afterEach(() => { vi.useRealTimers(); fixture.dispose() })
it('原生助手拿到等待回执并能查原账本，用户选择后续接一次；助手输入不包含批准参数', async () => {
  const record = { id: 'skill-install', sourceType: 'skill' as const, sourceName: '外部技能' }
  const query = { contents: [record] }; const callerId = crypto.randomUUID(); let executions = 0
  const waiting = await withNativeContentTrust(callerId, query, { name: 'skill', reason: '任务需要' }, async () => { executions++; return { ok: true, data: { content: 'data marker' } } })
  expect(waiting).toMatchObject({ ok: false, executionState: 'awaiting_user_confirmation', operationId: expect.any(String) })
  expect(executions).toBe(0)
  expect(ports.send).toHaveBeenCalledWith('application:content-trust:request', { query })
  const operationId = String(waiting.operationId)
  expect(ports.operations.result(ports.operations.store.get(operationId, callerId)!)).toMatchObject({ executionState: 'awaiting_user_confirmation' })
  await resumeContentTrustConfirmations(); expect(executions).toBe(0)
  fixture.session.decide(fixture.session.check(query).challenge!, 'once')
  await resumeContentTrustConfirmations(); await resumeContentTrustConfirmations()
  expect(executions).toBe(1)
  expect(ports.operations.result(ports.operations.store.get(operationId, callerId)!)).toMatchObject({ executionState: 'completed', result: { ok: true, data: { content: 'data marker' } } })
})
it('原生技能拒绝后零次执行，轮询得到明确未执行结果', async () => {
  const record = { id: 'skill-install', sourceType: 'skill' as const, sourceName: '外部技能' }
  const query = { contents: [record] }; const callerId = crypto.randomUUID(); const run = vi.fn(async () => ({ ok: true }))
  const waiting = await withNativeContentTrust(callerId, query, {}, run)
  fixture.session.decide(fixture.session.check(query).challenge!, 'deny')
  await resumeContentTrustConfirmations()
  expect(run).not.toHaveBeenCalled()
  expect(ports.operations.result(ports.operations.store.get(String(waiting.operationId), callerId)!)).toMatchObject({ executionState: 'not_executed', result: { ok: false } })
})
it('等待超过现有确认期限后明确未执行，迟来的选择不能续接已过期读取', async () => {
  vi.useFakeTimers()
  const record = { id: 'skill-install', sourceType: 'skill' as const, sourceName: '外部技能' }
  const query = { contents: [record] }; const callerId = crypto.randomUUID(); const run = vi.fn(async () => ({ ok: true }))
  const waiting = await withNativeContentTrust(callerId, query, {}, run)
  await vi.advanceTimersByTimeAsync(5 * 60_000 + 1)
  fixture.session.decide(fixture.session.check(query).challenge!, 'once')
  await resumeContentTrustConfirmations()
  expect(run).not.toHaveBeenCalled()
  expect(ports.operations.store.get(String(waiting.operationId), callerId)).toMatchObject({ state: 'not_executed', result: { error: { code: 'CONFIRMATION_EXPIRED' } } })
})
