import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { OperationRecord } from './operationStore'
import type { LocalHostRequest } from '../../../../src/core/application-control/localHostContracts'
import type { HostContextSnapshot } from '../../../../src/core/application-control/hostContracts'
import { initializeApplicationRuntime } from './runtime'
import { AUTO_REVIEW_QUIET_MS } from './operationAutoReview'

const documents = vi.hoisted(() => new Map<string, number>())
vi.mock('electron', () => ({ app: { isPackaged: false }, dialog: { showMessageBox: vi.fn() } }))
vi.mock('../db', () => ({ getDb: () => undefined }))
vi.mock('../generation-history/store', () => ({ getGenerationHistoryStore: () => { throw new Error('本测试不得访问生成记录') } }))
// 作品索引只提供文档的已保存修订号。
vi.mock('../documents/index-store', () => ({ DocumentIndexStore: class { getDocument(id: string) { return documents.has(id) ? { id, revision: documents.get(id) } : null } } }))
// 只替换存储边界；宿主、核对派发与调度都是正式实现。
vi.mock('./operationStore', async original => {
  const actual = await original<typeof import('./operationStore')>()
  return { ...actual, ApplicationOperationStore: class {
    records = new Map<string, OperationRecord>()
    recoverInterrupted() {}
    save(record: OperationRecord) { this.records.set(`${record.callerId}:${record.operationId}`, record) }
    get(id: string, caller: string) { return this.records.get(`${caller}:${id}`) }
    unresolved() { return [...this.records.values()].filter(record => actual.UNRESOLVED_OPERATION_STATES.includes(record.state)) }
    byRequest(id: string, epoch: string) { return [...this.records.values()].find(record => record.requestId === id && record.rendererEpoch === epoch) }
  } }
})

const requests: LocalHostRequest[] = []
/** 渲染层对一次核对读取的回复；默认拿不到原回执、重读目标也没达到原修改的值。 */
const unsettled = (request: LocalHostRequest): Record<string, unknown> => ({ ok: true, data: request.recoveryVerification ? { verification: { verified: false } } : {} })
let reply = unsettled
let attachmentSequence = 0
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  requests.length = 0
  reply = unsettled
  documents.clear()
  ;(initializeApplicationRuntime().operations.store as unknown as { records: Map<string, OperationRecord> }).records.clear()
})
afterEach(() => { vi.useRealTimers() })

/** 新渲染会话注册就绪。 */
function attach(): string {
  const { host } = initializeApplicationRuntime()
  const rendererEpoch = randomUUID()
  host.register({ rendererEpoch, attachmentSequence: ++attachmentSequence, ready: true, tools: [], domains: [] }, { send: (channel, payload) => {
    if (channel !== 'application:host:request') return
    const request = payload as LocalHostRequest
    requests.push(request)
    host.complete({ requestId: request.requestId, rendererEpoch: request.rendererEpoch, result: reply(request) })
  } })
  return rendererEpoch
}

const marker = (record: OperationRecord) => initializeApplicationRuntime().operations.store.get(record.operationId, record.callerId)?.autoReview

async function settle(done: Promise<void>): Promise<void> {
  let finished = false
  void done.then(() => { finished = true })
  for (let step = 0; step < 100 && !finished; step++) await vi.advanceTimersByTimeAsync(AUTO_REVIEW_QUIET_MS)
  await done
}

/** 执行完但结果不符合原修改的事务：保留可重读的验证条件，目标在 documentId 这份剪辑里。 */
function verifiableEdit(documentId: string): OperationRecord {
  const target = { kind: 'video_edit.clip', id: `${documentId}:clip` }
  return { operationId: randomUUID(), callerId: randomUUID(), capabilityId: 'change_application_entities', inputDigest: 'edit', state: 'partial',
    verificationState: 'unresolved', requestId: randomUUID(), rendererEpoch: 'departed', paidGenerationEstimate: 0.5, targetRefs: [target],
    input: { changes: [{ kind: 'set_properties', entityType: target.kind, target, properties: { 'video_edit.clip.name': '片头' } }] },
    result: { ok: false, error: { details: { transaction: { code: 'VERIFICATION_FAILED', partial: { completedStepIndexes: [0], compensatedStepIndexes: [], uncompensatedStepIndexes: [0] } } } } } }
}

/** 上一个渲染会话里结果未知、没有可核验条件的图片编辑修改：只能核对原回执。图片编辑引用把编码后的文档 ID 放在 `v3:` 之后。 */
function lostReceipt(documentId: string): OperationRecord {
  const target = { kind: 'image_edit.layer', id: `v3:${encodeURIComponent(documentId)}:layer` }
  return { operationId: randomUUID(), callerId: randomUUID(), capabilityId: 'change_application_entities', inputDigest: 'lost', state: 'unknown',
    verificationState: 'unresolved', requestId: randomUUID(), rendererEpoch: 'departed', targetRefs: [target],
    input: { changes: [{ kind: 'set_properties', entityType: target.kind, target, properties: { 'image_edit.layer.name': '主体' } }] } }
}

