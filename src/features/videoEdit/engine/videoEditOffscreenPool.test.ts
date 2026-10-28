import { afterEach, expect, it, vi } from 'vitest'
import { createVideoEditTestDocument } from '@/core/videoEdit/testFixtures'
import { videoEditComposition } from '@/core/videoEdit/document'
import type { VideoEditRenderSession } from './videoEditRenderSession'
import { VideoEditOffscreenPool } from './videoEditOffscreenPool'
import { VideoEditRenderWorkerError } from './videoEditGpuFailure'

afterEach(() => { vi.useRealTimers() })
function fixture() {
  const source = createVideoEditTestDocument('pool')
  const document = videoEditComposition(source, source.sequences[0].id)
  const session = { replaceContent: vi.fn().mockResolvedValue(undefined), dispose: vi.fn().mockResolvedValue(undefined) }
  const create = vi.fn(async () => session as unknown as VideoEditRenderSession)
  const memory = vi.fn(async () => true)
  const pool = new VideoEditOffscreenPool(create, memory)
  return { document, session, create, memory, pool, signal: new AbortController().signal }
}
it('exclusive leases reuse one worker and always replace content before handing it over', async () => {
  const f = fixture(); const first = await f.pool.acquire(f.document, f.signal)
  let secondReady = false
  const second = f.pool.acquire({ ...f.document, id: 'other', revision: 0 }, f.signal).then(value => { secondReady = true; return value })
  await Promise.resolve(); expect(secondReady).toBe(false)
  await first.release(); const next = await second
  expect(first.reused).toBe(false); expect(next.reused).toBe(true)
  expect(f.create).toHaveBeenCalledOnce()
  expect(f.session.replaceContent).toHaveBeenCalledWith(expect.objectContaining({ id: 'other', revision: 0 }))
  await next.release(); await f.pool.dispose(); expect(f.session.dispose).toHaveBeenCalledOnce()
})
it('cancelled waiters never unlock the active owner', async () => {
  const f = fixture(); const first = await f.pool.acquire(f.document, f.signal)
  const controller = new AbortController()
  const wait = f.pool.acquire(f.document, controller.signal)
  const rejected = expect(wait).rejects.toThrow(); controller.abort(); await rejected
  let ready = false
  const next = f.pool.acquire(f.document, f.signal).then(value => { ready = true; return value })
  await Promise.resolve(); expect(ready).toBe(false)
  await first.release(); await (await next).release(); await f.pool.dispose()
})
it('failed or aborted active work retires the worker before the next lease', async () => {
  const f = fixture(); const first = await f.pool.acquire(f.document, f.signal)
  await first.release(true); await first.release(true)
  const next = await f.pool.acquire(f.document, f.signal)
  expect(next.reused).toBe(false); expect(f.create).toHaveBeenCalledTimes(2)
  await next.release(); await f.pool.dispose()
})
it('idle timeout and memory pressure reclaim speculative resources, never an active lease', async () => {
  vi.useFakeTimers()
  const f = fixture(); const first = await f.pool.acquire(f.document, f.signal)
  await vi.advanceTimersByTimeAsync(60_000); expect(f.session.dispose).not.toHaveBeenCalled()
  await first.release(); await vi.advanceTimersByTimeAsync(60_000)
  expect(f.session.dispose).toHaveBeenCalledOnce()
  const next = await f.pool.acquire(f.document, f.signal); await next.release()
  f.memory.mockResolvedValue(false); await vi.advanceTimersByTimeAsync(5000)
  expect(f.session.dispose).toHaveBeenCalledTimes(2)
  await f.pool.dispose(); expect(vi.getTimerCount()).toBe(0)
})

