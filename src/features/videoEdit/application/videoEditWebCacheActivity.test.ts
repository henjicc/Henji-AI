import { afterEach, expect, it, vi } from 'vitest'
import { createWebCacheActivityReporter } from './videoEditWebCacheActivity'

afterEach(() => { vi.useRealTimers() })

it('迟到的失败不能丢掉关闭时的 false，停止采样后也继续重试未送达的释放', async () => {
  vi.useFakeTimers()
  let reject!: (reason: Error) => void
  const send = vi.fn(async (_active: boolean) => undefined)
    .mockImplementationOnce(() => new Promise((_resolve, no) => { reject = no }))
    .mockRejectedValueOnce(new Error('release transport failed'))
  const report = createWebCacheActivityReporter(send, vi.fn())
  report(false); expect(send).not.toHaveBeenCalled()
  report(true); await vi.advanceTimersByTimeAsync(0)
  report(false); reject(new Error('late active response failed'))
  await vi.advanceTimersByTimeAsync(0)
  expect(send.mock.calls).toEqual([[true], [false]])
  await vi.advanceTimersByTimeAsync(1000)
  expect(send.mock.calls).toEqual([[true], [false], [false]])
  await vi.advanceTimersByTimeAsync(2000)
  expect(send).toHaveBeenCalledTimes(3)
})

it('活动恢复越过失败冷却，连续重复采样不重复发送', async () => {
  vi.useFakeTimers()
  const send = vi.fn(async (_active: boolean) => undefined)
  const report = createWebCacheActivityReporter(send, vi.fn())
  report(true); await vi.advanceTimersByTimeAsync(0)
  send.mockRejectedValueOnce(new Error('unavailable'))
  report(false); await vi.advanceTimersByTimeAsync(0)
  report(true); report(true); await vi.advanceTimersByTimeAsync(0)
  // false 可能已经送到主进程，失败响应不能把此前 true 当作仍然生效。
  expect(send.mock.calls).toEqual([[true], [false], [true]])
})
