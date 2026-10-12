import { expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { OperationRecord } from './operationStore'
import type { LocalHostRequest } from '../../../../src/core/application-control/localHostContracts'
import { applicationUserConfirmation } from '../../../../src/core/application-control/userConfirmation'
import { initializeApplicationRuntime, createEmbeddedApplicationClient } from './runtime'

vi.mock('electron', () => ({ app: { isPackaged: false }, dialog: { showMessageBox: vi.fn() } }))
vi.mock('../db', () => ({ getDb: () => undefined }))
vi.mock('../generation-history/store', () => ({ getGenerationHistoryStore: () => { throw new Error('本测试不得访问生成记录') } }))
// Storage boundary only; ownership, bridge, authorization and runtime lifecycle stay real.
vi.mock('./operationStore', async original => ({ ...await original<typeof import('./operationStore')>(), ApplicationOperationStore: class {
  records = new Map<string, OperationRecord>()
  recoverInterrupted() {}
  save(record: OperationRecord) { this.records.set(`${record.callerId}:${record.operationId}`, record) }
  get(id: string, caller: string) { return this.records.get(`${caller}:${id}`) }
  unresolved() { return [...this.records.values()].filter(record => ['preparing', 'executing', 'awaiting_user_confirmation', 'unknown', 'partial'].includes(record.state)) }
  byRequest(id: string, epoch: string) { return [...this.records.values()].find(record => record.requestId === id && record.rendererEpoch === epoch) }
  claim(record: OperationRecord, requestId: string, rendererEpoch: string) { this.save({ ...record, requestId, rendererEpoch, state: 'executing' }) }
} }))

it('Pi 回合关闭后，已登记的等待操作仍能确认执行；终态释放授权，下一回合沿原调用者查询', async () => {
  const { host, operations } = initializeApplicationRuntime()
  const callerId = randomUUID(), rendererEpoch = randomUUID()
  const client = createEmbeddedApplicationClient(callerId, { allowWrites: true, allowPaid: true, allowDestructive: false })
  let request!: LocalHostRequest
  host.register({ rendererEpoch, attachmentSequence: 1, ready: true, tools: [], domains: [] }, { send: (channel, payload) => {
    if (channel !== 'application:host:request') return
    request = payload as LocalHostRequest
    host.complete({ ...request, result: { ok: false }, progress: { phase: 'awaiting_user_confirmation', confirmation: applicationUserConfirmation({ title: '确认识别费用', message: '按模型计费', confirmLabel: '继续' }) } })
  } })
  const operation: OperationRecord = { operationId: randomUUID(), callerId, capabilityId: 'generate_video_edit_subtitles', input: {}, inputDigest: 'fixture', state: 'prepared' }
  operations.store.save(operation)
  await expect(host.execute(callerId, operation.capabilityId, {}, new AbortController().signal, { operation })).resolves.toMatchObject({ executionState: 'awaiting_user_confirmation' })
  client.close()
  expect(() => client.catalog()).toThrow('授权已结束')
  expect(() => host.complete({ ...request, result: { ok: false }, progress: { phase: 'executing' } })).not.toThrow()
  host.complete({ ...request, result: { ok: true, data: { verification: { verified: true } } } })
  expect(operations.store.get(operation.operationId, callerId)?.state).toBe('completed')
  expect(() => client.catalog()).toThrow('授权已结束')
  const next = createEmbeddedApplicationClient(callerId, { allowWrites: true, allowPaid: false, allowDestructive: false })
  client.close() // Closing an old handle twice cannot release a new turn's access.
  expect(await next.call('get_application_operation', { operationId: operation.operationId }, new AbortController().signal)).toMatchObject({ executionState: 'completed' })
  next.close(); host.disconnect()
})
