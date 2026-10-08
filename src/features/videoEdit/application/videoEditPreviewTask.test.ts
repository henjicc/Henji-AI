import { afterEach, expect, it, vi } from 'vitest'
import { runVideoEditPreviewTask, VideoEditPreviewQueue, VIDEO_EDIT_PREVIEW_TIMEOUT_MS } from './videoEditPreviewTask'

afterEach(() => { vi.useRealTimers() })
it('不会响应取消的任务也在截止时失败，并把取消传给执行层', async () => {
  vi.useFakeTimers()
  let active!: AbortSignal
  const result = runVideoEditPreviewTask(new AbortController().signal, '超时可重试', async signal => { active = signal; return new Promise<void>(() => undefined) })
  const assertion = expect(result).rejects.toThrow('超时可重试')
  await vi.advanceTimersByTimeAsync(VIDEO_EDIT_PREVIEW_TIMEOUT_MS)
  await assertion; expect(active.aborted).toBe(true); expect(vi.getTimerCount()).toBe(0)
})
it('串行单项失败后继续，中止等待项不越过仍在运行的前项', async () => {
  const queue = new VideoEditPreviewQueue(); const signal = new AbortController().signal
  let finish!: () => void
  const first = queue.run(signal, '超时', () => new Promise<void>(resolve => { finish = resolve }))
  const controller = new AbortController(); const cancelledWork = vi.fn(async () => undefined)
  const cancelled = queue.run(controller.signal, '超时', cancelledWork)
  const assertion = expect(cancelled).rejects.toThrow()
  controller.abort(); await assertion
  const failed = queue.run(signal, '超时', async () => { throw new Error('单项失败') })
  const failure = expect(failed).rejects.toThrow('单项失败')
  const nextWork = vi.fn(async () => '下一项'); const next = queue.run(signal, '超时', nextWork)
  await Promise.resolve(); expect(nextWork).not.toHaveBeenCalled()
  finish(); await first; await failure; expect(await next).toBe('下一项'); expect(cancelledWork).not.toHaveBeenCalled()
})
it('单项卡住超时后释放串行队列，迟到执行结果不能再次提交', async () => {
  vi.useFakeTimers()
  const queue = new VideoEditPreviewQueue(); const signal = new AbortController().signal
  let finish!: () => void
  const stalled = queue.run(signal, '超时', () => new Promise<void>(resolve => { finish = resolve }))
  const assertion = expect(stalled).rejects.toThrow('超时')
  await vi.advanceTimersByTimeAsync(VIDEO_EDIT_PREVIEW_TIMEOUT_MS); await assertion
  expect(await queue.run(signal, '超时', async () => '继续')).toBe('继续')
  finish(); await Promise.resolve(); expect(vi.getTimerCount()).toBe(0)
})