const kinds = () => requests.map(request => request.recoveryVerification ? 'verify' : request.recoveryOperation ? 'receipt' : 'read')

it('目标文档没保存过时再次注册不发任何读取；文档保存过的记录重读验证或重新核对回执', async () => {
  const { operations, autoReviewOperations } = initializeApplicationRuntime()
  const edit = verifiableEdit('doc-a'), lost = lostReceipt('图片 b')
  documents.set('doc-a', 3).set('图片 b', 7)
  operations.store.save(edit); operations.store.save(lost)

  await settle(autoReviewOperations(attach()))
  expect(kinds()).toEqual(['verify', 'receipt'])
  expect(marker(lost)).toEqual({ state: 'unknown', documentRevisions: { '图片 b': 7 } })

  requests.length = 0
  await settle(autoReviewOperations(attach()))
  expect(requests).toEqual([])

  documents.set('doc-a', 4).set('图片 b', 8)
  await settle(autoReviewOperations(attach()))
  expect(kinds()).toEqual(['verify', 'receipt'])
  expect(marker(edit)).toEqual({ state: 'partial', documentRevisions: { 'doc-a': 4 } })
  expect(marker(lost)).toEqual({ state: 'unknown', documentRevisions: { '图片 b': 8 } })
})

it('状态变了或目标文档被删除时再复核一次，之后不再重复', async () => {
  const { operations, autoReviewOperations } = initializeApplicationRuntime()
  const edit = verifiableEdit('doc-f'), lost = lostReceipt('doc-g')
  documents.set('doc-f', 1).set('doc-g', 1)
  operations.store.save(edit); operations.store.save(lost)
  await settle(autoReviewOperations(attach()))

  requests.length = 0
  operations.store.save({ ...operations.store.get(lost.operationId, lost.callerId)!, state: 'awaiting_user_confirmation' })
  documents.delete('doc-f')
  await settle(autoReviewOperations(attach()))
  expect(kinds()).toEqual(['verify', 'receipt'])
  expect(marker(edit)).toEqual({ state: 'partial', documentRevisions: {} })
  expect(marker(lost)?.state).toBe('awaiting_user_confirmation')

  requests.length = 0
  await settle(autoReviewOperations(attach()))
  expect(requests).toEqual([])
})

it('读取失败或中途换了渲染会话时不记记号，下次注册再试', async () => {
  const { operations, autoReviewOperations } = initializeApplicationRuntime()
  const failed = verifiableEdit('doc-h')
  documents.set('doc-h', 1)
  operations.store.save(failed)
  reply = () => ({ ok: false, error: { code: 'APPLICATION_EXECUTION_FAILED', message: '剪辑打开超时。' } })
  await settle(autoReviewOperations(attach()))
  expect(kinds()).toEqual(['verify'])
  expect(marker(failed)).toBeUndefined()

  // 页面在读取途中重载：读取在新会话里补发并读完，但已经不是开始核对的那个会话。
  requests.length = 0
  reply = request => {
    if (requests.length === 1) attach()
    return unsettled(request)
  }
  await settle(autoReviewOperations(attach()))
  expect(marker(failed)).toBeUndefined()

  requests.length = 0
  reply = unsettled
  await settle(autoReviewOperations(attach()))
  expect(kinds()).toEqual(['verify'])
  expect(marker(failed)).toEqual({ state: 'partial', documentRevisions: { 'doc-h': 1 } })
})

it('首屏与文档恢复还在发布上下文时不复核，界面安静后才读取', async () => {
  const { host, operations, autoReviewOperations } = initializeApplicationRuntime()
  documents.set('doc-c', 1)
  operations.store.save(verifiableEdit('doc-c'))
  const done = autoReviewOperations(attach())
  for (let second = 0; second < 8; second++) {
    await vi.advanceTimersByTimeAsync(1_000)
    host.publishContext({ revision: second, scopeRevisions: {} } as unknown as HostContextSnapshot)
  }
  expect(requests).toEqual([])
  await settle(done)
  expect(requests).toHaveLength(1)
})

it('自动复核过的记录，用户打开核对时仍完整重读并请用户核对', async () => {
  const { operations, autoReviewOperations, reviewOperation } = initializeApplicationRuntime()
  const edit = verifiableEdit('doc-e')
  documents.set('doc-e', 2)
  operations.store.save(edit)
  await settle(autoReviewOperations(attach()))
  requests.length = 0
  await settle(autoReviewOperations(attach()))
  expect(requests).toEqual([])

  await reviewOperation(operations.store.get(edit.operationId, edit.callerId)!)
  expect(requests.map(request => request.capabilityId)).toEqual(['get_current_application_context', 'read_application_entity'])
  expect(operations.store.get(edit.operationId, edit.callerId)).toMatchObject({ state: 'awaiting_user_confirmation', confirmation: { purpose: 'review' } })
})
