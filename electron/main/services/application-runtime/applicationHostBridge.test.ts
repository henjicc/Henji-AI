import { afterEach, expect, it, vi } from 'vitest'
import { ApplicationHostBridge } from './applicationHostBridge'
import type { LocalHostRequest } from '../../../../src/core/application-control/localHostContracts'
import { applicationUserConfirmation } from '../../../../src/core/application-control/userConfirmation'

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
