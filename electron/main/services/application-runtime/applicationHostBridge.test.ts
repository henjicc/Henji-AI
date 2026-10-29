import { afterEach, expect, it, vi } from 'vitest'
import { ApplicationHostBridge, ApplicationHostNotReadyError } from './applicationHostBridge'
import { ApplicationOperationCoordinator } from './operationCoordinator'
import { ApplicationOperationStore, createApplicationOperationTablesV1, type OperationRecord } from './operationStore'
import { createContentTrustTestSession } from '../content-trust/test-support'
import type { LocalHostRequest } from '../../../../src/core/application-control/localHostContracts'
import { applicationUserConfirmation } from '../../../../src/core/application-control/userConfirmation'

it('读取作者声明需要人工信任时登记可轮询操作，等待期间不结案，完成后保存原读取结果', async () => {
  const database = createContentTrustTestSession()
  createApplicationOperationTablesV1(database.db)
  const operations = new ApplicationOperationCoordinator(new ApplicationOperationStore(database.db))
  const bridge = new ApplicationHostBridge(() => undefined, operations)
  let request: LocalHostRequest | undefined
  bridge.register({ rendererEpoch: '00000000-0000-4000-8000-000000000001', attachmentSequence: 1, ready: true, tools: [], domains: [] }, { send(channel, value) { if (channel === 'application:host:request') request = value as LocalHostRequest } })
  try {
    const invocation = bridge.execute('reader', 'read_application_entity', { ref: { kind: 'video_edit.code_material', id: 'material' } }, new AbortController().signal)
    bridge.complete({ ...request!, result: { ok: false }, progress: { phase: 'awaiting_user_confirmation', confirmation: applicationUserConfirmation({ title: '分享素材', message: '包含代码，是否信任？', confirmLabel: '信任' }) } })
    const waiting = await invocation
    expect(waiting).toMatchObject({ executionState: 'awaiting_user_confirmation', operationId: expect.any(String) })
    const saved = operations.store.get(String(waiting.operationId), 'reader')!
    expect(operations.result(saved)).toMatchObject({ executionState: 'awaiting_user_confirmation' })
    bridge.complete({ ...request!, result: { ok: false }, progress: { phase: 'executing' } })
    bridge.complete({ ...request!, result: { ok: true, data: { properties: { parameters: [] } } } })
    expect(operations.result(operations.store.get(saved.operationId, 'reader')!)).toMatchObject({ executionState: 'completed', verificationState: 'verified', result: { ok: true, data: { properties: { parameters: [] } } } })
  } finally { bridge.disconnect(); database.dispose() }
})

it.each(['confirmation', 'release', 'abort'] as const)('八个已派发写操作释放等待后不阻塞其他调用方读取：%s', async mode => {
  const bridge = new ApplicationHostBridge(() => undefined)
  const requests: LocalHostRequest[] = []
  const cancelled: string[] = []
  bridge.register({ rendererEpoch: '00000000-0000-4000-8000-000000000001', attachmentSequence: 1, ready: true, tools: [], domains: [] }, {
    send(channel, payload) {
      if (channel === 'application:host:cancel') cancelled.push(payload as string)
      if (channel !== 'application:host:request') return
      const request = payload as LocalHostRequest
      requests.push(request)
      if (request.capabilityId === 'get_current_application_context') bridge.complete({ ...request, result: { ok: true } })
    },
  })
  try {
    for (let i = 0; i < 8; i++) {
      const controller = new AbortController()
      const pending = bridge.execute('writer', 'change_application_entities', {}, controller.signal, {
        operation: { operationId: `operation-${i}`, callerId: 'writer', inputDigest: 'digest', input: {}, capabilityId: 'change_application_entities', state: 'prepared' },
      }).catch(() => undefined)
      if (mode === 'confirmation') bridge.complete({ ...requests.at(-1)!, result: { ok: false }, progress: { phase: 'awaiting_user_confirmation', confirmation: applicationUserConfirmation({ title: '确认修改', message: '是否继续？', confirmLabel: '继续' }) } })
      else if (mode === 'release') bridge.releaseCaller('writer')
      else controller.abort()
      await pending
    }
    await expect(bridge.execute('reader', 'get_current_application_context', {}, new AbortController().signal)).resolves.toMatchObject({ ok: true })
    bridge.revoke('writer')
    expect(cancelled).toHaveLength(8)
  } finally { bridge.cancelPending() }
})

