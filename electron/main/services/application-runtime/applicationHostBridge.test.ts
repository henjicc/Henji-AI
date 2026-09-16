import { afterEach, expect, it, vi } from 'vitest'
import { ApplicationHostBridge } from './applicationHostBridge'

afterEach(() => { vi.useRealTimers() })
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