it('空闲回收尚未完成时先等待释放旧设备，再创建新会话', async () => {
  vi.useFakeTimers()
  const f = fixture(); const lease = await f.pool.acquire(f.document, f.signal)
  let finish!: () => void
  f.session.dispose.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
  await lease.release(); await vi.advanceTimersByTimeAsync(60_000)
  const next = f.pool.acquire(f.document, f.signal)
  await Promise.resolve(); expect(f.create).toHaveBeenCalledOnce()
  finish(); await (await next).release(); await f.pool.dispose()
})
it('替换文档卡住时中止会销毁旧 Worker，后续请求重新建立', async () => {
  const f = fixture(); await (await f.pool.acquire(f.document, f.signal)).release()
  f.session.replaceContent.mockImplementationOnce(() => new Promise(() => undefined))
  const controller = new AbortController(); const pending = f.pool.acquire(f.document, controller.signal)
  const rejected = expect(pending).rejects.toThrow()
  await vi.waitFor(() => expect(f.session.replaceContent).toHaveBeenCalledOnce())
  controller.abort(); await rejected
  const last = await f.pool.acquire(f.document, f.signal); expect(last.reused).toBe(false)
  await last.release(); await f.pool.dispose()
})
it('空闲 Worker 已退出则直接建新会话，租约不接管已失败的通道', async () => {
  const f = fixture(); await (await f.pool.acquire(f.document, f.signal)).release()
  Object.assign(f.session, { terminated: true })
  const next = await f.pool.acquire(f.document, f.signal)
  expect(next.reused).toBe(false); expect(f.create).toHaveBeenCalledTimes(2)
  expect(f.session.replaceContent).not.toHaveBeenCalled()
  await next.release(); await f.pool.dispose()
})
it('普通 Worker 异常有界退避重建；取消等待不会建新 Worker，超时不自动重放', async () => {
  vi.useFakeTimers()
  const f = fixture(), controller = new AbortController()
  const lease = await f.pool.acquire(f.document, controller.signal)
  const operation = vi.fn().mockRejectedValueOnce(new VideoEditRenderWorkerError('退出')).mockResolvedValueOnce('frame')
  const recovered = lease.run(f.document, operation)
  await vi.advanceTimersByTimeAsync(249); expect(f.create).toHaveBeenCalledOnce()
  await vi.advanceTimersByTimeAsync(1); expect(await recovered).toBe('frame'); expect(f.create).toHaveBeenCalledTimes(2)
  operation.mockRejectedValue(new VideoEditRenderWorkerError('退出'))
  const pending = lease.run(f.document, operation), rejected = expect(pending).rejects.toThrow('退出')
  await vi.advanceTimersByTimeAsync(500); await rejected
  expect(f.create).toHaveBeenCalledTimes(3)
  const timeout = vi.fn().mockRejectedValue(new Error('超过时限'))
  await expect(lease.run(f.document, timeout)).rejects.toThrow('超过时限'); expect(timeout).toHaveBeenCalledOnce()
  await lease.release(true); await f.pool.dispose()

  const g = fixture(), abort = new AbortController(), cancelled = await g.pool.acquire(g.document, abort.signal)
  const wait = cancelled.run(g.document, async () => { throw new VideoEditRenderWorkerError('退出') })
  const failure = expect(wait).rejects.toThrow()
  await vi.advanceTimersByTimeAsync(0); abort.abort(); await failure
  await vi.advanceTimersByTimeAsync(1000); expect(g.create).toHaveBeenCalledOnce()
  await cancelled.release(true); await g.pool.dispose(); expect(vi.getTimerCount()).toBe(0)
})
it('恢复等待时释放租约，迟到重建不能覆盖下一位使用者的会话', async () => {
  vi.useFakeTimers()
  const f = fixture(), lease = await f.pool.acquire(f.document, f.signal)
  const pending = lease.run(f.document, async () => { throw new VideoEditRenderWorkerError('退出') })
  const rejected = expect(pending).rejects.toThrow('已结束')
  await vi.advanceTimersByTimeAsync(0); await lease.release(true)
  const next = await f.pool.acquire(f.document, f.signal)
  await vi.advanceTimersByTimeAsync(500); await rejected
  expect(f.create).toHaveBeenCalledTimes(2)
  expect(await next.run(f.document, async () => 'frame')).toBe('frame')
  await next.release(); await f.pool.dispose()
})
