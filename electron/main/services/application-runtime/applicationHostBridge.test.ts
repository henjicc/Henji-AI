import { afterEach, expect, it, vi } from 'vitest'
import { ApplicationHostBridge } from './applicationHostBridge'

afterEach(() => { vi.useRealTimers() })
it('就绪前的只读调用等待注册后执行且释放监听器', async () => {
  vi.useFakeTimers()
  const bridge = new ApplicationHostBridge(() => undefined)
  const result = bridge.execute('caller', 'get_current_application_context', {}, new AbortController().signal)
  const assertion = expect(result).resolves.toEqual({ ok: true })
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
