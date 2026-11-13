import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { waitWithin } from './waitWithin'

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

it('超过等待上限返回 false、工作照常进行，之后失败也不冒成未处理的拒绝', async () => {
  let fail!: (error: Error) => void
  const work = new Promise<void>((_resolve, reject) => { fail = reject })
  const waiting = waitWithin(work, 45_000)
  await vi.advanceTimersByTimeAsync(45_000)
  await expect(waiting).resolves.toBe(false)
  fail(new Error('磁盘已满'))
  await vi.runAllTimersAsync()
})

it('上限内完成返回 true；上限内失败照常抛出', async () => {
  await expect(waitWithin(Promise.resolve(), 45_000)).resolves.toBe(true)
  await expect(waitWithin(Promise.reject(new Error('该录制已结束')), 45_000)).rejects.toThrow('该录制已结束')
})
