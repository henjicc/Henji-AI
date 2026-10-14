import { afterEach, expect, it, vi } from 'vitest'
import { RecordingTracksClock } from './clock'

afterEach(() => { vi.useRealTimers() })
it('5秒重新读取共享单调时钟，关闭后的迟到校准失败不触发旧会话失败或重开定时器', async () => {
  vi.useFakeTimers()
  let reject!: (error: Error) => void
  const read = vi.fn(async () => 10_000_000)
  read.mockImplementationOnce(async () => 10_000_000).mockImplementationOnce(() => new Promise<number>((_resolve, rejected) => { reject = rejected }))
  const failed = vi.fn()
  const clock = new RecordingTracksClock(10_000_000, read, failed)
  await clock.start(); await vi.advanceTimersByTimeAsync(5000); expect(read).toHaveBeenCalledTimes(2)
  clock.stop(); reject(new Error('owner-lost')); await vi.advanceTimersByTimeAsync(10_000)
  expect(failed).not.toHaveBeenCalled(); expect(read).toHaveBeenCalledTimes(2)
})