afterEach(() => { vi.useRealTimers() })
it.each(['observe_video_edit_frame', 'get_current_application_context'] as const)('%s 在重载断开期间等待注册；在途断开也可读取新宿主，忽略旧回执', async capabilityId => {
  vi.useFakeTimers()
  const bridge = new ApplicationHostBridge(() => undefined)
  const sent: LocalHostRequest[] = []
  const register = (sequence: number, complete = false) => bridge.register({ rendererEpoch: `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`, attachmentSequence: sequence, ready: true, tools: [], domains: [] }, {
    send: (channel, payload) => {
      if (channel !== 'application:host:request') return
      const request = payload as LocalHostRequest
      sent.push(request)
      if (complete) bridge.complete({ ...request, result: { ok: true, data: { source: 'new' } } })
    },
  })
  register(1)
  const inFlight = bridge.execute('caller', capabilityId, {}, new AbortController().signal)
  bridge.disconnect()
  const whileDisconnected = bridge.execute('caller', capabilityId, {}, new AbortController().signal)
  await vi.advanceTimersByTimeAsync(500)
  bridge.complete({ ...sent[0], result: { ok: true, data: { source: 'stale' } } })
  register(2, true)
  expect(await Promise.all([inFlight, whileDisconnected])).toEqual([
    { ok: true, data: { source: 'new' }, revisionEpoch: '00000000-0000-4000-8000-000000000002' },
    { ok: true, data: { source: 'new' }, revisionEpoch: '00000000-0000-4000-8000-000000000002' },
  ])
  expect(sent).toHaveLength(3)
  expect(sent[1].requestId).not.toBe(sent[0].requestId)
  expect(vi.getTimerCount()).toBe(0)
})
it('在途读取断开后十秒仍未注册，返回可恢复的重试时间且释放监听', async () => {
  vi.useFakeTimers()
  const bridge = new ApplicationHostBridge(() => undefined)
  bridge.register({ rendererEpoch: '00000000-0000-4000-8000-000000000001', attachmentSequence: 1, ready: true, tools: [], domains: [] }, { send: () => undefined })
  const result = bridge.execute('caller', 'observe_video_edit_frame', {}, new AbortController().signal)
  const assertion = expect(result).rejects.toMatchObject({ retryAfterMs: 1000 })
  bridge.disconnect()
  await vi.advanceTimersByTimeAsync(10_000)
  await assertion
  expect(vi.getTimerCount()).toBe(0)
})
it('就绪前的只读调用等待注册后执行且释放监听器', async () => {
  vi.useFakeTimers()
  const bridge = new ApplicationHostBridge(() => undefined)
  const result = bridge.execute('caller', 'get_current_application_context', {}, new AbortController().signal)
  const assertion = expect(result).resolves.toMatchObject({ ok: true })
  await vi.advanceTimersByTimeAsync(500)
  bridge.register({ rendererEpoch: '00000000-0000-4000-8000-000000000001', attachmentSequence: 1, ready: true, tools: [], domains: [] }, {
    send: (_channel, payload) => {
      const request = payload as { requestId: string; rendererEpoch: string }
      bridge.complete({ ...request, result: { ok: true } })
    },
  })
  await assertion
  expect(vi.getTimerCount()).toBe(0)
})
it('只读等待十秒超时返回重试时间，写入立即明确未执行', async () => {
  vi.useFakeTimers()
  const bridge = new ApplicationHostBridge(() => undefined)
  const result = bridge.execute('caller', 'get_current_application_context', {}, new AbortController().signal)
  const assertion = expect(result).rejects.toMatchObject({ retryAfterMs: 1000 })
  await vi.advanceTimersByTimeAsync(10_000)
  await assertion
  await expect(bridge.execute('caller', 'change_application_entities', {}, new AbortController().signal))
    .rejects.toMatchObject({ retryAfterMs: 1000, notExecuted: true })
  expect(vi.getTimerCount()).toBe(0)
})
it('等待工具跨过普通调用期限，取消时通知宿主并释放等待', async () => {
  vi.useFakeTimers()
  const bridge = new ApplicationHostBridge(() => undefined)
  const send = vi.fn()
  bridge.register({ rendererEpoch: '00000000-0000-4000-8000-000000000001', attachmentSequence: 1, ready: true, tools: [], domains: [] }, { send })
  const controller = new AbortController()
  const promise = bridge.execute('caller', 'wait_generation_task', { taskId: 'original' }, controller.signal)
  const assertion = expect(promise).rejects.toThrow('取消')
  await vi.advanceTimersByTimeAsync(31_000)
  expect(send).toHaveBeenCalledTimes(1)
  controller.abort()
  await assertion
  expect(send.mock.calls[1][0]).toBe('application:host:cancel')
  expect(vi.getTimerCount()).toBe(0)
})
it('同一渲染进程从未就绪切到就绪时，先到的新上下文不会被未就绪注册清掉', () => {
  const bridge = new ApplicationHostBridge(() => undefined)
  const transport = { send: vi.fn() } as unknown as Parameters<ApplicationHostBridge['register']>[1]
  const registration = { rendererEpoch: 'epoch', attachmentSequence: 1, ready: false, tools: [], domains: [] }
  bridge.register(registration as never, transport)
  bridge.publishContext({ uiReady: true } as never)
  bridge.register({ ...registration, attachmentSequence: 1, ready: false } as never, transport)
  bridge.register({ ...registration, attachmentSequence: 2, ready: true } as never, transport)
  expect(bridge.ready).toBe(true)
  expect(bridge.getContext()).toMatchObject({ uiReady: true })
  bridge.register({ ...registration, rendererEpoch: 'next', attachmentSequence: 3, ready: true } as never, transport)
  expect(bridge.getContext()).toBeUndefined()
})
it('冷启动时上下文先于首次注册到达，注册不会清掉它', () => {
  const bridge = new ApplicationHostBridge(() => undefined)
  const transport = { send: vi.fn() } as unknown as Parameters<ApplicationHostBridge['register']>[1]
  bridge.publishContext({ uiReady: true } as never)
  bridge.register({ rendererEpoch: 'epoch', attachmentSequence: 1, ready: true, tools: [], domains: [] } as never, transport)
  expect(bridge.ready).toBe(true)
  expect(bridge.getContext()).toMatchObject({ uiReady: true })
})
it('渲染进程崩溃时在途读取与已派发写入立刻结束，之后的调用直接拒绝，新页面就绪后恢复', async () => {
  vi.useFakeTimers()
  let record: OperationRecord = { operationId: 'op', callerId: 'writer', inputDigest: 'digest', input: { paid: true }, capabilityId: 'change_application_entities', state: 'preparing' }
  const store = Object.create(ApplicationOperationStore.prototype) as ApplicationOperationStore
  vi.spyOn(store, 'recoverInterrupted').mockImplementation(() => undefined)
  vi.spyOn(store, 'unresolved').mockImplementation(() => [])
  vi.spyOn(store, 'claim').mockImplementation((value, requestId, rendererEpoch) => { record = { ...value, state: 'executing', requestId, rendererEpoch } })
  vi.spyOn(store, 'byRequest').mockImplementation(requestId => record.requestId === requestId ? record : undefined)
  vi.spyOn(store, 'save').mockImplementation(value => { record = value })
  const operations = new ApplicationOperationCoordinator(store)
  const bridge = new ApplicationHostBridge(() => undefined, operations)
  const sent: string[] = []
  const register = (sequence: number, ready = true) => bridge.register({ rendererEpoch: `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`, attachmentSequence: sequence, ready, tools: [], domains: [] }, {
    send: (channel, payload) => {
      sent.push(channel)
      const request = payload as LocalHostRequest
      if (channel === 'application:host:request' && sequence > 1) bridge.complete({ ...request, result: { ok: true } })
    },
  })
  register(1)
  const read = bridge.execute('reader', 'get_current_application_context', {}, new AbortController().signal)
  const write = bridge.execute('writer', 'change_application_entities', {}, new AbortController().signal, { operation: record })
  const notReady = { reason: 'renderer_crashed', message: 'APPLICATION_NOT_READY:应用界面已崩溃、正在恢复，请稍后重试。' }
  const readFailure = expect(read).rejects.toMatchObject(notReady)
  const writeFailure = expect(write).rejects.toMatchObject(notReady)
  bridge.rendererCrashed()
  await readFailure
  await writeFailure
  expect(sent.filter(channel => channel === 'application:host:cancel')).toEqual([])
  expect(vi.getTimerCount()).toBe(0)
  // 执行中的修改仍是 unknown，回执写明中断原因；涉及付费的照旧保留不重复执行的保护。
  expect(record).toMatchObject({ state: 'unknown', result: { ok: false, error: { code: 'CONNECTION_INTERRUPTED', message: expect.stringMatching(/^已中断/),
    details: { interruption: { reason: 'renderer_crashed' } } } } })
  expect(operations.result(record).recovery).toMatch(/禁止重复原修改/)
  const failure = await bridge.execute('reader', 'get_current_application_context', {}, new AbortController().signal).catch((error: unknown) => error)
  expect(failure).toBeInstanceOf(ApplicationHostNotReadyError)
  expect((failure as ApplicationHostNotReadyError).failure()).toEqual({ code: 'APPLICATION_NOT_READY', message: '应用界面已崩溃、正在恢复，请稍后重试。', recoverable: true,
    details: { execution: { notExecuted: true }, retryAfterMs: 1000, reason: 'renderer_crashed' } })
  // 重新加载的页面先以未就绪注册，原因要保留到真正就绪。
  register(2, false)
  expect(bridge.hostUnavailable?.reason).toBe('renderer_crashed')
  register(3)
  expect(bridge.hostUnavailable).toBeUndefined()
  await expect(bridge.execute('reader', 'get_current_application_context', {}, new AbortController().signal)).resolves.toMatchObject({ ok: true })
})
it('未就绪时写入入口登记零执行，崩溃原因进入对外详情', () => {
  const store = Object.create(ApplicationOperationStore.prototype) as ApplicationOperationStore
  vi.spyOn(store, 'recoverInterrupted').mockImplementation(() => undefined)
  vi.spyOn(store, 'unresolved').mockImplementation(() => [])
  vi.spyOn(store, 'get').mockImplementation(() => undefined)
  vi.spyOn(store, 'prepare').mockImplementation(value => value as OperationRecord)
  vi.spyOn(store, 'save').mockImplementation(() => undefined)
  const operations = new ApplicationOperationCoordinator(store)
  const record = operations.rejectBeforeDispatch('caller', { operationId: '00000000-0000-4000-8000-000000000009', changes: [] }, 'change_application_entities', 1000, { reason: 'renderer_crashed', recovering: true })
  expect(record).toMatchObject({ state: 'not_executed', result: { ok: false, error: { code: 'APPLICATION_NOT_READY', message: '应用界面已崩溃、正在恢复，请稍后重试。',
    details: { reason: 'renderer_crashed', execution: { notExecuted: true } } } } })
})
it('助手命令行的界面崩溃后不会恢复：对外说明本次运行无法继续，且不可重试', async () => {
  const bridge = new ApplicationHostBridge(() => undefined)
  bridge.register({ rendererEpoch: '00000000-0000-4000-8000-000000000001', attachmentSequence: 1, ready: true, tools: [], domains: [] }, { send: () => undefined })
  bridge.rendererCrashed(false)
  const failure = await bridge.execute('reader', 'get_current_application_context', {}, new AbortController().signal).catch((error: unknown) => error)
  expect((failure as ApplicationHostNotReadyError).failure()).toEqual({ code: 'APPLICATION_NOT_READY', message: '应用界面已崩溃，本次运行无法继续。', recoverable: false,
    details: { execution: { notExecuted: true }, reason: 'renderer_crashed' } })
})
